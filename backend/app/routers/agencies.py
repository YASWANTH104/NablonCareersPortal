import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.schemas.agency import (
    AgencyCreate, AgencyUpdate, AgencyResponse,
    JobAgencyAssignmentCreate, JobAgencyAssignmentResponse,
    AgencyPortalResponse,
)
from app.schemas.interview_slot import AvailableSlotGroup, SlotResponse, AgencySlotBookRequest
from app.services import agency_service, interview_slot_service

router = APIRouter(tags=["agencies"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


# ── HR: Agency CRUD ──────────────────────────────────────────────────────────

@router.post("/agencies", response_model=AgencyResponse, status_code=201)
async def create_agency(
    data: AgencyCreate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await agency_service.create_agency(db, data)


@router.get("/agencies", response_model=list[AgencyResponse])
async def list_agencies(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await agency_service.list_agencies(db)


@router.patch("/agencies/{agency_id}", response_model=AgencyResponse)
async def update_agency(
    agency_id: uuid.UUID,
    data: AgencyUpdate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await agency_service.update_agency(db, agency_id, data)


# ── HR: Job-Agency Assignments ───────────────────────────────────────────────

@router.post("/jobs/{job_id}/agencies", response_model=JobAgencyAssignmentResponse, status_code=201)
async def assign_agency_to_job(
    job_id: uuid.UUID,
    data: JobAgencyAssignmentCreate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await agency_service.assign_agency_to_job(db, job_id, data)


@router.get("/jobs/{job_id}/agencies", response_model=list[JobAgencyAssignmentResponse])
async def list_job_agencies(
    job_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await agency_service.list_assignments_for_job(db, job_id)


@router.delete("/agencies/assignments/{assignment_id}", status_code=204)
async def remove_assignment(
    assignment_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    await agency_service.remove_assignment(db, assignment_id)


@router.get("/agencies/{agency_id}/assignments", response_model=list[JobAgencyAssignmentResponse])
async def list_agency_assignments(
    agency_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await agency_service.list_assignments_for_agency(db, agency_id)


# ── Agency Portal (token-based, no auth) ────────────────────────────────────

@router.get("/agency-portal/{portal_token}")
async def agency_portal_overview(
    portal_token: str,
    db: AsyncSession = Depends(get_db),
):
    return await agency_service.get_all_agency_portals(db, portal_token)


@router.get("/agency-portal/{portal_token}/assignments/{assignment_id}", response_model=AgencyPortalResponse)
async def agency_portal_assignment(
    portal_token: str,
    assignment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await agency_service.get_agency_portal(db, portal_token, assignment_id)


@router.post("/agency-portal/{portal_token}/parse-resume")
async def agency_parse_resume(
    portal_token: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Parse an uploaded resume so the agency submission form can be auto-filled."""
    from app.services import resume_parsing_service

    await agency_service.get_agency_by_portal_token(db, portal_token)
    content = await file.read()
    return await resume_parsing_service.parse_resume(
        content, file.content_type or "", file.filename or ""
    )


@router.post("/agency-portal/{portal_token}/assignments/{assignment_id}/submit", status_code=201)
async def agency_submit_candidate(
    portal_token: str,
    assignment_id: uuid.UUID,
    resume: UploadFile = File(...),
    full_name: str = Form(...),
    email: str = Form(...),
    phone: Optional[str] = Form(None),
    current_location: Optional[str] = Form(None),
    total_experience: Optional[str] = Form(None),
    current_company: Optional[str] = Form(None),
    current_designation: Optional[str] = Form(None),
    education: Optional[str] = Form(None),
    skills: Optional[str] = Form(None),
    linkedin_url: Optional[str] = Form(None),
    current_ctc: Optional[str] = Form(None),
    expected_ctc: Optional[str] = Form(None),
    notice_period: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Agency uploads a candidate's resume directly — no candidate login required."""
    from app.services import application_service, storage_service

    agency, assignment = await agency_service.validate_portal_assignment(
        db, portal_token, assignment_id
    )
    resume_url = await storage_service.upload_resume(resume, f"agency-{agency.id}")

    application = await application_service.submit_sourced_application(
        db,
        job_id=assignment.job_id,
        full_name=full_name,
        email=email,
        resume_url=resume_url,
        source="agency",
        agency_id=agency.id,
        phone=phone,
        linkedin_url=linkedin_url or None,
        current_location=current_location,
        total_experience=total_experience,
        current_company=current_company,
        current_designation=current_designation,
        education=education,
        skills=skills,
        current_ctc=current_ctc or None,
        expected_ctc=expected_ctc or None,
        notice_period=notice_period or None,
    )
    return {"application_id": str(application.id), "stage": application.stage}


# ── Agency portal: interview slots ────────────────────────────────────────────

@router.get(
    "/agency-portal/{portal_token}/assignments/{assignment_id}/slots",
    response_model=list[AvailableSlotGroup],
)
async def agency_available_slots(
    portal_token: str,
    assignment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Anonymized — never reveals which interviewer a slot belongs to."""
    _agency, assignment = await agency_service.validate_portal_assignment(db, portal_token, assignment_id)
    return await interview_slot_service.get_available_slots_for_job(db, assignment.job_id)


@router.post("/agency-portal/{portal_token}/assignments/{assignment_id}/slots/book", response_model=SlotResponse)
async def agency_book_slot(
    portal_token: str,
    assignment_id: uuid.UUID,
    data: AgencySlotBookRequest,
    db: AsyncSession = Depends(get_db),
):
    from app.models.application import Application

    agency, assignment = await agency_service.validate_portal_assignment(db, portal_token, assignment_id)

    application = await db.get(Application, data.application_id)
    if not application or application.agency_id != agency.id or application.job_id != assignment.job_id:
        raise HTTPException(404, "Candidate not found for this assignment")

    return await interview_slot_service.book_slot(
        db,
        application_id=data.application_id,
        job_id=assignment.job_id,
        round_type=data.round_type,
        start_time=data.start_time,
        duration_mins=data.duration_mins,
        booked_by_agency_id=agency.id,
    )
