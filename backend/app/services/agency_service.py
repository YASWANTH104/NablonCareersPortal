import uuid
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.agency import Agency, JobAgencyAssignment
from app.schemas.agency import (
    AgencyCreate, AgencyUpdate, AgencyResponse,
    JobAgencyAssignmentCreate, JobAgencyAssignmentResponse,
    AgencyPortalResponse, AgencyPortalCandidate,
)


async def create_agency(db: AsyncSession, data: AgencyCreate) -> Agency:
    agency = Agency(**data.model_dump())
    db.add(agency)
    await db.commit()
    await db.refresh(agency)
    return agency


async def list_agencies(db: AsyncSession) -> list[Agency]:
    rows = (await db.execute(select(Agency).order_by(Agency.name))).scalars().all()
    return list(rows)


async def update_agency(db: AsyncSession, agency_id: uuid.UUID, data: AgencyUpdate) -> Agency:
    agency = await db.get(Agency, agency_id)
    if not agency:
        raise HTTPException(404, "Agency not found")
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(agency, field, val)
    agency.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(agency)
    return agency


async def assign_agency_to_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    data: JobAgencyAssignmentCreate,
) -> JobAgencyAssignmentResponse:
    from app.models.job import Job

    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    agency = await db.get(Agency, data.agency_id)
    if not agency:
        raise HTTPException(404, "Agency not found")

    existing = (await db.execute(
        select(JobAgencyAssignment).where(
            JobAgencyAssignment.job_id == job_id,
            JobAgencyAssignment.agency_id == data.agency_id,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Agency already assigned to this job")

    assignment = JobAgencyAssignment(
        job_id=job_id,
        agency_id=data.agency_id,
        max_submissions=data.max_submissions,
        expires_at=data.expires_at,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    return JobAgencyAssignmentResponse(
        id=assignment.id,
        job_id=assignment.job_id,
        agency_id=assignment.agency_id,
        ref_token=assignment.ref_token,
        max_submissions=assignment.max_submissions,
        expires_at=assignment.expires_at,
        created_at=assignment.created_at,
        agency_name=agency.name,
        job_title=job.title,
    )


async def list_assignments_for_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> list[JobAgencyAssignmentResponse]:
    from app.models.job import Job

    rows = (await db.execute(
        select(JobAgencyAssignment, Agency.name.label("agency_name"), Job.title.label("job_title"))
        .join(Agency, Agency.id == JobAgencyAssignment.agency_id)
        .join(Job, Job.id == JobAgencyAssignment.job_id)
        .where(JobAgencyAssignment.job_id == job_id)
        .order_by(JobAgencyAssignment.created_at.desc())
    )).all()

    return [
        JobAgencyAssignmentResponse(
            id=a.id,
            job_id=a.job_id,
            agency_id=a.agency_id,
            ref_token=a.ref_token,
            max_submissions=a.max_submissions,
            expires_at=a.expires_at,
            created_at=a.created_at,
            agency_name=agency_name,
            job_title=job_title,
        )
        for a, agency_name, job_title in rows
    ]


async def list_assignments_for_agency(
    db: AsyncSession,
    agency_id: uuid.UUID,
) -> list[JobAgencyAssignmentResponse]:
    from app.models.job import Job

    rows = (await db.execute(
        select(JobAgencyAssignment, Agency.name.label("agency_name"), Job.title.label("job_title"))
        .join(Agency, Agency.id == JobAgencyAssignment.agency_id)
        .join(Job, Job.id == JobAgencyAssignment.job_id)
        .where(JobAgencyAssignment.agency_id == agency_id)
        .order_by(JobAgencyAssignment.created_at.desc())
    )).all()

    return [
        JobAgencyAssignmentResponse(
            id=a.id,
            job_id=a.job_id,
            agency_id=a.agency_id,
            ref_token=a.ref_token,
            max_submissions=a.max_submissions,
            expires_at=a.expires_at,
            created_at=a.created_at,
            agency_name=agency_name,
            job_title=job_title,
        )
        for a, agency_name, job_title in rows
    ]


async def remove_assignment(db: AsyncSession, assignment_id: uuid.UUID) -> None:
    assignment = await db.get(JobAgencyAssignment, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    await db.delete(assignment)
    await db.commit()


async def get_assignment_by_ref_token(
    db: AsyncSession,
    ref_token: str,
) -> JobAgencyAssignment | None:
    return (await db.execute(
        select(JobAgencyAssignment).where(JobAgencyAssignment.ref_token == ref_token)
    )).scalar_one_or_none()


async def get_agency_portal(
    db: AsyncSession,
    portal_token: str,
    assignment_id: uuid.UUID,
) -> AgencyPortalResponse:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job

    agency = (await db.execute(
        select(Agency).where(Agency.portal_token == portal_token, Agency.is_active == True)
    )).scalar_one_or_none()
    if not agency:
        raise HTTPException(404, "Agency portal not found")

    assignment = await db.get(JobAgencyAssignment, assignment_id)
    if not assignment or assignment.agency_id != agency.id:
        raise HTTPException(404, "Assignment not found")

    job = await db.get(Job, assignment.job_id)

    rows = (await db.execute(
        select(Application, User.full_name)
        .join(User, User.id == Application.applicant_id)
        .where(Application.agency_id == agency.id, Application.job_id == assignment.job_id)
        .order_by(Application.applied_at.desc())
    )).all()

    candidates = [
        AgencyPortalCandidate(
            application_id=app.id,
            candidate_name=full_name,
            stage=app.stage,
            applied_at=app.applied_at,
            stage_updated_at=app.stage_updated_at,
        )
        for app, full_name in rows
    ]

    return AgencyPortalResponse(
        agency_name=agency.name,
        job_title=job.title if job else "Unknown",
        ref_token=assignment.ref_token,
        max_submissions=assignment.max_submissions,
        expires_at=assignment.expires_at,
        submission_count=len(candidates),
        candidates=candidates,
    )


async def get_all_agency_portals(
    db: AsyncSession,
    portal_token: str,
) -> dict:
    from app.models.application import Application
    from app.models.job import Job

    agency = (await db.execute(
        select(Agency).where(Agency.portal_token == portal_token, Agency.is_active == True)
    )).scalar_one_or_none()
    if not agency:
        raise HTTPException(404, "Agency portal not found")

    rows = (await db.execute(
        select(JobAgencyAssignment, Job.title.label("job_title"))
        .join(Job, Job.id == JobAgencyAssignment.job_id)
        .where(JobAgencyAssignment.agency_id == agency.id)
        .order_by(JobAgencyAssignment.created_at.desc())
    )).all()

    assignments_data = []
    for assignment, job_title in rows:
        count = (await db.execute(
            select(func.count()).select_from(Application).where(
                Application.agency_id == agency.id,
                Application.job_id == assignment.job_id,
            )
        )).scalar_one()
        assignments_data.append({
            "assignment_id": str(assignment.id),
            "job_id": str(assignment.job_id),
            "job_title": job_title,
            "ref_token": assignment.ref_token,
            "max_submissions": assignment.max_submissions,
            "expires_at": assignment.expires_at.isoformat() if assignment.expires_at else None,
            "submission_count": count,
            "created_at": assignment.created_at.isoformat(),
        })

    return {"agency_name": agency.name, "assignments": assignments_data}
