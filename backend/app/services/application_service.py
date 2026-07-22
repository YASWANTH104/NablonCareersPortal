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
    from app.services.storage_service import refresh_url

    return {
        "id": app.id,
        "job_id": app.job_id,
        "applicant_id": app.applicant_id,
        "referral_id": app.referral_id,
        # Re-signed on every read — the SAS token baked in at upload time only
        # lasts 7 days, so serving the stored value as-is breaks any resume
        # older than that with an "AuthenticationFailed ... signed expiry"
        # error from Azure.
        "resume_url": refresh_url(app.resume_url),
        "cover_letter": app.cover_letter,
        "linkedin_url": app.linkedin_url,
        "portfolio_url": app.portfolio_url,
        "github_url": app.github_url,
        "current_ctc": app.current_ctc,
        "expected_ctc": app.expected_ctc,
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


async def submit_sourced_application(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    full_name: str,
    email: str,
    resume_url: str,
    source: str,
    agency_id: Optional[uuid.UUID] = None,
    phone: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    portfolio_url: Optional[str] = None,
    github_url: Optional[str] = None,
    cover_letter: Optional[str] = None,
    current_location: Optional[str] = None,
    total_experience: Optional[str] = None,
    current_company: Optional[str] = None,
    current_designation: Optional[str] = None,
    education: Optional[str] = None,
    skills: Optional[str] = None,
    current_ctc: Optional[str] = None,
    expected_ctc: Optional[str] = None,
) -> Application:
    """Create an application on behalf of a candidate (agency upload or HR/TA sourcing).

    Finds the candidate user by email or creates a passwordless account
    (they can claim it via the forgot-password flow). Skips the rejection
    cool-off check — HR is knowingly inserting this candidate."""
    import secrets
    from datetime import timedelta, timezone
    from app.models.user import User as UserModel
    from app.models.candidate_profile import CandidateProfile
    from app.models.job import Job
    from app.utils.security import hash_password, generate_token

    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    email = email.strip().lower()
    user = (await db.execute(
        select(UserModel).where(func.lower(UserModel.email) == email)
    )).scalar_one_or_none()

    if user and user.role not in ("applicant", "employee"):
        raise HTTPException(400, "This email belongs to an internal user account")

    is_new_user = not user
    if not user:
        # No password is set on a sourced account — the candidate claims it via the
        # set-password link in send_sourced_application_welcome_email (a proactively
        # generated password_reset_token), or the standard /forgot-password flow later.
        user = UserModel(
            email=email,
            full_name=full_name.strip(),
            password_hash=hash_password(secrets.token_urlsafe(24)),
            role="applicant",
            phone=phone,
            is_verified=False,
            password_reset_token=generate_token(),
            password_reset_expires=datetime.now(timezone.utc) + timedelta(days=7),
        )
        db.add(user)
        await db.flush()
    elif phone and not user.phone:
        user.phone = phone

    existing = (await db.execute(
        select(Application).where(
            Application.job_id == job_id,
            Application.applicant_id == user.id,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "This candidate has already been submitted for this job")

    profile = await db.get(CandidateProfile, user.id)
    if not profile:
        profile = CandidateProfile(user_id=user.id)
        db.add(profile)
    for field, val in (
        ("current_location", current_location),
        ("total_experience", total_experience),
        ("current_company", current_company),
        ("current_designation", current_designation),
        ("education", education),
        ("skills", skills),
    ):
        if val and val.strip():
            setattr(profile, field, val.strip())

    application = Application(
        job_id=job_id,
        applicant_id=user.id,
        resume_url=resume_url,
        source=source,
        agency_id=agency_id,
        cover_letter=cover_letter,
        linkedin_url=linkedin_url,
        portfolio_url=portfolio_url,
        github_url=github_url,
        current_ctc=(current_ctc.strip() if current_ctc and current_ctc.strip() else None),
        expected_ctc=(expected_ctc.strip() if expected_ctc and expected_ctc.strip() else None),
    )
    db.add(application)
    await db.commit()
    await db.refresh(application)

    try:
        if is_new_user:
            from app.tasks.email_tasks import send_sourced_application_welcome_email
            send_sourced_application_welcome_email.delay(str(application.id))
        else:
            from app.tasks.email_tasks import send_application_received_email
            send_application_received_email.delay(str(application.id))
    except Exception:
        pass

    return application


MAX_BULK_RESUMES = 20
MAX_BULK_EXCEL_ROWS = 300


async def bulk_submit_from_resumes(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    source: str,
    files: list[tuple[str, bytes, str]],
    agency_id: Optional[uuid.UUID] = None,
) -> list[dict]:
    """Parse each uploaded resume and create a sourced application from it —
    no manual re-entry per candidate, since that would defeat the point of a
    bulk upload. Each file is fully independent: a failure on one (duplicate
    application, unreadable file, missing name/email) is recorded and the rest
    still get processed. The session is rolled back after every failure so a
    partially-flushed row from one file can never leak into the next file's
    transaction (see note below on why that matters)."""
    from app.services import resume_parsing_service, storage_service

    results: list[dict] = []
    for filename, content, content_type in files:
        try:
            parsed = await resume_parsing_service.parse_resume(content, content_type, filename)
            full_name = parsed.get("full_name")
            email = parsed.get("email")
            if not full_name or not email:
                results.append({
                    "filename": filename,
                    "status": "error",
                    "error": "Could not detect a name and email on this resume — add this candidate manually.",
                })
                continue

            resume_url = await storage_service.upload_resume_bytes(content, filename, content_type, "hr-bulk")
            application = await submit_sourced_application(
                db,
                job_id=job_id,
                full_name=full_name,
                email=email,
                resume_url=resume_url,
                source=source,
                agency_id=agency_id,
                phone=parsed.get("phone"),
                linkedin_url=parsed.get("linkedin_url"),
                portfolio_url=parsed.get("portfolio_url"),
                github_url=parsed.get("github_url"),
                current_location=parsed.get("current_location"),
                total_experience=parsed.get("total_experience"),
                current_company=parsed.get("current_company"),
                current_designation=parsed.get("current_designation"),
                education=parsed.get("education"),
                skills=parsed.get("skills"),
            )
            results.append({
                "filename": filename,
                "status": "success",
                "application_id": str(application.id),
                "candidate_name": full_name,
                "email": email,
            })
        except HTTPException as exc:
            await db.rollback()
            results.append({"filename": filename, "status": "error", "error": str(exc.detail)})
        except Exception:
            await db.rollback()
            results.append({"filename": filename, "status": "error", "error": "Unexpected error while processing this file."})

    return results


# Column headers accepted in the bulk-upload spreadsheet, matched case/space-insensitively.
EXCEL_COLUMN_ALIASES = {
    "full name": "full_name", "name": "full_name", "candidate name": "full_name",
    "email": "email", "email address": "email",
    "phone": "phone", "phone number": "phone", "mobile": "phone",
    "current location": "current_location", "location": "current_location",
    "total experience": "total_experience", "experience": "total_experience",
    "current company": "current_company", "company": "current_company",
    "current designation": "current_designation", "designation": "current_designation", "title": "current_designation",
    "education": "education",
    "skills": "skills",
    "linkedin": "linkedin_url", "linkedin url": "linkedin_url",
    "current ctc": "current_ctc", "current_ctc": "current_ctc",
    "expected ctc": "expected_ctc", "expected_ctc": "expected_ctc",
}


def parse_bulk_excel(content: bytes) -> list[dict]:
    """Reads the bulk-upload spreadsheet into a list of row dicts keyed by our
    field names (header matching is case/space-insensitive via EXCEL_COLUMN_ALIASES).
    Raises HTTPException(400) if it isn't a readable spreadsheet or has no
    recognizable header row."""
    import io
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        header = next(rows_iter, None)
    except Exception as exc:
        raise HTTPException(400, f"Could not read this spreadsheet: {exc}")

    if not header:
        raise HTTPException(400, "The spreadsheet is empty.")

    field_by_col = {}
    for i, cell in enumerate(header):
        key = (str(cell).strip().lower() if cell is not None else "")
        if key in EXCEL_COLUMN_ALIASES:
            field_by_col[i] = EXCEL_COLUMN_ALIASES[key]

    if "full_name" not in field_by_col.values() or "email" not in field_by_col.values():
        raise HTTPException(
            400,
            "The spreadsheet must have at least 'Full Name' and 'Email' columns "
            "(Phone, Current Location, Total Experience, Current Company, "
            "Current Designation, Education, Skills, LinkedIn, Current CTC and "
            "Expected CTC are optional).",
        )

    # Row numbers are tracked against the real spreadsheet (header = row 1) so
    # results reported back to HR line up with what they see in Excel — rows
    # with some data but a missing name/email are kept (not silently dropped)
    # so bulk_submit_from_excel can report them as failed rows instead of the
    # row count just quietly not matching what was uploaded.
    rows = []
    for row_num, row in enumerate(rows_iter, start=2):
        if row is None or all(c is None for c in row):
            continue
        record = {"_row": row_num}
        for i, val in field_by_col.items():
            if i < len(row) and row[i] is not None:
                record[val] = str(row[i]).strip()
        rows.append(record)

    return rows


async def bulk_submit_from_excel(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    source: str,
    rows: list[dict],
    agency_id: Optional[uuid.UUID] = None,
) -> list[dict]:
    """Create a sourced application per spreadsheet row. No resume is required
    for this path (resume_url is stored as '' — the Resume tab shows a
    'no resume provided' state for these instead of a broken preview)."""
    results: list[dict] = []
    for row in rows:
        i = row.get("_row")
        full_name = row.get("full_name")
        email = row.get("email")
        if not full_name or not email:
            results.append({
                "row": i, "status": "error", "candidate_name": full_name, "email": email,
                "error": "Missing Full Name or Email — this row was skipped.",
            })
            continue
        try:
            application = await submit_sourced_application(
                db,
                job_id=job_id,
                full_name=full_name,
                email=email,
                resume_url="",
                source=source,
                agency_id=agency_id,
                phone=row.get("phone"),
                linkedin_url=row.get("linkedin_url"),
                current_location=row.get("current_location"),
                total_experience=row.get("total_experience"),
                current_company=row.get("current_company"),
                current_designation=row.get("current_designation"),
                education=row.get("education"),
                skills=row.get("skills"),
                current_ctc=row.get("current_ctc"),
                expected_ctc=row.get("expected_ctc"),
            )
            results.append({
                "row": i, "status": "success", "application_id": str(application.id),
                "candidate_name": full_name, "email": email,
            })
        except HTTPException as exc:
            await db.rollback()
            results.append({"row": i, "status": "error", "candidate_name": full_name, "email": email, "error": str(exc.detail)})
        except Exception:
            await db.rollback()
            results.append({"row": i, "status": "error", "candidate_name": full_name, "email": email, "error": "Unexpected error processing this row."})

    return results


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


# Candidate may self-edit only while the application is early in the pipeline.
# HR/admins can edit throughout (see update_application).
CANDIDATE_EDITABLE_STAGES = ("applied", "screening")
_HR_EDIT_ROLES = ("hr_manager", "admin", "super_admin")
# Fields on ApplicationUpdate that belong to CandidateProfile, not the applications table.
_PROFILE_UPDATE_FIELDS = (
    "current_location", "total_experience", "current_company",
    "current_designation", "education", "skills",
)


async def update_application(
    db: AsyncSession,
    application_id: uuid.UUID,
    current_user,
    data,
) -> Application:
    from app.models.candidate_profile import CandidateProfile
    from app.models.user import User as UserModel

    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")

    is_hr = getattr(current_user, "role", None) in _HR_EDIT_ROLES
    if not is_hr:
        # Candidate self-service: must own it and only while early-stage.
        if str(app.applicant_id) != str(current_user.id):
            raise HTTPException(403, "Not your application")
        if app.stage not in CANDIDATE_EDITABLE_STAGES:
            raise HTTPException(
                400,
                "You can only edit your details while the application is in the "
                "Applied or Screening stage. Please contact the recruiter for later changes.",
            )

    payload = data.model_dump(exclude_unset=True)

    # Route profile fields to CandidateProfile and DOB to the user record.
    profile_updates = {k: payload.pop(k) for k in _PROFILE_UPDATE_FIELDS if k in payload}
    dob = payload.pop("date_of_birth", None)

    if profile_updates:
        profile = await db.get(CandidateProfile, app.applicant_id)
        if not profile:
            profile = CandidateProfile(user_id=app.applicant_id)
            db.add(profile)
        for field, val in profile_updates.items():
            if val is not None:
                setattr(profile, field, val)

    if dob is not None:
        user = await db.get(UserModel, app.applicant_id)
        if user:
            user.date_of_birth = dob

    # Remaining keys are application-level columns.
    for field, val in payload.items():
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
