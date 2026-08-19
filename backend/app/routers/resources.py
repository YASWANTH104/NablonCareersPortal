import uuid
from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.schemas.resource import (
    EmployeeProfileCreate, EmployeeProfileUpdate, EmployeeProfileResponse,
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectDetailResponse,
    ProjectAllocationCreate, ProjectAllocationUpdate, ProjectAllocationResponse,
    OnboardableUser, ResourceStatsResponse, ResourceSearchRequest, ResourceSearchResponse,
)
from app.services import resource_service, resource_query_service

router = APIRouter(tags=["resources"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


# ── Onboarding ────────────────────────────────────────────────────────────────

@router.get("/resources/onboardable-users", response_model=list[OnboardableUser])
async def get_onboardable_users(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.list_onboardable_users(db)


# ── Stats + NL search (declared before /{profile_id} so "stats"/"search" never
#    get swallowed as a path param) ───────────────────────────────────────────

@router.get("/resources/stats", response_model=ResourceStatsResponse)
async def get_resource_stats(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.get_stats(db)


@router.post("/resources/search", response_model=ResourceSearchResponse)
async def search_resources(
    data: ResourceSearchRequest,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_query_service.run_search(db, data.query)


# ── Projects (declared before /{profile_id} for the same reason) ────────────

@router.get("/resources/projects", response_model=list[ProjectResponse])
async def list_projects(
    status: Optional[str] = None,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.list_projects(db, status=status)


@router.post("/resources/projects", response_model=ProjectResponse, status_code=201)
async def create_project(
    data: ProjectCreate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.create_project(db, data)


@router.get("/resources/projects/{project_id}", response_model=ProjectDetailResponse)
async def get_project(
    project_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.get_project_detail(db, project_id)


@router.patch("/resources/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    data: ProjectUpdate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.update_project(db, project_id, data)


# ── Allocations ──────────────────────────────────────────────────────────────

@router.post("/resources/{profile_id}/allocations", response_model=ProjectAllocationResponse, status_code=201)
async def create_allocation(
    profile_id: uuid.UUID,
    data: ProjectAllocationCreate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.create_allocation(db, profile_id, data)


@router.patch("/resources/allocations/{allocation_id}", response_model=ProjectAllocationResponse)
async def update_allocation(
    allocation_id: uuid.UUID,
    data: ProjectAllocationUpdate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.update_allocation(db, allocation_id, data)


@router.post("/resources/allocations/{allocation_id}/end", response_model=ProjectAllocationResponse)
async def end_allocation(
    allocation_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.end_allocation(db, allocation_id)


@router.delete("/resources/allocations/{allocation_id}", status_code=204)
async def delete_allocation(
    allocation_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    await resource_service.delete_allocation(db, allocation_id)


# ── Employee profile CRUD ────────────────────────────────────────────────────

@router.get("/resources", response_model=list[EmployeeProfileResponse])
async def list_resources(
    project_id: Optional[uuid.UUID] = None,
    billing_status: Optional[str] = None,
    employment_type: Optional[str] = None,
    department: Optional[str] = None,
    unallocated: Optional[bool] = None,
    skill: Optional[str] = None,
    search: Optional[str] = None,
    include_inactive: bool = False,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.list_employee_profiles(
        db,
        project_id=project_id,
        billing_status=billing_status,
        employment_type=employment_type,
        department=department,
        unallocated=unallocated,
        skill=skill,
        search=search,
        include_inactive=include_inactive,
    )


@router.post("/resources", response_model=EmployeeProfileResponse, status_code=201)
async def create_resource(
    data: EmployeeProfileCreate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.create_employee_profile(db, data)


@router.get("/resources/{profile_id}", response_model=EmployeeProfileResponse)
async def get_resource(
    profile_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.get_employee_profile(db, profile_id)


@router.patch("/resources/{profile_id}", response_model=EmployeeProfileResponse)
async def update_resource(
    profile_id: uuid.UUID,
    data: EmployeeProfileUpdate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await resource_service.update_employee_profile(db, profile_id, data)


@router.post("/resources/{profile_id}/resume", response_model=EmployeeProfileResponse)
async def upload_resource_resume(
    profile_id: uuid.UUID,
    file: UploadFile = File(...),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    from app.services import storage_service

    resume_url = await storage_service.upload_resume(file, f"resource-{profile_id}")
    return await resource_service.set_resume(db, profile_id, resume_url, file.filename or "resume.pdf")
