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
        "agency_id": app.agency_id,
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
    from datetime import datetime, timezone, timedelta

    # Block reapplication within 6 months of any rejection
    cooloff_start = datetime.now(timezone.utc) - timedelta(days=183)
    recent_rejection = (await db.execute(
        select(Application).where(
            Application.applicant_id == applicant_id,
            Application.stage == "rejected",
            Application.stage_updated_at >= cooloff_start,
        )
    )).scalar_one_or_none()

    if recent_rejection:
        eligible_date = (recent_rejection.stage_updated_at + timedelta(days=183)).strftime("%d %B %Y")
        raise HTTPException(
            403,
            f"You are not eligible to apply at this time. You may reapply after {eligible_date}.",
        )

    existing = await db.execute(
        select(Application).where(
            Application.job_id == data.job_id,
            Application.applicant_id == applicant_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "You have already applied for this job")

    agency_id = None
    agency_ref = data.agency_ref
    if agency_ref:
        from app.models.agency import JobAgencyAssignment
        from app.models.application import Application as App
        assignment = (await db.execute(
            select(JobAgencyAssignment).where(JobAgencyAssignment.ref_token == agency_ref)
        )).scalar_one_or_none()
        if assignment and str(assignment.job_id) == str(data.job_id):
            agency_id = assignment.agency_id

    # Persist candidate profile fields (profile is the source of truth)
    from app.schemas.application import PROFILE_FIELDS
    from app.models.candidate_profile import CandidateProfile
    from app.models.user import User as UserModel

    user = await db.get(UserModel, applicant_id)
    if user and data.date_of_birth:
        user.date_of_birth = data.date_of_birth

    profile = await db.get(CandidateProfile, applicant_id)
    if not profile:
        profile = CandidateProfile(user_id=applicant_id)
        db.add(profile)
    profile.current_company = data.current_company
    profile.current_designation = data.current_designation
    profile.total_experience = data.total_experience
    profile.current_location = data.current_location
    profile.education = data.education
    if data.skills is not None:
        profile.skills = data.skills

    source = "referral" if data.referral_id else ("agency" if agency_id else "direct")
    create_data = data.model_dump(exclude={"agency_ref", *PROFILE_FIELDS})
    application = Application(
        applicant_id=applicant_id,
        source=source,
        agency_id=agency_id,
        **create_data,
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
    agency_id: Optional[uuid.UUID] = None,
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
    if agency_id:
        filters.append(Application.agency_id == agency_id)

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
    from app.models.candidate_profile import CandidateProfile

    row = (await db.execute(
        select(Application, User.full_name, User.email, User.avatar_url, User.date_of_birth)
        .join(User, User.id == Application.applicant_id)
        .where(Application.id == application_id)
    )).first()

    if not row:
        raise HTTPException(404, "Application not found")

    app, full_name, email, avatar_url, date_of_birth = row
    profile = await db.get(CandidateProfile, app.applicant_id)

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
    d["date_of_birth"] = date_of_birth
    d["candidate_profile"] = {
        "current_company": profile.current_company if profile else None,
        "current_designation": profile.current_designation if profile else None,
        "total_experience": profile.total_experience if profile else None,
        "current_location": profile.current_location if profile else None,
        "skills": profile.skills if profile else None,
        "education": profile.education if profile else None,
    }

    return ApplicationDetailResponse.model_validate(d)


async def move_stage(
    db: AsyncSession,
    application_id: uuid.UUID,
    new_stage: str,
    moved_by: uuid.UUID,
    notes: Optional[str] = None,
    rejection_reason: Optional[str] = None,
) -> Application:
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")

    allowed = VALID_TRANSITIONS.get(app.stage, [])
    if new_stage not in allowed:
        raise HTTPException(400, f"Cannot move from '{app.stage}' to '{new_stage}'")

    if new_stage == "hired":
        from app.models.offer import OfferLetter
        from sqlalchemy import select as _select
        offer = (await db.execute(
            _select(OfferLetter).where(OfferLetter.application_id == application_id)
        )).scalar_one_or_none()
        if not offer or offer.status != "accepted" or not offer.candidate_signature:
            raise HTTPException(
                400,
                "Cannot mark as hired — candidate must accept and digitally sign the offer letter first."
            )

    from_stage = app.stage

    history = ApplicationStageHistory(
        application_id=application_id,
        from_stage=from_stage,
        to_stage=new_stage,
        changed_by=moved_by,
        notes=notes,
    )
    db.add(history)

    app.stage = new_stage
    app.stage_updated_at = datetime.utcnow()
    if new_stage == "rejected" and rejection_reason:
        app.rejection_reason = rejection_reason

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
        send_stage_update_email.delay(str(application_id), new_stage, from_stage)
    except Exception:
        pass

    if app.agency_id:
        try:
            from app.tasks.email_tasks import send_agency_stage_update_email
            send_agency_stage_update_email.delay(str(application_id), new_stage)
        except Exception:
            pass

    if new_stage == "offer":
        try:
            from app.services.document_service import get_or_create_request
            await get_or_create_request(db, application_id)
            from app.tasks.email_tasks import send_document_request_email_task
            send_document_request_email_task.delay(str(application_id))
        except Exception:
            pass

    if new_stage == "hired":
        try:
            from app.models.user import User
            candidate = await db.get(User, app.applicant_id)
            if candidate and candidate.role == "applicant":
                candidate.role = "employee"
                await db.commit()
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
