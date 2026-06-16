import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.schemas.agency import (
    AgencyCreate, AgencyUpdate, AgencyResponse,
    JobAgencyAssignmentCreate, JobAgencyAssignmentResponse,
    AgencyPortalResponse,
)
from app.services import agency_service

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
