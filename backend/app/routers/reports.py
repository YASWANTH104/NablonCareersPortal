import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.database import get_db
from app.dependencies import require_roles, Role
from app.models.application import Application, ApplicationStageHistory
from app.models.job import Job, Department
from app.models.referral import Referral
from app.models.agency import Agency
from app.models.user import User
from app.constants.stages import STAGE_LABELS, TERMINAL_STAGES, DROP_REASON_CATEGORIES, STUCK_THRESHOLD_DAYS

router = APIRouter(prefix="/reports", tags=["reports"])
_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)

_ALL_STAGES = list(STAGE_LABELS.keys())
_DROP_STAGES = ("rejected", "interview_drop", "offer_drop")
_DROP_CATEGORY_LABELS = {c["value"]: c["label"] for c in DROP_REASON_CATEGORIES}

FUNNEL_STAGES = [
    "applied", "screening", "assessment",
    "tr1", "tr2", "final_tr", "hr",
    "offer", "hired",
]

PIPELINE_STAGES = FUNNEL_STAGES + ["rejected", "withdrawn"]

KNOWN_SOURCES = ["direct", "referral", "agency", "talent_acquisition"]

_TREND_BUCKETS = {"day", "week", "month"}


@router.get("/hiring-funnel")
async def hiring_funnel(
    department_id: Optional[str] = Query(None),
    days: int = Query(90, ge=1, le=365),
    source: Optional[str] = Query(None),
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
    if source:
        filters.append(Application.source == source)

    rows = (await db.execute(
        select(Application.stage, func.count().label("count"))
        .join(Job, Application.job_id == Job.id)
        .where(and_(*filters))
        .group_by(Application.stage)
    )).all()

    stage_map = {r.stage: r.count for r in rows}
    return [{"stage": s, "count": stage_map.get(s, 0)} for s in FUNNEL_STAGES]


@router.get("/pipeline-snapshot")
async def pipeline_snapshot(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Current state of the pipeline: how many candidates sit in each stage right now,
    overall and broken down by source. Not restricted by date — this is 'as of now'."""
    rows = (await db.execute(
        select(Application.stage, Application.source, func.count().label("count"))
        .group_by(Application.stage, Application.source)
    )).all()

    stage_totals: dict = {}
    source_totals: dict = {}
    matrix: dict = {}
    for r in rows:
        source = r.source or "direct"
        stage_totals[r.stage] = stage_totals.get(r.stage, 0) + r.count
        source_totals[source] = source_totals.get(source, 0) + r.count
        matrix.setdefault(source, {})[r.stage] = r.count

    sources = sorted(source_totals, key=lambda s: -source_totals[s])
    return {
        "stages": [{"stage": s, "count": stage_totals.get(s, 0)} for s in PIPELINE_STAGES],
        "sources": [{"source": s, "count": source_totals[s]} for s in sources],
        "matrix": [
            {
                "source": s,
                "total": source_totals[s],
                "by_stage": [{"stage": st, "count": matrix[s].get(st, 0)} for st in PIPELINE_STAGES],
            }
            for s in sources
        ],
    }


@router.get("/applications-trend")
async def applications_trend(
    days: int = Query(90, ge=1, le=365),
    bucket: str = Query("day"),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Applications received over time, bucketed by day/week/month and split by source."""
    if bucket not in _TREND_BUCKETS:
        bucket = "day"
    since = datetime.now(timezone.utc) - timedelta(days=days)

    bucket_expr = func.date_trunc(bucket, Application.applied_at)
    rows = (await db.execute(
        select(
            bucket_expr.label("bucket"),
            Application.source,
            func.count().label("count"),
        )
        .where(Application.applied_at >= since)
        .group_by(bucket_expr, Application.source)
        .order_by(bucket_expr)
    )).all()

    return [
        {
            "bucket": r.bucket.date().isoformat() if r.bucket else None,
            "source": r.source or "direct",
            "count": r.count,
        }
        for r in rows
    ]


@router.get("/source-analysis")
async def source_analysis(
    days: int = Query(90, ge=1, le=365),
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


@router.get("/source-funnel")
async def source_funnel(
    days: int = Query(90, ge=1, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Stage breakdown per source for applications received in the period —
    lets HR compare pipeline quality across direct/referral/agency/talent_acquisition."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await db.execute(
        select(Application.source, Application.stage, func.count().label("count"))
        .where(Application.applied_at >= since)
        .group_by(Application.source, Application.stage)
    )).all()

    matrix: dict = {}
    for r in rows:
        source = r.source or "direct"
        matrix.setdefault(source, {})[r.stage] = r.count

    result = []
    for source, stage_map in matrix.items():
        total = sum(stage_map.values())
        result.append({
            "source": source,
            "total": total,
            "hired": stage_map.get("hired", 0),
            "rejected": stage_map.get("rejected", 0),
            "conversion_rate": round((stage_map.get("hired", 0) / total) * 100, 1) if total else 0,
            "by_stage": [{"stage": s, "count": stage_map.get(s, 0)} for s in PIPELINE_STAGES],
        })
    result.sort(key=lambda x: -x["total"])
    return result


@router.get("/job-performance")
async def job_performance(
    days: int = Query(90, ge=1, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Per-job hiring analytics for applications received in the period —
    volume, current outcomes and conversion for each role, so HR can see which
    openings are drawing candidates and converting them."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    rows = (await db.execute(
        select(
            Job.id.label("job_id"),
            Job.title.label("title"),
            Job.status.label("status"),
            Department.name.label("department"),
            Application.stage,
            func.count().label("count"),
        )
        .select_from(Application)
        .join(Job, Application.job_id == Job.id)
        .join(Department, Job.department_id == Department.id, isouter=True)
        .where(Application.applied_at >= since)
        .group_by(Job.id, Job.title, Job.status, Department.name, Application.stage)
    )).all()

    jobs: dict = {}
    for r in rows:
        job = jobs.setdefault(str(r.job_id), {
            "job_id": str(r.job_id),
            "title": r.title,
            "status": r.status,
            "department": r.department,
            "stage_map": {},
        })
        job["stage_map"][r.stage] = job["stage_map"].get(r.stage, 0) + r.count

    result = []
    for job in jobs.values():
        stage_map = job.pop("stage_map")
        total = sum(stage_map.values())
        hired = stage_map.get("hired", 0)
        rejected = stage_map.get("rejected", 0)
        withdrawn = stage_map.get("withdrawn", 0)
        in_progress = total - hired - rejected - withdrawn
        result.append({
            **job,
            "total_applications": total,
            "in_progress": in_progress,
            "hired": hired,
            "rejected": rejected,
            "conversion_rate": round((hired / total) * 100, 1) if total else 0,
            "by_stage": [{"stage": s, "count": stage_map.get(s, 0)} for s in PIPELINE_STAGES],
        })
    result.sort(key=lambda x: -x["total_applications"])
    return result


@router.get("/job-bottleneck/{job_id}")
async def job_bottleneck(
    job_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Deep per-job drill-down for the weekly review: who is currently stuck and
    for how long, why candidates are actually dropping off this specific role,
    which stage is the systemic historical bottleneck, and what moved this week.
    Point-in-time (not `days`-scoped) — this is a live health check on one req,
    not a period report."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    hiring_manager = await db.get(User, job.hiring_manager_id) if job.hiring_manager_id else None
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    # --- current snapshot ---
    stage_rows = (await db.execute(
        select(Application.stage, func.count())
        .where(Application.job_id == job_id)
        .group_by(Application.stage)
    )).all()
    stage_map = {stage: count for stage, count in stage_rows}
    total = sum(stage_map.values())
    terminal_count = sum(stage_map.get(s, 0) for s in TERMINAL_STAGES)

    # --- stuck: sitting in a non-terminal stage past STUCK_THRESHOLD_DAYS with no move ---
    days_stuck_expr = func.extract("epoch", func.now() - Application.stage_updated_at) / 86400.0
    stuck_rows = (await db.execute(
        select(
            Application.id, Application.stage, Application.assigned_to,
            User.full_name, User.email,
            days_stuck_expr.label("days_stuck"),
        )
        .join(User, Application.applicant_id == User.id)
        .where(
            Application.job_id == job_id,
            Application.stage.notin_(TERMINAL_STAGES),
            days_stuck_expr >= STUCK_THRESHOLD_DAYS,
        )
        .order_by(days_stuck_expr.desc())
    )).all()

    assignee_ids = {r.assigned_to for r in stuck_rows if r.assigned_to}
    assignee_names = {}
    if assignee_ids:
        assignee_rows = (await db.execute(select(User.id, User.full_name).where(User.id.in_(assignee_ids)))).all()
        assignee_names = {uid: name for uid, name in assignee_rows}

    stuck_candidates = [{
        "application_id": str(r.id),
        "applicant_name": r.full_name,
        "applicant_email": r.email,
        "stage": r.stage,
        "stage_label": STAGE_LABELS.get(r.stage, r.stage),
        "days_stuck": round(float(r.days_stuck), 1),
        "assigned_to_name": assignee_names.get(r.assigned_to),
    } for r in stuck_rows]

    # --- historical avg time-in-stage, derived from real stage transitions only.
    # A history row is a real move when to_stage isn't the "_note" pseudo-stage and
    # differs from from_stage (both a plain note and a same-job "moved job" record
    # set from_stage == to_stage and must not be counted as a transition).
    history_rows = (await db.execute(
        select(
            ApplicationStageHistory.application_id, ApplicationStageHistory.to_stage,
            ApplicationStageHistory.created_at, Application.applied_at,
        )
        .join(Application, ApplicationStageHistory.application_id == Application.id)
        .where(
            Application.job_id == job_id,
            ApplicationStageHistory.to_stage != "_note",
            ApplicationStageHistory.from_stage != ApplicationStageHistory.to_stage,
        )
        .order_by(ApplicationStageHistory.application_id, ApplicationStageHistory.created_at)
    )).all()

    stage_durations: dict[str, list[float]] = {}
    prev_app_id = None
    prev_time = prev_stage = None
    for r in history_rows:
        if r.application_id != prev_app_id:
            prev_time, prev_stage = r.applied_at, "applied"
        days = (r.created_at - prev_time).total_seconds() / 86400.0
        stage_durations.setdefault(prev_stage, []).append(days)
        prev_app_id, prev_time, prev_stage = r.application_id, r.created_at, r.to_stage

    avg_time_in_stage = [
        {
            "stage": stage,
            "stage_label": STAGE_LABELS.get(stage, stage),
            "avg_days": round(sum(days_list) / len(days_list), 1),
            "sample_size": len(days_list),
        }
        for stage, days_list in stage_durations.items() if stage not in TERMINAL_STAGES
    ]
    avg_time_in_stage.sort(key=lambda x: _ALL_STAGES.index(x["stage"]) if x["stage"] in _ALL_STAGES else 99)

    # --- why candidates are actually dropping off THIS job (all-time — a 7-day
    # slice would be too sparse on most reqs to mean anything) ---
    drop_rows = (await db.execute(
        select(Application.drop_category, func.count())
        .where(Application.job_id == job_id, Application.stage.in_(_DROP_STAGES))
        .group_by(Application.drop_category)
    )).all()
    drop_reasons = [{
        "category": category or "not_categorized",
        "label": _DROP_CATEGORY_LABELS.get(category, "Not categorized"),
        "count": count,
    } for category, count in drop_rows]
    drop_reasons.sort(key=lambda x: -x["count"])

    # --- this week's activity, so the report reads as "what changed" not just a snapshot ---
    new_applications = (await db.execute(
        select(func.count()).where(Application.job_id == job_id, Application.applied_at >= week_ago)
    )).scalar() or 0
    week_moves = [
        r.to_stage for r in (await db.execute(
            select(ApplicationStageHistory.to_stage)
            .join(Application, ApplicationStageHistory.application_id == Application.id)
            .where(
                Application.job_id == job_id,
                ApplicationStageHistory.created_at >= week_ago,
                ApplicationStageHistory.to_stage != "_note",
                ApplicationStageHistory.from_stage != ApplicationStageHistory.to_stage,
            )
        )).all()
    ]

    return {
        "job_id": str(job.id),
        "title": job.title,
        "status": job.status,
        "hiring_manager_name": hiring_manager.full_name if hiring_manager else None,
        "stuck_threshold_days": STUCK_THRESHOLD_DAYS,
        "total_applications": total,
        "in_progress": total - terminal_count,
        "hired": stage_map.get("hired", 0),
        "by_stage": [
            {"stage": s, "stage_label": STAGE_LABELS.get(s, s), "count": stage_map.get(s, 0)}
            for s in _ALL_STAGES
        ],
        "stuck_candidates": stuck_candidates,
        "avg_time_in_stage": avg_time_in_stage,
        "drop_reasons": drop_reasons,
        "weekly_activity": {
            "new_applications": new_applications,
            "stage_moves": len(week_moves),
            "drops": sum(1 for s in week_moves if s in _DROP_STAGES),
            "hires": sum(1 for s in week_moves if s == "hired"),
        },
    }


@router.get("/referral-performance")
async def referral_performance(
    days: int = Query(90, ge=1, le=365),
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
    days: int = Query(180, ge=1, le=365),
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
    days: int = Query(90, ge=1, le=365),
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
                "applied", "screening", "assessment", "tr1", "tr2", "final_tr", "hr", "offer", "hired", "rejected"
            ]],
        })

    result.sort(key=lambda x: x["total_submitted"], reverse=True)
    return result


ReportKey = Literal["funnel", "pipeline", "trend", "job", "source", "referral", "tth", "agency"]


async def _fetch_report_data(report: str, *, db: AsyncSession, days: int, bucket: str = "day"):
    """Dispatches to the existing GET handlers' underlying logic — calls them
    directly as plain Python functions rather than duplicating their query
    code. The `_=Depends(require_roles(...))` default parameter is simply
    overridden with None here since dependency injection only happens at the
    HTTP layer; auth for these calls is already enforced by the export/email
    endpoint's own require_roles dependency."""
    if report == "funnel":
        return await hiring_funnel(department_id=None, days=days, source=None, _=None, db=db)
    if report == "pipeline":
        return await pipeline_snapshot(_=None, db=db)
    if report == "trend":
        return await applications_trend(days=days, bucket=bucket, _=None, db=db)
    if report == "job":
        return await job_performance(days=days, _=None, db=db)
    if report == "source":
        return await source_analysis(days=days, _=None, db=db)
    if report == "referral":
        return await referral_performance(days=days, _=None, db=db)
    if report == "tth":
        return await time_to_hire_report(days=days, _=None, db=db)
    if report == "agency":
        return await agency_performance(days=days, _=None, db=db)
    raise HTTPException(400, f"Unknown report: {report}")


@router.get("/export")
async def export_report(
    report: ReportKey = Query(...),
    days: int = Query(90, ge=1, le=365),
    bucket: str = Query("day"),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.report_export_service import build_xlsx, REPORT_TITLES

    data = await _fetch_report_data(report, db=db, days=days, bucket=bucket)
    xlsx_bytes = build_xlsx(report, data)
    filename = f"{REPORT_TITLES[report].lower().replace(' ', '_')}_report.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


class ReportEmailRequest(BaseModel):
    to_emails: list[EmailStr]

    @field_validator("to_emails")
    @classmethod
    def _non_empty(cls, v: list[EmailStr]) -> list[EmailStr]:
        if not v:
            raise ValueError("At least one recipient email is required")
        if len(v) > 25:
            raise ValueError("At most 25 recipients at a time")
        return v


@router.post("/email")
async def email_report(
    data: ReportEmailRequest,
    report: ReportKey = Query(...),
    days: int = Query(90, ge=1, le=365),
    bucket: str = Query("day"),
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    import base64
    from app.services.report_export_service import build_xlsx, REPORT_TITLES
    from app.tasks.email_tasks import send_report_email_task

    report_data = await _fetch_report_data(report, db=db, days=days, bucket=bucket)
    xlsx_bytes = build_xlsx(report, report_data)
    send_report_email_task.delay(
        [str(e) for e in data.to_emails], REPORT_TITLES[report], base64.b64encode(xlsx_bytes).decode(), user.full_name,
    )
    return {"status": "queued", "recipients": len(data.to_emails)}
