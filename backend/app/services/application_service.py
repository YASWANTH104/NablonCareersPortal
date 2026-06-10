import uuid
from datetime import datetime
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.application import Application, ApplicationStageHistory
from app.schemas.application import (
    ApplicationCreate, ApplicationResponse, ApplicationDetailResponse,
    ApplicantBrief, StageHistoryEntry,
)


VALID_TRANSITIONS = {
    "applied":    ["screening", "rejected"],
    "screening":  ["assessment", "tr1", "rejected"],
    "assessment": ["tr1", "rejected"],
    "tr1":        ["tr2", "hr", "offer", "rejected"],
    "tr2":        ["hr", "offer", "rejected"],
    "hr":         ["offer", "rejected"],
    "offer":      ["hired", "rejected"],
    "hired":      [],
    "rejected":   [],
    "withdrawn":  [],
}


def _app_to_dict(app: Application) -> dict:
    return {
        "id": app.id,
        "job_id": app.job_id,
        "applicant_id": app.applicant_id,
        "referral_id": app.referral_id,
        "resume_url": app.resume_url,
        "cover_letter": app.cover_letter,
        "linkedin_url": app.linkedin_url,
        "portfolio_url": app.portfolio_url,
        "github_url": app.github_url,
        "answers": app.answers,
        "stage": app.stage,
        "rejection_reason": app.rejection_reason,
        "source": app.source,
        "rating": app.rating,
        "is_starred": app.is_starred,
        "assigned_to": app.assigned_to,
        "applied_at": app.applied_at,
        "stage_updated_at": app.stage_updated_at,
        "created_at": app.created_at,
        "updated_at": app.updated_at,
    }


