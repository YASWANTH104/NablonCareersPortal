import uuid
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.campus import Campus, JobCampusAssignment
from app.schemas.campus import (
    CampusCreate, CampusUpdate, CampusResponse,
    JobCampusAssignmentCreate, JobCampusAssignmentUpdate, JobCampusAssignmentResponse,
    CampusPortalResponse, CampusPortalCandidate,
)


async def create_campus(db: AsyncSession, data: CampusCreate) -> Campus:
    campus = Campus(**data.model_dump())
    db.add(campus)
    await db.commit()
    await db.refresh(campus)
    return campus


async def list_campuses(db: AsyncSession) -> list[Campus]:
    rows = (await db.execute(select(Campus).order_by(Campus.name))).scalars().all()
    return list(rows)


async def update_campus(db: AsyncSession, campus_id: uuid.UUID, data: CampusUpdate) -> Campus:
    campus = await db.get(Campus, campus_id)
    if not campus:
        raise HTTPException(404, "Campus not found")
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(campus, field, val)
    campus.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(campus)
    return campus


async def assign_campus_to_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    data: JobCampusAssignmentCreate,
) -> JobCampusAssignmentResponse:
    from app.models.job import Job

    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    campus = await db.get(Campus, data.campus_id)
    if not campus:
        raise HTTPException(404, "Campus not found")

    existing = (await db.execute(
        select(JobCampusAssignment).where(
            JobCampusAssignment.job_id == job_id,
            JobCampusAssignment.campus_id == data.campus_id,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Campus already assigned to this job")

    assignment = JobCampusAssignment(
        job_id=job_id,
        campus_id=data.campus_id,
        drive_date=data.drive_date,
        max_submissions=data.max_submissions,
        expires_at=data.expires_at,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    return JobCampusAssignmentResponse(
        id=assignment.id,
        job_id=assignment.job_id,
        campus_id=assignment.campus_id,
        ref_token=assignment.ref_token,
        drive_date=assignment.drive_date,
        max_submissions=assignment.max_submissions,
        expires_at=assignment.expires_at,
        created_at=assignment.created_at,
        campus_name=campus.name,
        job_title=job.title,
    )


async def list_assignments_for_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> list[JobCampusAssignmentResponse]:
    from app.models.job import Job

    rows = (await db.execute(
        select(JobCampusAssignment, Campus.name.label("campus_name"), Job.title.label("job_title"))
        .join(Campus, Campus.id == JobCampusAssignment.campus_id)
        .join(Job, Job.id == JobCampusAssignment.job_id)
        .where(JobCampusAssignment.job_id == job_id)
        .order_by(JobCampusAssignment.created_at.desc())
    )).all()

    return [
        JobCampusAssignmentResponse(
            id=a.id, job_id=a.job_id, campus_id=a.campus_id, ref_token=a.ref_token,
            drive_date=a.drive_date, max_submissions=a.max_submissions, expires_at=a.expires_at,
            created_at=a.created_at, campus_name=campus_name, job_title=job_title,
        )
        for a, campus_name, job_title in rows
    ]


async def list_assignments_for_campus(
    db: AsyncSession,
    campus_id: uuid.UUID,
) -> list[JobCampusAssignmentResponse]:
    from app.models.job import Job

    rows = (await db.execute(
        select(JobCampusAssignment, Campus.name.label("campus_name"), Job.title.label("job_title"))
        .join(Campus, Campus.id == JobCampusAssignment.campus_id)
        .join(Job, Job.id == JobCampusAssignment.job_id)
        .where(JobCampusAssignment.campus_id == campus_id)
        .order_by(JobCampusAssignment.created_at.desc())
    )).all()

    return [
        JobCampusAssignmentResponse(
            id=a.id, job_id=a.job_id, campus_id=a.campus_id, ref_token=a.ref_token,
            drive_date=a.drive_date, max_submissions=a.max_submissions, expires_at=a.expires_at,
            created_at=a.created_at, campus_name=campus_name, job_title=job_title,
        )
        for a, campus_name, job_title in rows
    ]


async def remove_assignment(db: AsyncSession, assignment_id: uuid.UUID) -> None:
    assignment = await db.get(JobCampusAssignment, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    await db.delete(assignment)
    await db.commit()


async def update_assignment(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    data: JobCampusAssignmentUpdate,
) -> JobCampusAssignmentResponse:
    from app.models.job import Job

    assignment = await db.get(JobCampusAssignment, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")

    updates = data.model_dump(exclude_unset=True)
    for field, val in updates.items():
        setattr(assignment, field, val)
    await db.commit()
    await db.refresh(assignment)

    campus = await db.get(Campus, assignment.campus_id)
    job = await db.get(Job, assignment.job_id)

    return JobCampusAssignmentResponse(
        id=assignment.id, job_id=assignment.job_id, campus_id=assignment.campus_id,
        ref_token=assignment.ref_token, drive_date=assignment.drive_date,
        max_submissions=assignment.max_submissions, expires_at=assignment.expires_at,
        created_at=assignment.created_at,
        campus_name=campus.name if campus else None,
        job_title=job.title if job else None,
    )


async def get_assignment_by_ref_token(
    db: AsyncSession,
    ref_token: str,
) -> JobCampusAssignment | None:
    return (await db.execute(
        select(JobCampusAssignment).where(JobCampusAssignment.ref_token == ref_token)
    )).scalar_one_or_none()


async def validate_portal_access(
    db: AsyncSession,
    portal_token: str,
    assignment_id: uuid.UUID,
) -> tuple[Campus, JobCampusAssignment]:
    """Active campus, assignment belongs to it, not expired — same shape as
    agency_service.validate_portal_access. Used for anything that acts on
    candidates already submitted (roster view, bulk assessment scheduling),
    which must not be blocked by the submission quota — see
    validate_portal_assignment below for where that quota does apply."""
    campus = (await db.execute(
        select(Campus).where(Campus.portal_token == portal_token, Campus.is_active == True)
    )).scalar_one_or_none()
    if not campus:
        raise HTTPException(404, "Campus portal not found")

    assignment = await db.get(JobCampusAssignment, assignment_id)
    if not assignment or assignment.campus_id != campus.id:
        raise HTTPException(404, "Assignment not found")

    if assignment.expires_at:
        expires = assignment.expires_at
        now = datetime.now(timezone.utc)
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < now:
            raise HTTPException(400, "This placement drive has expired")

    return campus, assignment


async def validate_portal_assignment(
    db: AsyncSession,
    portal_token: str,
    assignment_id: uuid.UUID,
) -> tuple[Campus, JobCampusAssignment]:
    """Everything validate_portal_access checks, plus the submission quota —
    used by the roster upload path, which is the one action this quota is
    meant to cap."""
    from app.models.application import Application

    campus, assignment = await validate_portal_access(db, portal_token, assignment_id)

    if assignment.max_submissions:
        count = (await db.execute(
            select(func.count()).select_from(Application).where(
                Application.campus_id == campus.id,
                Application.job_id == assignment.job_id,
            )
        )).scalar_one()
        if count >= assignment.max_submissions:
            raise HTTPException(400, "Submission limit reached for this drive")

    return campus, assignment


async def get_campus_by_portal_token(db: AsyncSession, portal_token: str) -> Campus:
    campus = (await db.execute(
        select(Campus).where(Campus.portal_token == portal_token, Campus.is_active == True)
    )).scalar_one_or_none()
    if not campus:
        raise HTTPException(404, "Campus portal not found")
    return campus


async def get_campus_portal(
    db: AsyncSession,
    portal_token: str,
    assignment_id: uuid.UUID,
) -> CampusPortalResponse:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.models.assessment import Assessment

    campus, assignment = await validate_portal_access(db, portal_token, assignment_id)
    job = await db.get(Job, assignment.job_id)

    rows = (await db.execute(
        select(Application, User.full_name, User.email)
        .join(User, User.id == Application.applicant_id)
        .where(Application.campus_id == campus.id, Application.job_id == assignment.job_id)
        .order_by(Application.applied_at.desc())
    )).all()

    app_ids = [app.id for app, _, _ in rows]
    has_assessment_ids: set[uuid.UUID] = set()
    if app_ids:
        assessed = (await db.execute(
            select(Assessment.application_id).where(Assessment.application_id.in_(app_ids))
        )).scalars().all()
        has_assessment_ids = set(assessed)

    candidates = [
        CampusPortalCandidate(
            application_id=app.id,
            candidate_name=full_name,
            email=email,
            stage=app.stage,
            applied_at=app.applied_at,
            stage_updated_at=app.stage_updated_at,
            has_assessment=app.id in has_assessment_ids,
        )
        for app, full_name, email in rows
    ]

    return CampusPortalResponse(
        campus_name=campus.name,
        job_title=job.title if job else "Unknown",
        ref_token=assignment.ref_token,
        drive_date=assignment.drive_date,
        max_submissions=assignment.max_submissions,
        expires_at=assignment.expires_at,
        submission_count=len(candidates),
        candidates=candidates,
    )


async def get_all_campus_portals(
    db: AsyncSession,
    portal_token: str,
) -> dict:
    from app.models.application import Application
    from app.models.job import Job

    campus = (await db.execute(
        select(Campus).where(Campus.portal_token == portal_token, Campus.is_active == True)
    )).scalar_one_or_none()
    if not campus:
        raise HTTPException(404, "Campus portal not found")

    rows = (await db.execute(
        select(JobCampusAssignment, Job.title.label("job_title"), Job.slug.label("job_slug"))
        .join(Job, Job.id == JobCampusAssignment.job_id)
        .where(JobCampusAssignment.campus_id == campus.id)
        .order_by(JobCampusAssignment.created_at.desc())
    )).all()

    stage_rows = (await db.execute(
        select(Application.job_id, Application.stage, func.count().label("count"))
        .where(Application.campus_id == campus.id)
        .group_by(Application.job_id, Application.stage)
    )).all()
    stage_by_job: dict = {}
    for job_id, stage, count in stage_rows:
        stage_by_job.setdefault(job_id, {})[stage] = count

    from app.constants.stages import outcome_counts

    assignments_data = []
    total_submitted = total_hired = total_in_progress = total_rejected = 0
    for assignment, job_title, job_slug in rows:
        oc = outcome_counts(stage_by_job.get(assignment.job_id, {}))
        count, hired, rejected, in_progress = oc["total"], oc["hired"], oc["not_proceeding"], oc["in_progress"]
        total_submitted += count
        total_hired += hired
        total_in_progress += in_progress
        total_rejected += rejected

        assignments_data.append({
            "assignment_id": str(assignment.id),
            "job_id": str(assignment.job_id),
            "job_title": job_title,
            "job_slug": job_slug,
            "ref_token": assignment.ref_token,
            "drive_date": assignment.drive_date.isoformat() if assignment.drive_date else None,
            "max_submissions": assignment.max_submissions,
            "expires_at": assignment.expires_at.isoformat() if assignment.expires_at else None,
            "submission_count": count,
            "hired_count": hired,
            "in_progress_count": in_progress,
            "rejected_count": rejected,
            "created_at": assignment.created_at.isoformat(),
        })

    return {
        "campus_name": campus.name,
        "assignments": assignments_data,
        "total_submitted": total_submitted,
        "total_hired": total_hired,
        "total_in_progress": total_in_progress,
        "total_rejected": total_rejected,
    }


async def portal_bulk_upload_roster(
    db: AsyncSession,
    portal_token: str,
    assignment_id: uuid.UUID,
    rows: list[dict],
) -> list[dict]:
    """The placement cell's own self-serve roster upload — quota-gated like
    any other submission path (validate_portal_assignment), reusing the exact
    spreadsheet pipeline HR's own bulk upload uses. No resume: same as HR's
    own bulk-Excel path (resume_url stored as ''). Students with a resume in
    hand should go through portal_bulk_upload_resumes instead."""
    from app.services import application_service

    campus, assignment = await validate_portal_assignment(db, portal_token, assignment_id)
    return await application_service.bulk_submit_from_excel(
        db, job_id=assignment.job_id, source="campus", rows=rows, campus_id=campus.id,
    )


async def portal_bulk_upload_resumes(
    db: AsyncSession,
    portal_token: str,
    assignment_id: uuid.UUID,
    files: list[tuple[str, bytes, str]],
) -> list[dict]:
    """Drop in a batch of student resumes — each is parsed (name/email/phone/
    education/skills) and its own application created automatically, resume
    attached. Same quota gate and pipeline as the roster spreadsheet upload;
    this is the path for a placement cell that has PDFs in hand rather than a
    spreadsheet of details."""
    from app.services import application_service

    campus, assignment = await validate_portal_assignment(db, portal_token, assignment_id)
    return await application_service.bulk_submit_from_resumes(
        db, job_id=assignment.job_id, source="campus", files=files, campus_id=campus.id,
    )


async def portal_bulk_schedule_assessments(
    db: AsyncSession,
    portal_token: str,
    assignment_id: uuid.UUID,
    application_ids: list[uuid.UUID],
    assessment_fields: dict,
) -> list[dict]:
    """Bulk-schedule an assessment for candidates already submitted under this
    assignment. Not quota-gated (validate_portal_access, not
    validate_portal_assignment) — same reasoning as the agency portal's slot
    booking: max_submissions caps how many candidates may be SUBMITTED, not
    what can be scheduled for ones already in. Every application_id is
    verified to belong to this campus + job before scheduling, so a portal
    token can never be used to schedule an assessment for someone else's
    candidate."""
    from app.services import assessment_service
    from app.schemas.assessment import AssessmentBulkCreate
    from app.models.application import Application

    campus, assignment = await validate_portal_access(db, portal_token, assignment_id)
    if not application_ids:
        return []

    owned_ids = set((await db.execute(
        select(Application.id).where(
            Application.id.in_(application_ids),
            Application.campus_id == campus.id,
            Application.job_id == assignment.job_id,
        )
    )).scalars().all())

    data = AssessmentBulkCreate(application_ids=application_ids, **assessment_fields)
    return await assessment_service.bulk_create_assessments(
        db, data, created_by=None, allowed_application_ids=owned_ids,
    )
