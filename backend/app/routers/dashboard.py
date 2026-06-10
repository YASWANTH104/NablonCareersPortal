from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.database import get_db
from app.dependencies import require_roles, Role
from app.models.job import Job, Department
from app.models.application import Application, ApplicationStageHistory
from app.models.interview import Interview
from app.models.referral import Referral
from app.models.user import User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


@router.get("/stats")
async def get_stats(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    two_weeks_ago = now - timedelta(days=14)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_end = today_start + timedelta(days=2)

    open_jobs = (await db.execute(
        select(func.count()).select_from(Job).where(Job.status == "published")
    )).scalar_one()

    apps_this_week = (await db.execute(
        select(func.count()).select_from(Application).where(Application.applied_at >= week_ago)
    )).scalar_one()

    apps_last_week = (await db.execute(
        select(func.count()).select_from(Application).where(
            and_(Application.applied_at >= two_weeks_ago, Application.applied_at < week_ago)
        )
    )).scalar_one()

    pending_reviews = (await db.execute(
        select(func.count()).select_from(Application).where(
            Application.stage.in_(["applied", "screening"])
        )
    )).scalar_one()

    interviews_today = (await db.execute(
        select(func.count()).select_from(Interview).where(
            and_(
                Interview.scheduled_at >= today_start,
                Interview.scheduled_at < tomorrow_end,
                Interview.status == "scheduled",
            )
        )
    )).scalar_one()

    total_referrals = (await db.execute(
        select(func.count()).select_from(Referral)
    )).scalar_one()

    hired_total = (await db.execute(
        select(func.count()).select_from(Application).where(Application.stage == "hired")
    )).scalar_one()

    return {
        "open_jobs": open_jobs,
        "applications_this_week": apps_this_week,
        "applications_last_week": apps_last_week,
        "pending_reviews": pending_reviews,
        "interviews_today": interviews_today,
        "total_referrals": total_referrals,
        "hired_total": hired_total,
    }


@router.get("/funnel")
async def get_funnel(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Application.stage, func.count().label("count"))
        .group_by(Application.stage)
    )).all()

    stage_order = [
        "applied", "screening", "assessment",
        "interview_1", "interview_2", "interview_3",
        "final_interview", "offer", "hired",
    ]
    stage_map = {r.stage: r.count for r in rows}
    return [{"stage": s, "count": stage_map.get(s, 0)} for s in stage_order]


@router.get("/time-to-hire")
async def get_time_to_hire(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(
            Department.name.label("department"),
            func.avg(
                func.extract("epoch", Application.stage_updated_at - Application.applied_at) / 86400
            ).label("avg_days"),
            func.count().label("count"),
        )
        .join(Job, Application.job_id == Job.id)
        .join(Department, Job.department_id == Department.id)
        .where(Application.stage == "hired")
        .group_by(Department.name)
        .order_by(func.avg(
            func.extract("epoch", Application.stage_updated_at - Application.applied_at) / 86400
        ))
    )).all()

    return [
        {
            "department": r.department,
            "avg_days": round(float(r.avg_days), 1) if r.avg_days else 0,
            "count": r.count,
        }
        for r in rows
    ]


@router.get("/activity")
async def get_activity(
    limit: int = Query(10, ge=1, le=50),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(
            ApplicationStageHistory,
            User.full_name.label("candidate_name"),
        )
        .join(Application, ApplicationStageHistory.application_id == Application.id)
        .join(User, Application.applicant_id == User.id)
        .order_by(ApplicationStageHistory.created_at.desc())
        .limit(limit)
    )).all()

    return [
        {
            "application_id": str(r.ApplicationStageHistory.application_id),
            "candidate_name": r.candidate_name,
            "from_stage": r.ApplicationStageHistory.from_stage,
            "to_stage": r.ApplicationStageHistory.to_stage,
            "created_at": r.ApplicationStageHistory.created_at.isoformat(),
        }
        for r in rows
    ]
