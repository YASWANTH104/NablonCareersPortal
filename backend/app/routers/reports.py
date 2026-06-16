import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.database import get_db
from app.dependencies import require_roles, Role
from app.models.application import Application
from app.models.job import Job, Department
from app.models.referral import Referral
from app.models.agency import Agency

router = APIRouter(prefix="/reports", tags=["reports"])
_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)

FUNNEL_STAGES = [
    "applied", "screening", "assessment",
    "interview_1", "interview_2", "final_interview",
    "offer", "hired",
]


@router.get("/hiring-funnel")
async def hiring_funnel(
    department_id: Optional[str] = Query(None),
    days: int = Query(90, ge=7, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    filters = [Application.applied_at >= since]

    if department_id:
        try:
            filters.append(Job.department_id == uuid.UUID(department_id))
        except ValueError:
            pass

    rows = (await db.execute(
        select(Application.stage, func.count().label("count"))
        .join(Job, Application.job_id == Job.id)
        .where(and_(*filters))
        .group_by(Application.stage)
    )).all()

    stage_map = {r.stage: r.count for r in rows}
    return [{"stage": s, "count": stage_map.get(s, 0)} for s in FUNNEL_STAGES]


@router.get("/source-analysis")
async def source_analysis(
    days: int = Query(90, ge=7, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await db.execute(
        select(Application.source, func.count().label("count"))
        .where(Application.applied_at >= since)
        .group_by(Application.source)
        .order_by(func.count().desc())
    )).all()
    return [{"source": r.source or "direct", "count": r.count} for r in rows]


@router.get("/referral-performance")
async def referral_performance(
    days: int = Query(90, ge=7, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await db.execute(
        select(Referral.status, func.count().label("count"))
        .where(Referral.created_at >= since)
        .group_by(Referral.status)
    )).all()
    status_map = {r.status: r.count for r in rows}

    bonus_paid = (await db.execute(
        select(func.count()).select_from(Referral).where(
            Referral.bonus_paid == True,  # noqa: E712
            Referral.created_at >= since,
        )
    )).scalar_one()

    status_order = ["pending", "invited", "applied", "in_progress", "hired", "rejected", "expired"]
    return {
        "by_status": [{"status": s, "count": status_map.get(s, 0)} for s in status_order],
        "bonus_paid": bonus_paid,
        "total": sum(status_map.values()),
    }


@router.get("/time-to-hire")
async def time_to_hire_report(
    days: int = Query(180, ge=30, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await db.execute(
        select(
            Department.name.label("department"),
            func.avg(
                func.extract("epoch", Application.stage_updated_at - Application.applied_at) / 86400
            ).label("avg_days"),
            func.min(
                func.extract("epoch", Application.stage_updated_at - Application.applied_at) / 86400
            ).label("min_days"),
            func.max(
                func.extract("epoch", Application.stage_updated_at - Application.applied_at) / 86400
            ).label("max_days"),
            func.count().label("count"),
        )
        .join(Job, Application.job_id == Job.id)
        .join(Department, Job.department_id == Department.id)
        .where(and_(Application.stage == "hired", Application.applied_at >= since))
        .group_by(Department.name)
        .order_by(func.avg(
            func.extract("epoch", Application.stage_updated_at - Application.applied_at) / 86400
        ))
    )).all()

    return [
        {
            "department": r.department,
            "avg_days": round(float(r.avg_days), 1) if r.avg_days else 0,
            "min_days": round(float(r.min_days), 1) if r.min_days else 0,
            "max_days": round(float(r.max_days), 1) if r.max_days else 0,
            "count": r.count,
        }
        for r in rows
    ]


@router.get("/agency-performance")
async def agency_performance(
    days: int = Query(90, ge=7, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)

    agencies = (await db.execute(select(Agency).where(Agency.is_active == True))).scalars().all()

    result = []
    for agency in agencies:
        rows = (await db.execute(
            select(Application.stage, func.count().label("count"))
            .where(
                Application.agency_id == agency.id,
                Application.applied_at >= since,
            )
            .group_by(Application.stage)
        )).all()

        stage_map = {r.stage: r.count for r in rows}
        total = sum(stage_map.values())
        hired = stage_map.get("hired", 0)
        rejected = stage_map.get("rejected", 0)
        in_progress = total - hired - rejected

        result.append({
            "agency_id": str(agency.id),
            "agency_name": agency.name,
            "contact_email": agency.contact_email,
            "total_submitted": total,
            "in_progress": in_progress,
            "hired": hired,
            "rejected": rejected,
            "conversion_rate": round((hired / total) * 100, 1) if total > 0 else 0,
            "by_stage": [{"stage": s, "count": stage_map.get(s, 0)} for s in [
                "applied", "screening", "assessment", "tr1", "tr2", "hr", "offer", "hired", "rejected"
            ]],
        })

    result.sort(key=lambda x: x["total_submitted"], reverse=True)
    return result
