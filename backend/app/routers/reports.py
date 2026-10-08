import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_

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

KNOWN_SOURCES = ["direct", "referral", "agency", "talent_acquisition", "campus"]

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
        from app.constants.stages import outcome_counts

        stage_map = job.pop("stage_map")
        oc = outcome_counts(stage_map)
        total, hired, rejected, in_progress = oc["total"], oc["hired"], oc["not_proceeding"], oc["in_progress"]
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

        from app.constants.stages import outcome_counts

        stage_map = {r.stage: r.count for r in rows}
        oc = outcome_counts(stage_map)
        total, hired, rejected, in_progress = oc["total"], oc["hired"], oc["not_proceeding"], oc["in_progress"]

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


# Campus stages after the assessment. Campus candidates sit the assessment
# BEFORE the HR screening call (AGENCY_VALID_TRANSITIONS), so "screening" here
# means they cleared it.
_PAST_CAMPUS_ASSESSMENT = ("screening", "tr1", "tr2", "final_tr", "hr", "offer", "hired")


@router.get("/campus-performance")
async def campus_performance(
    days: int = Query(365, ge=1, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Per-campus drive output: students, how many were assessed and cleared
    it, outcomes. Three grouped queries regardless of campus count (the
    agency report's per-agency loop is N+1). Inactive campuses are included —
    the Campuses page lists them under "All"/"Inactive" and their history is
    still real."""
    from app.models.campus import Campus, JobCampusAssignment
    from app.models.assessment import Assessment
    from app.constants.stages import outcome_counts

    since = datetime.now(timezone.utc) - timedelta(days=days)
    in_window = and_(Application.campus_id.isnot(None), Application.applied_at >= since)

    stage_rows = (await db.execute(
        select(Application.campus_id, Application.stage, func.count().label("n"))
        .where(in_window)
        .group_by(Application.campus_id, Application.stage)
    )).all()

    assessed = select(Assessment.application_id).where(Assessment.status != "cancelled").distinct().subquery()
    assess_rows = (await db.execute(
        select(
            Application.campus_id,
            func.count().label("assessed"),
            func.count().filter(Application.stage.in_(_PAST_CAMPUS_ASSESSMENT)).label("cleared"),
        )
        .join(assessed, assessed.c.application_id == Application.id)
        .where(in_window)
        .group_by(Application.campus_id)
    )).all()

    drive_rows = (await db.execute(
        select(JobCampusAssignment.campus_id, func.count().label("n"))
        .where(JobCampusAssignment.created_at >= since)
        .group_by(JobCampusAssignment.campus_id)
    )).all()

    stages: dict = {}
    for r in stage_rows:
        stages.setdefault(r.campus_id, {})[r.stage] = r.n
    assess = {r.campus_id: r for r in assess_rows}
    drives = {r.campus_id: r.n for r in drive_rows}

    result = []
    for campus in (await db.execute(select(Campus))).scalars().all():
        oc = outcome_counts(stages.get(campus.id, {}))
        a = assess.get(campus.id)
        n_assessed = a.assessed if a else 0
        result.append({
            "campus_id": str(campus.id),
            "campus_name": campus.name,
            "drives": drives.get(campus.id, 0),
            "total_students": oc["total"],
            "in_progress": oc["in_progress"],
            "hired": oc["hired"],
            "rejected": oc["not_proceeding"],
            "assessed": n_assessed,
            "cleared_assessment": a.cleared if a else 0,
            "assessment_clear_rate": round(a.cleared / n_assessed * 100, 1) if n_assessed else None,
            "conversion_rate": round(oc["hired"] / oc["total"] * 100, 1) if oc["total"] else 0,
        })
    result.sort(key=lambda x: x["total_students"], reverse=True)
    return result


_INTERVIEW_ROUNDS = ["screening", "tr1", "tr2", "final_tr", "hr"]
_POSITIVE_RECS = {"strong_yes", "yes"}
_NEGATIVE_RECS = {"strong_no", "no"}


@router.get("/interviewer-performance")
async def interviewer_performance(
    days: int = Query(90, ge=1, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Per-interviewer interview load for interviews scheduled in the window.
    Counts only panelists with role 'interviewer' (observers excluded).
    'conducted' = interview status completed (set manually or by the
    auto-complete task once the slot ends). Round breakdown is over conducted
    interviews; round_type NULL lands in 'other'."""
    from app.models.interview import Interview, InterviewPanelist, InterviewFeedback

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)

    rows = (await db.execute(
        select(
            InterviewPanelist.user_id,
            User.full_name,
            User.email,
            Interview.id.label("interview_id"),
            Interview.status,
            Interview.round_type,
            Interview.scheduled_at,
        )
        .join(Interview, InterviewPanelist.interview_id == Interview.id)
        .join(User, InterviewPanelist.user_id == User.id)
        .where(
            InterviewPanelist.role == "interviewer",
            Interview.scheduled_at >= since,
        )
    )).all()

    interview_ids = {r.interview_id for r in rows}
    feedback: dict = {}
    if interview_ids:
        fb_rows = (await db.execute(
            select(
                InterviewFeedback.interview_id,
                InterviewFeedback.submitted_by,
                InterviewFeedback.recommendation,
                InterviewFeedback.overall_rating,
            ).where(InterviewFeedback.interview_id.in_(interview_ids))
        )).all()
        for f in fb_rows:
            feedback[(f.interview_id, f.submitted_by)] = f

    stats: dict = {}
    for r in rows:
        s = stats.setdefault(r.user_id, {
            "interviewer_id": str(r.user_id),
            "name": r.full_name,
            "email": r.email,
            "total_assigned": 0,
            "conducted": 0,
            "upcoming": 0,
            "cancelled": 0,
            "no_show": 0,
            "feedback_submitted": 0,
            "feedback_pending": 0,
            "positive": 0,
            "negative": 0,
            "neutral": 0,
            "_ratings": [],
            "by_round": {k: 0 for k in _INTERVIEW_ROUNDS + ["other"]},
            "last_interview_at": None,
        })
        s["total_assigned"] += 1
        status = r.status
        if status == "completed":
            s["conducted"] += 1
            rk = r.round_type if r.round_type in _INTERVIEW_ROUNDS else "other"
            s["by_round"][rk] += 1
            if s["last_interview_at"] is None or r.scheduled_at > s["last_interview_at"]:
                s["last_interview_at"] = r.scheduled_at
            fb = feedback.get((r.interview_id, r.user_id))
            if fb:
                s["feedback_submitted"] += 1
                if fb.recommendation in _POSITIVE_RECS:
                    s["positive"] += 1
                elif fb.recommendation in _NEGATIVE_RECS:
                    s["negative"] += 1
                elif fb.recommendation:
                    s["neutral"] += 1
                if fb.overall_rating is not None:
                    s["_ratings"].append(fb.overall_rating)
            else:
                s["feedback_pending"] += 1
        elif status == "cancelled":
            s["cancelled"] += 1
        elif status == "no_show":
            s["no_show"] += 1
        elif status in ("scheduled", "rescheduled") and r.scheduled_at > now:
            s["upcoming"] += 1

    result = []
    for s in stats.values():
        ratings = s.pop("_ratings")
        s["avg_rating"] = round(sum(ratings) / len(ratings), 1) if ratings else None
        s["feedback_rate"] = round(s["feedback_submitted"] / s["conducted"] * 100, 1) if s["conducted"] else 0
        s["by_round"] = [{"round": k, "count": v} for k, v in s["by_round"].items()]
        s["last_interview_at"] = s["last_interview_at"].isoformat() if s["last_interview_at"] else None
        result.append(s)

    result.sort(key=lambda x: (x["conducted"], x["total_assigned"]), reverse=True)
    return result


# ── Recruiter (TA) ownership ─────────────────────────────────────────────────
# Credit model (see Application.owner_id): an application belongs to whoever
# made its FIRST human stage move, permanently. Later moves by other TAs are
# "assists" — counted for the person who made them, but the candidate's
# outcome stays on the owner's line. Sourcing (sourced_by = who uploaded the
# profile) is tracked as its own column because the sourcer and the owner are
# often different people.

_REAL_MOVE = and_(
    ApplicationStageHistory.to_stage != "_note",
    ApplicationStageHistory.from_stage.isnot(None),
    ApplicationStageHistory.from_stage != ApplicationStageHistory.to_stage,
)
_RECRUITER_CORE_ROLE = Role.HR_MANAGER.value


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


@router.get("/recruiter-performance")
async def recruiter_performance(
    days: int = Query(90, ge=1, le=365),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Per-recruiter sourcing, ownership and stage-by-stage progress.

    Windows, stated precisely because they differ by column:
      - sourced            -> applications CREATED in the window with sourced_by = them
      - owned / funnel     -> applications they CLAIMED (owned_at) in the window
      - moves              -> stage moves MADE in the window (any application)
      - active_now / stale_now / unclaimed -> point-in-time, no window: the
        current load a manager needs to see regardless of the period picked.
    """
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    stale_cutoff = now - timedelta(days=STUCK_THRESHOLD_DAYS)

    stats: dict = {}

    def row_for(uid):
        return stats.setdefault(uid, {
            "sourced": 0, "sourced_hired": 0, "sourced_owned_by_others": 0,
            "owned": 0, "active": 0, "hired": 0, "not_proceeding": 0, "on_hold": 0,
            "_pickup": [], "_tth": [],
            "reached": {s: 0 for s in FUNNEL_STAGES},
            "current": {},
            "moves_total": 0, "moves_on_own": 0, "moves_on_others": 0, "moves_on_unowned": 0,
            "moves_by_others_on_mine": 0,
            "active_now": 0, "stale_now": 0,
        })

    # --- sourced ---
    for r in (await db.execute(
        select(Application.sourced_by, Application.owner_id, Application.stage)
        .where(Application.sourced_by.isnot(None), Application.created_at >= since)
    )).all():
        s = row_for(r.sourced_by)
        s["sourced"] += 1
        if r.stage == "hired":
            s["sourced_hired"] += 1
        if r.owner_id is not None and r.owner_id != r.sourced_by:
            s["sourced_owned_by_others"] += 1

    # --- owned in window + every real move on those applications ---
    owned_rows = (await db.execute(
        select(
            Application.id, Application.owner_id, Application.stage, Application.on_hold,
            Application.applied_at, Application.owned_at, Application.stage_updated_at,
        )
        .where(Application.owner_id.isnot(None), Application.owned_at >= since)
    )).all()
    reached_sets: dict = {r.id: {"applied", r.stage} for r in owned_rows}
    owned_ids = list(reached_sets)
    if owned_ids:
        for h in (await db.execute(
            select(ApplicationStageHistory.application_id, ApplicationStageHistory.to_stage)
            .join(Application, ApplicationStageHistory.application_id == Application.id)
            .where(Application.owner_id.isnot(None), Application.owned_at >= since, _REAL_MOVE)
        )).all():
            reached_sets[h.application_id].add(h.to_stage)

    for r in owned_rows:
        s = row_for(r.owner_id)
        s["owned"] += 1
        s["current"][r.stage] = s["current"].get(r.stage, 0) + 1
        if r.stage == "hired":
            s["hired"] += 1
            s["_tth"].append((r.stage_updated_at - r.applied_at).total_seconds() / 86400)
        elif r.stage in TERMINAL_STAGES:
            s["not_proceeding"] += 1
        else:
            s["active"] += 1
            if r.on_hold:
                s["on_hold"] += 1
        s["_pickup"].append(max(0.0, (r.owned_at - r.applied_at).total_seconds() / 86400))
        for st in reached_sets[r.id]:
            if st in s["reached"]:
                s["reached"][st] += 1

    # --- moves made in the window, split by whose candidate it was ---
    for r in (await db.execute(
        select(ApplicationStageHistory.changed_by, Application.owner_id, func.count().label("n"))
        .join(Application, ApplicationStageHistory.application_id == Application.id)
        .where(
            ApplicationStageHistory.created_at >= since,
            ApplicationStageHistory.changed_by.isnot(None),
            _REAL_MOVE,
        )
        .group_by(ApplicationStageHistory.changed_by, Application.owner_id)
    )).all():
        mover = row_for(r.changed_by)
        mover["moves_total"] += r.n
        if r.owner_id == r.changed_by:
            mover["moves_on_own"] += r.n
        elif r.owner_id is None:
            mover["moves_on_unowned"] += r.n
        else:
            mover["moves_on_others"] += r.n
            row_for(r.owner_id)["moves_by_others_on_mine"] += r.n

    # --- current load (point-in-time) ---
    for r in (await db.execute(
        select(
            Application.owner_id,
            func.count().label("active"),
            func.count().filter(
                Application.stage_updated_at < stale_cutoff, Application.on_hold.is_(False),
            ).label("stale"),
        )
        .where(Application.owner_id.isnot(None), Application.stage.notin_(TERMINAL_STAGES))
        .group_by(Application.owner_id)
    )).all():
        s = row_for(r.owner_id)
        s["active_now"], s["stale_now"] = r.active, r.stale

    unclaimed = (await db.execute(
        select(func.count(), func.min(Application.applied_at))
        .where(Application.owner_id.is_(None), Application.stage.notin_(TERMINAL_STAGES))
    )).one()

    # Every active TA is listed even at zero — an idle recruiter is exactly
    # what a manager wants to see. Admins only appear if they did something.
    core_ta = and_(User.role == _RECRUITER_CORE_ROLE, User.is_active.is_(True))
    people = {
        u.id: u for u in (await db.execute(
            select(User).where(or_(User.id.in_(list(stats)), core_ta) if stats else core_ta)
        )).scalars().all()
    }

    recruiters = []
    for uid, u in people.items():
        s = row_for(uid)
        pickup, tth = s.pop("_pickup"), s.pop("_tth")
        closed = s["hired"] + s["not_proceeding"]
        recruiters.append({
            "user_id": str(uid),
            "name": u.full_name,
            "email": u.email,
            "role": u.role,
            "is_active": u.is_active,
            **{k: v for k, v in s.items() if k not in ("reached", "current")},
            "conversion_rate": round(s["hired"] / s["owned"] * 100, 1) if s["owned"] else 0,
            "close_rate": round(s["hired"] / closed * 100, 1) if closed else None,
            "avg_pickup_days": _avg(pickup),
            "avg_days_to_hire": _avg(tth),
            "reached": [{"stage": st, "count": s["reached"][st]} for st in FUNNEL_STAGES],
            "current": [{"stage": st, "count": c} for st, c in s["current"].items()],
        })
    recruiters.sort(key=lambda x: (x["owned"], x["sourced"], x["moves_total"]), reverse=True)

    def total(key):
        return sum(r[key] for r in recruiters)

    return {
        "window_days": days,
        "stuck_threshold_days": STUCK_THRESHOLD_DAYS,
        "team": {
            "sourced": total("sourced"),
            "owned": total("owned"),
            "hired": total("hired"),
            "active_now": total("active_now"),
            "stale_now": total("stale_now"),
            "moves": total("moves_total"),
            "assists": total("moves_on_others"),
            "unclaimed_now": unclaimed[0] or 0,
            "unclaimed_oldest_days": (
                round((now - unclaimed[1]).total_seconds() / 86400, 1) if unclaimed[1] else None
            ),
        },
        "recruiters": recruiters,
    }


@router.get("/recruiter-performance/{user_id}/applications")
async def recruiter_applications(
    user_id: uuid.UUID,
    days: int = Query(90, ge=1, le=365),
    scope: Literal["owned", "sourced", "active"] = Query("owned"),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Drill-down for one recruiter: each candidate with the full stage trail
    (who made every move, and whether it was the owner or an assist).
    scope=owned  -> claimed in the window
    scope=sourced -> uploaded by them in the window
    scope=active -> everything they own that is still in flight, any age."""
    from sqlalchemy.orm import aliased

    person = await db.get(User, user_id)
    if not person:
        raise HTTPException(404, "User not found")

    since = datetime.now(timezone.utc) - timedelta(days=days)
    Candidate, Owner, Sourcer = aliased(User), aliased(User), aliased(User)

    where = {
        "owned": [Application.owner_id == user_id, Application.owned_at >= since],
        "sourced": [Application.sourced_by == user_id, Application.created_at >= since],
        "active": [Application.owner_id == user_id, Application.stage.notin_(TERMINAL_STAGES)],
    }[scope]

    apps = (await db.execute(
        select(
            Application.id, Application.stage, Application.source, Application.on_hold,
            Application.applied_at, Application.owned_at, Application.stage_updated_at,
            Application.owner_id,
            Candidate.full_name.label("candidate_name"), Candidate.email.label("candidate_email"),
            Job.id.label("job_id"), Job.title.label("job_title"),
            Owner.full_name.label("owner_name"), Sourcer.full_name.label("sourced_by_name"),
        )
        .join(Candidate, Candidate.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .join(Owner, Owner.id == Application.owner_id, isouter=True)
        .join(Sourcer, Sourcer.id == Application.sourced_by, isouter=True)
        .where(*where)
        .order_by(Application.stage_updated_at.desc())
        .limit(500)
    )).all()

    trails: dict = {a.id: [] for a in apps}
    if trails:
        Mover = aliased(User)
        for h in (await db.execute(
            select(
                ApplicationStageHistory.application_id, ApplicationStageHistory.from_stage,
                ApplicationStageHistory.to_stage, ApplicationStageHistory.created_at,
                ApplicationStageHistory.changed_by, Mover.full_name.label("by_name"),
            )
            .join(Mover, Mover.id == ApplicationStageHistory.changed_by, isouter=True)
            .where(ApplicationStageHistory.application_id.in_(list(trails)), _REAL_MOVE)
            .order_by(ApplicationStageHistory.created_at)
        )).all():
            trails[h.application_id].append(h)

    now = datetime.now(timezone.utc)
    items = []
    for a in apps:
        items.append({
            "application_id": str(a.id),
            "candidate_name": a.candidate_name,
            "candidate_email": a.candidate_email,
            "job_id": str(a.job_id),
            "job_title": a.job_title,
            "source": a.source,
            "stage": a.stage,
            "stage_label": STAGE_LABELS.get(a.stage, a.stage),
            "on_hold": a.on_hold,
            "is_terminal": a.stage in TERMINAL_STAGES,
            "applied_at": a.applied_at.isoformat(),
            "owned_at": a.owned_at.isoformat() if a.owned_at else None,
            "owner_name": a.owner_name,
            "sourced_by_name": a.sourced_by_name,
            "days_in_stage": round((now - a.stage_updated_at).total_seconds() / 86400, 1),
            "trail": [
                {
                    "from_stage": h.from_stage,
                    "to_stage": h.to_stage,
                    "to_label": STAGE_LABELS.get(h.to_stage, h.to_stage),
                    "at": h.created_at.isoformat(),
                    "by_name": h.by_name or ("System" if h.changed_by is None else "Unknown"),
                    "by_owner": h.changed_by is not None and h.changed_by == a.owner_id,
                    "by_system": h.changed_by is None,
                }
                for h in trails[a.id]
            ],
        })

    return {
        "user_id": str(person.id),
        "name": person.full_name,
        "scope": scope,
        "stuck_threshold_days": STUCK_THRESHOLD_DAYS,
        "truncated": len(items) == 500,
        "items": items,
    }


ReportKey = Literal["funnel", "pipeline", "trend", "job", "source", "referral", "tth", "agency", "interviewer", "recruiter"]


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
    if report == "interviewer":
        return await interviewer_performance(days=days, _=None, db=db)
    if report == "recruiter":
        return await recruiter_performance(days=days, _=None, db=db)
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
