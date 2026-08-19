import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, get_optional_user, require_roles, Role
from app.schemas.job import (
    JobCreate, JobUpdate, JobStatusUpdate,
    JobResponse, JobListResponse,
    JobQuestionCreate, JobQuestionResponse,
    DepartmentCreate, DepartmentResponse,
    JDGenerateRequest, JDGenerateResponse, JDPdfParseResponse,
)
from app.services import job_service, storage_service
from app.services.jd_generation_service import generate_job_description, JDGenerationUnavailable

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
    is_internal_viewer = current_user is not None and current_user.role != Role.APPLICANT.value

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
        audience="referral" if is_internal_viewer else "public",
    )


@router.get("/my-applicant-access")
async def my_applicant_access_jobs(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Minimal {id, title} list of jobs THIS caller actually has applicant-
    view access to — used by the ApplicantsPage job filter for anyone who
    isn't HR (HR keeps using the full GET /jobs list). Declared before
    GET /{identifier} so it isn't swallowed by that path param."""
    return await job_service.list_accessible_jobs_for_applicant_view(db, current_user)


@router.get("/{identifier}", response_model=JobResponse)
async def get_job(
    identifier: str,
    current_user=Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    hr_roles = {Role.HR_MANAGER.value, Role.ADMIN.value, Role.SUPER_ADMIN.value}
    is_hr = current_user and current_user.role in hr_roles
    is_internal_viewer = current_user is not None and current_user.role != Role.APPLICANT.value

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

    # Same visibility rule as the listing: internal-only jobs are invisible to
    # everyone outside HR; a non-internal job still needs its matching
    # referral/outsider flag on for the viewer's audience.
    if not is_hr:
        if job.is_internal:
            raise HTTPException(404, "Job not found")
        if is_internal_viewer and not job.allow_referrals:
            raise HTTPException(404, "Job not found")
        if not is_internal_viewer and not job.allow_outsiders:
            raise HTTPException(404, "Job not found")

    # Re-sign the stored JD-PDF SAS URL so it doesn't 403 once its baked-in token
    # expires. Build the response first so we never mutate the persistent ORM row
    # (which could otherwise write the short-lived URL back on autoflush).
    # Recruiter/hiring-manager names are internal detail — only attached for HR.
    if is_hr:
        resp = JobResponse(**await job_service.get_job_with_names(db, job))
    else:
        resp = JobResponse.model_validate(job)
    if resp.jd_pdf_url:
        resp.jd_pdf_url = storage_service.refresh_url(resp.jd_pdf_url)
    return resp


# ── HR protected ─────────────────────────────────────────────────────────────

@router.post("", response_model=JobResponse, status_code=201)
async def create_job(
    data: JobCreate,
    user=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    job = await job_service.create_job(db, data, posted_by=user.id)
    return await job_service.get_job_with_names(db, job)


@router.post("/generate-jd", response_model=JDGenerateResponse)
async def generate_jd(
    data: JDGenerateRequest,
    _=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
):
    try:
        result = await generate_job_description(
            title=data.title,
            notes=data.notes,
            department=data.department,
            location=data.location,
            location_type=data.location_type,
            employment_type=data.employment_type,
            experience_min=data.experience_min,
            experience_max=data.experience_max,
        )
    except JDGenerationUnavailable:
        raise HTTPException(503, "AI drafting is not available right now. Please write the JD manually.")
    return result


@router.post("/parse-jd-pdf", response_model=JDPdfParseResponse)
async def parse_jd_pdf(
    file: UploadFile = File(...),
    _=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
):
    """Upload a JD document (PDF/DOCX): store the original file AND extract its
    content into structured fields so HR can attach the file and auto-fill the
    posting (reviewed before saving). The file is read once and used for both."""
    allowed = {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    name = (file.filename or "").lower()
    if file.content_type not in allowed and not name.endswith((".pdf", ".doc", ".docx")):
        raise HTTPException(400, "Please upload a PDF or Word document.")

    content = await file.read()
    if not content:
        raise HTTPException(400, "The uploaded file is empty.")

    from app.services import jd_parsing_service

    url = await storage_service.upload_jd_bytes(
        content, file.filename or "jd.pdf", file.content_type or "application/pdf"
    )
    parsed = await jd_parsing_service.parse_jd_document(
        content, file.content_type or "", file.filename or ""
    )
    return {
        "jd_pdf_url": url,
        "jd_pdf_name": file.filename or "job-description.pdf",
        **parsed,
    }


@router.put("/{job_id}", response_model=JobResponse)
async def update_job(
    job_id: uuid.UUID,
    data: JobUpdate,
    user=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    job = await job_service.update_job(db, job_id, data)
    return await job_service.get_job_with_names(db, job)


@router.patch("/{job_id}/status", response_model=JobResponse)
async def update_job_status(
    job_id: uuid.UUID,
    data: JobStatusUpdate,
    user=Depends(require_roles(Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    job = await job_service.update_job_status(db, job_id, data.status)
    return await job_service.get_job_with_names(db, job)


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
