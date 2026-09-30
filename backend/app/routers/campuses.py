import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.schemas.campus import (
    CampusCreate, CampusUpdate, CampusResponse,
    JobCampusAssignmentCreate, JobCampusAssignmentUpdate, JobCampusAssignmentResponse,
    CampusPortalResponse, CampusBulkScheduleRequest,
)
from app.services import campus_service

router = APIRouter(tags=["campuses"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


# ── HR: Campus CRUD ──────────────────────────────────────────────────────────

@router.post("/campuses", response_model=CampusResponse, status_code=201)
async def create_campus(
    data: CampusCreate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await campus_service.create_campus(db, data)


@router.get("/campuses", response_model=list[CampusResponse])
async def list_campuses(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await campus_service.list_campuses(db)


@router.patch("/campuses/{campus_id}", response_model=CampusResponse)
async def update_campus(
    campus_id: uuid.UUID,
    data: CampusUpdate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await campus_service.update_campus(db, campus_id, data)


# ── HR: Job-Campus Assignments (placement drives) ────────────────────────────

@router.post("/jobs/{job_id}/campuses", response_model=JobCampusAssignmentResponse, status_code=201)
async def assign_campus_to_job(
    job_id: uuid.UUID,
    data: JobCampusAssignmentCreate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await campus_service.assign_campus_to_job(db, job_id, data)


@router.get("/jobs/{job_id}/campuses", response_model=list[JobCampusAssignmentResponse])
async def list_job_campuses(
    job_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await campus_service.list_assignments_for_job(db, job_id)


@router.patch("/campuses/assignments/{assignment_id}", response_model=JobCampusAssignmentResponse)
async def update_assignment(
    assignment_id: uuid.UUID,
    data: JobCampusAssignmentUpdate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await campus_service.update_assignment(db, assignment_id, data)


@router.delete("/campuses/assignments/{assignment_id}", status_code=204)
async def remove_assignment(
    assignment_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    await campus_service.remove_assignment(db, assignment_id)


@router.get("/campuses/{campus_id}/assignments", response_model=list[JobCampusAssignmentResponse])
async def list_campus_assignments(
    campus_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await campus_service.list_assignments_for_campus(db, campus_id)


# ── Campus Portal (token-based, no auth) ────────────────────────────────────

@router.get("/campus-portal/{portal_token}")
async def campus_portal_overview(
    portal_token: str,
    db: AsyncSession = Depends(get_db),
):
    return await campus_service.get_all_campus_portals(db, portal_token)


@router.get("/campus-portal/{portal_token}/assignments/{assignment_id}", response_model=CampusPortalResponse)
async def campus_portal_assignment(
    portal_token: str,
    assignment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await campus_service.get_campus_portal(db, portal_token, assignment_id)


@router.get("/campus-portal/{portal_token}/bulk-upload-template")
async def campus_portal_bulk_upload_template(
    portal_token: str,
    db: AsyncSession = Depends(get_db),
):
    """Downloadable roster template — public, token-scoped like the rest of
    the portal (no HR auth to piggyback on from here), unlike the HR-only
    /applications/bulk-upload-template this mirrors the column layout of."""
    from app.services import application_service

    await campus_service.get_campus_by_portal_token(db, portal_token)
    return Response(
        content=application_service.build_bulk_upload_template(student=True),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=student_roster_template.xlsx"},
    )


@router.post("/campus-portal/{portal_token}/assignments/{assignment_id}/bulk-upload-resumes")
async def campus_portal_bulk_upload_resumes(
    portal_token: str,
    assignment_id: uuid.UUID,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """The placement cell drops in a batch of student resumes (PDF/DOC/DOCX) —
    each is AI-parsed and its own application created, resume attached, no
    manual re-entry. Same shape as HR's own /applications/bulk-upload-resumes."""
    from fastapi import HTTPException
    from app.services import application_service

    if not files:
        raise HTTPException(400, "No files were uploaded.")
    if len(files) > application_service.MAX_BULK_RESUMES:
        raise HTTPException(400, f"Please upload at most {application_service.MAX_BULK_RESUMES} resumes at a time.")

    file_data = [(f.filename or "resume", await f.read(), f.content_type or "") for f in files]
    results = await campus_service.portal_bulk_upload_resumes(db, portal_token, assignment_id, file_data)
    created = sum(1 for r in results if r["status"] == "success")
    return {"results": results, "created": created, "failed": len(results) - created}


@router.post("/campus-portal/{portal_token}/assignments/{assignment_id}/bulk-upload-excel")
async def campus_portal_bulk_upload_roster(
    portal_token: str,
    assignment_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """The placement cell drops in their student roster spreadsheet — one
    application created per row, no resume required. Same column headers as
    HR's own bulk-upload template (Full Name / Email required)."""
    from fastapi import HTTPException
    from app.services import application_service

    content = await file.read()
    rows = application_service.parse_bulk_excel(content)
    if not rows:
        raise HTTPException(400, "No valid student rows found (need at least Full Name and Email per row).")
    if len(rows) > application_service.MAX_BULK_EXCEL_ROWS:
        raise HTTPException(400, f"Please upload at most {application_service.MAX_BULK_EXCEL_ROWS} students at a time.")

    results = await campus_service.portal_bulk_upload_roster(db, portal_token, assignment_id, rows)
    created = sum(1 for r in results if r["status"] == "success")
    return {"results": results, "created": created, "failed": len(results) - created}


@router.post("/campus-portal/{portal_token}/assignments/{assignment_id}/bulk-schedule-assessments")
async def campus_portal_bulk_schedule_assessments(
    portal_token: str,
    assignment_id: uuid.UUID,
    data: CampusBulkScheduleRequest,
    db: AsyncSession = Depends(get_db),
):
    """The placement cell schedules the same assessment (deadline, platform
    link, instructions) across many of their own students in one action —
    each one gets its own confirmation email queued independently."""
    results = await campus_service.portal_bulk_schedule_assessments(
        db, portal_token, assignment_id, data.application_ids,
        data.model_dump(exclude={"application_ids"}),
    )
    created = sum(1 for r in results if r["status"] == "success")
    return {"results": results, "created": created, "failed": len(results) - created}