async def submit_application(
    db: AsyncSession,
    data: ApplicationCreate,
    applicant_id: uuid.UUID,
) -> Application:
    existing = await db.execute(
        select(Application).where(
            Application.job_id == data.job_id,
            Application.applicant_id == applicant_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "You have already applied for this job")

    source = "referral" if data.referral_id else "direct"
    application = Application(
        applicant_id=applicant_id,
        source=source,
        **data.model_dump(),
    )
    db.add(application)
    await db.commit()
    await db.refresh(application)

    try:
        from app.tasks.email_tasks import send_application_received_email
        send_application_received_email.delay(str(application.id))
    except Exception:
        pass

    return application


async def get_my_applications(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    page: int = 1,
    limit: int = 20,
) -> dict:
    from app.models.job import Job

    condition = Application.applicant_id == applicant_id
    total = (
        await db.execute(select(func.count()).select_from(Application).where(condition))
    ).scalar_one()

    offset = (page - 1) * limit
    rows = (
        await db.execute(
            select(Application, Job.title.label("job_title"))
            .join(Job, Job.id == Application.job_id)
            .where(condition)
            .order_by(Application.applied_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()

    items = []
    for app, job_title in rows:
        d = _app_to_dict(app)
        d["job_title"] = job_title
        items.append(ApplicationResponse.model_validate(d))

    return {"items": items, "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


async def export_applications(
    db: AsyncSession,
    job_id: Optional[uuid.UUID] = None,
    stage: Optional[str] = None,
) -> list[dict]:
    from app.models.user import User
    from app.models.job import Job

    base = (
        select(Application, User.full_name, User.email, Job.title.label("job_title"))
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
    )
    filters = []
    if job_id:
        filters.append(Application.job_id == job_id)
    if stage:
        filters.append(Application.stage == stage)
    if filters:
        base = base.where(and_(*filters))

    rows = (await db.execute(base.order_by(Application.applied_at.desc()))).all()
    result = []
    for app, full_name, email, job_title in rows:
        result.append({
            "id": str(app.id),
            "candidate_name": full_name,
            "candidate_email": email,
            "job_title": job_title,
            "stage": app.stage,
            "source": app.source,
            "rating": app.rating or "",
            "applied_at": app.applied_at.strftime("%Y-%m-%d %H:%M") if app.applied_at else "",
            "stage_updated_at": app.stage_updated_at.strftime("%Y-%m-%d %H:%M") if app.stage_updated_at else "",
            "linkedin_url": app.linkedin_url or "",
            "portfolio_url": app.portfolio_url or "",
            "github_url": app.github_url or "",
        })
    return result


async def get_all_applications(
    db: AsyncSession,
    *,
    job_id: Optional[uuid.UUID] = None,
    stage: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    from app.models.user import User

    base = (
        select(Application, User.full_name, User.email, User.avatar_url)
        .join(User, User.id == Application.applicant_id)
    )

    filters = []
    if job_id:
        filters.append(Application.job_id == job_id)
    if stage:
        filters.append(Application.stage == stage)
    if search:
        filters.append(User.full_name.ilike(f"%{search}%"))

    if filters:
        base = base.where(and_(*filters))

    count_stmt = (
        select(func.count()).select_from(Application)
        .join(User, User.id == Application.applicant_id)
    )
    if filters:
        count_stmt = count_stmt.where(and_(*filters))
    total = (await db.execute(count_stmt)).scalar_one()

    offset = (page - 1) * limit
    rows = (await db.execute(
        base.order_by(Application.applied_at.desc()).offset(offset).limit(limit)
    )).all()

    items = []
    for app, full_name, email, avatar_url in rows:
        d = _app_to_dict(app)
        d["applicant"] = {
            "id": app.applicant_id,
            "full_name": full_name,
            "email": email,
            "avatar_url": avatar_url,
        }
        items.append(ApplicationResponse.model_validate(d))

    return {"items": items, "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


async def get_application_by_id(db: AsyncSession, application_id: uuid.UUID) -> ApplicationDetailResponse:
    from app.models.user import User
    from app.models.interview import Interview

    row = (await db.execute(
        select(Application, User.full_name, User.email, User.avatar_url)
        .join(User, User.id == Application.applicant_id)
        .where(Application.id == application_id)
    )).first()

    if not row:
        raise HTTPException(404, "Application not found")

    app, full_name, email, avatar_url = row

    history = (await db.execute(
        select(ApplicationStageHistory)
        .where(ApplicationStageHistory.application_id == application_id)
        .order_by(ApplicationStageHistory.created_at.asc())
    )).scalars().all()

    interview_count = (await db.execute(
        select(func.count()).select_from(Interview).where(Interview.application_id == application_id)
    )).scalar_one()

    d = _app_to_dict(app)
    d["applicant"] = {
        "id": app.applicant_id,
        "full_name": full_name,
        "email": email,
        "avatar_url": avatar_url,
    }
    d["stage_history"] = [
        {
            "id": h.id,
            "from_stage": h.from_stage,
            "to_stage": h.to_stage,
            "notes": h.notes,
            "changed_by": h.changed_by,
            "created_at": h.created_at,
        }
        for h in history
    ]
    d["interview_count"] = interview_count

    return ApplicationDetailResponse.model_validate(d)


async def move_stage(
    db: AsyncSession,
    application_id: uuid.UUID,
    new_stage: str,
    moved_by: uuid.UUID,
    notes: Optional[str] = None,
) -> Application:
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")

    allowed = VALID_TRANSITIONS.get(app.stage, [])
    if new_stage not in allowed:
        raise HTTPException(400, f"Cannot move from '{app.stage}' to '{new_stage}'")

    history = ApplicationStageHistory(
        application_id=application_id,
        from_stage=app.stage,
        to_stage=new_stage,
        changed_by=moved_by,
        notes=notes,
    )
    db.add(history)

    app.stage = new_stage
    app.stage_updated_at = datetime.utcnow()

    _STAGE_LABELS = {
        "screening": "Screening", "assessment": "Assessment",
        "tr1": "Technical Round 1", "tr2": "Technical Round 2",
        "hr": "HR Interview", "offer": "Offer Extended",
        "hired": "Hired", "rejected": "Application Closed",
    }
    try:
        from app.models.notification import Notification
        label = _STAGE_LABELS.get(new_stage, new_stage.replace("_", " ").title())
        notif = Notification(
            user_id=app.applicant_id,
            type="stage_update",
            title=f"Application update: {label}",
            body="Your application status has been updated. View your applications for details.",
            link="/portal/applications",
        )
        db.add(notif)
    except Exception:
        pass

    await db.commit()
    await db.refresh(app)

    try:
        from app.tasks.email_tasks import send_stage_update_email
        send_stage_update_email.delay(str(application_id), new_stage)
    except Exception:
        pass

    return app


async def toggle_star(db: AsyncSession, application_id: uuid.UUID) -> Application:
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")
    app.is_starred = not app.is_starred
    await db.commit()
    await db.refresh(app)
    return app


async def set_rating(db: AsyncSession, application_id: uuid.UUID, rating: Optional[int]) -> Application:
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")
    app.rating = rating
    await db.commit()
    await db.refresh(app)
    return app


async def assign_application(
    db: AsyncSession,
    application_id: uuid.UUID,
    assignee_id: Optional[uuid.UUID],
) -> Application:
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")
    app.assigned_to = assignee_id
    await db.commit()
    await db.refresh(app)
    return app


async def add_note(
    db: AsyncSession,
    application_id: uuid.UUID,
    note: str,
    user_id: uuid.UUID,
) -> ApplicationStageHistory:
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")

    entry = ApplicationStageHistory(
        application_id=application_id,
        from_stage=app.stage,
        to_stage="_note",
        notes=note,
        changed_by=user_id,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def get_timeline(
    db: AsyncSession,
    application_id: uuid.UUID,
) -> list[ApplicationStageHistory]:
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")

    rows = (await db.execute(
        select(ApplicationStageHistory)
        .where(ApplicationStageHistory.application_id == application_id)
        .order_by(ApplicationStageHistory.created_at.asc())
    )).scalars().all()
    return list(rows)


async def update_application(
    db: AsyncSession,
    application_id: uuid.UUID,
    applicant_id: uuid.UUID,
    data,
) -> Application:
    from app.schemas.application import ApplicationUpdate
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")
    if str(app.applicant_id) != str(applicant_id):
        raise HTTPException(403, "Not your application")
    if app.stage in ("hired", "rejected", "withdrawn"):
        raise HTTPException(400, "Cannot edit a closed application")
    for field, val in data.model_dump(exclude_unset=True).items():
        if val is not None:
            setattr(app, field, val)
    app.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(app)
    return app


async def withdraw_application(
    db: AsyncSession,
    application_id: uuid.UUID,
    applicant_id: uuid.UUID,
) -> None:
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")
    if app.applicant_id != applicant_id:
        raise HTTPException(403, "Not your application")
    if app.stage in ("hired", "rejected"):
        raise HTTPException(400, "Cannot withdraw a closed application")

    app.stage = "withdrawn"
    app.stage_updated_at = datetime.utcnow()
    await db.commit()
