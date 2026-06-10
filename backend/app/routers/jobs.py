import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, get_optional_user, require_roles, Role
from app.schemas.job import (
    JobCreate, JobUpdate, JobStatusUpdate,
    JobResponse, JobListResponse,
    JobQuestionCreate, JobQuestionResponse,
    DepartmentCreate, DepartmentResponse,
)
from app.services import job_service

router = APIRouter(prefix="/jobs", tags=["jobs"])


# ── Public ──────────────────────────────────────────────────────────────────

@router.get("/departments", response_model=list[DepartmentResponse])
async def list_departments(db: AsyncSession = Depends(get_db)):
    return await job_service.list_departments(db)


@router.post("/departments", response_model=DepartmentResponse, status_code=201)
async def create_department(
    data: DepartmentCreate,
    _=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await job_service.create_department(db, data.name)


@router.put("/departments/{dept_id}", response_model=DepartmentResponse)
async def update_department(
    dept_id: uuid.UUID,
    data: DepartmentCreate,
    _=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await job_service.update_department(db, dept_id, data.name)


@router.delete("/departments/{dept_id}", status_code=204)
async def delete_department(
    dept_id: uuid.UUID,
    _=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    await job_service.delete_department(db, dept_id)


@router.get("", response_model=JobListResponse)
async def list_jobs(
    search: Optional[str] = Query(None),
    department_id: Optional[str] = Query(None),
    location_type: Optional[str] = Query(None),
    employment_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user=Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    hr_roles = {Role.HR_MANAGER.value, Role.ADMIN.value, Role.SUPER_ADMIN.value}
    is_hr = current_user and current_user.role in hr_roles

    if is_hr:
        return await job_service.list_jobs_hr(
            db, status=status, search=search, page=page, limit=limit
        )
    return await job_service.list_jobs_public(
        db,
        search=search,
        department_id=department_id,
        location_type=location_type,
        employment_type=employment_type,
        page=page,
        limit=limit,
    )


@router.get("/{identifier}", response_model=JobResponse)
async def get_job(
    identifier: str,
    current_user=Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    hr_roles = {Role.HR_MANAGER.value, Role.ADMIN.value, Role.SUPER_ADMIN.value}
    is_hr = current_user and current_user.role in hr_roles

    job = None
    try:
        job_id = uuid.UUID(identifier)
        job = await job_service.get_job_by_id(db, job_id)
    except ValueError:
        job = await job_service.get_job_by_slug(db, identifier)

    if not job:
        raise HTTPException(404, "Job not found")

    # Non-HR users can only see published jobs
    if not is_hr and job.status != "published":
        raise HTTPException(404, "Job not found")

    return job


# ── HR protected ─────────────────────────────────────────────────────────────

@router.post("", response_model=JobResponse, status_code=201)
async def create_job(
    data: JobCreate,
    user=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await job_service.create_job(db, data, posted_by=user.id)


@router.put("/{job_id}", response_model=JobResponse)
async def update_job(
    job_id: uuid.UUID,
    data: JobUpdate,
    user=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await job_service.update_job(db, job_id, data)


@router.patch("/{job_id}/status", response_model=JobResponse)
async def update_job_status(
    job_id: uuid.UUID,
    data: JobStatusUpdate,
    user=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await job_service.update_job_status(db, job_id, data.status)


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: uuid.UUID,
    user=Depends(require_roles(Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    await job_service.delete_job(db, job_id)


@router.get("/{job_id}/questions", response_model=list[JobQuestionResponse])
async def get_questions(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await job_service.get_job_questions(db, job_id)


@router.post("/{job_id}/questions", response_model=JobQuestionResponse, status_code=201)
async def add_question(
    job_id: uuid.UUID,
    data: JobQuestionCreate,
    user=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await job_service.add_job_question(db, job_id, data)


@router.delete("/{job_id}/questions/{question_id}", status_code=204)
async def remove_question(
    job_id: uuid.UUID,
    question_id: uuid.UUID,
    user=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    await job_service.remove_job_question(db, job_id, question_id)
