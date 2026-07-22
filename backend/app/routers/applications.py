import csv
import io
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query, UploadFile, File, Form, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles, Role
from app.schemas.application import (
    ApplicationCreate, ApplicationResponse, ApplicationDetailResponse,
    ApplicationStageUpdate, ApplicationListResponse,
    ApplicationRatingUpdate, ApplicationAssignUpdate,
    ApplicationUpdate, NoteCreate, StageHistoryEntry,
)
from app.services import application_service

router = APIRouter(prefix="/applications", tags=["applications"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
_HR_AND_INTERVIEWER = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN, Role.INTERVIEWER)


@router.get("/mine", response_model=ApplicationListResponse)
async def my_applications(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.get_my_applications(db, current_user.id, page=page, limit=limit)


@router.post("", response_model=ApplicationResponse, status_code=201)
async def submit_application(
    data: ApplicationCreate,
    current_user=Depends(require_roles(Role.APPLICANT)),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.submit_application(db, data, applicant_id=current_user.id)


_HR_SUBMIT_SOURCES = {"talent_acquisition", "direct", "agency"}


@router.post("/hr-submit", status_code=201)
async def hr_submit_candidate(
    resume: UploadFile = File(...),
    job_id: uuid.UUID = Form(...),
    full_name: str = Form(...),
    email: str = Form(...),
    source: str = Form("talent_acquisition"),
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
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """HR/TA uploads a sourced candidate's resume and creates the application directly."""
    from app.services import storage_service

    if source not in _HR_SUBMIT_SOURCES:
        raise HTTPException(400, f"Invalid source. Allowed: {', '.join(sorted(_HR_SUBMIT_SOURCES))}")

    resume_url = await storage_service.upload_resume(resume, f"hr-{user.id}")

    application = await application_service.submit_sourced_application(
        db,
        job_id=job_id,
        full_name=full_name,
        email=email,
        resume_url=resume_url,
        source=source,
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
    )
    return {"application_id": str(application.id), "stage": application.stage}


@router.post("/bulk-upload-resumes")
async def bulk_upload_resumes(
    job_id: uuid.UUID = Form(...),
    source: str = Form("talent_acquisition"),
    files: list[UploadFile] = File(...),
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Drop in a batch of resumes — each is parsed and its own application is
    created automatically (no per-candidate manual entry). Every file is
    independent, so one bad file doesn't block the rest; the response reports
    a result per file."""
    from app.models.job import Job

    if source not in _HR_SUBMIT_SOURCES:
        raise HTTPException(400, f"Invalid source. Allowed: {', '.join(sorted(_HR_SUBMIT_SOURCES))}")
    if not await db.get(Job, job_id):
        raise HTTPException(404, "Job not found")
    if not files:
        raise HTTPException(400, "No files were uploaded.")
    if len(files) > application_service.MAX_BULK_RESUMES:
        raise HTTPException(400, f"Please upload at most {application_service.MAX_BULK_RESUMES} resumes at a time.")

    file_data = []
    for f in files:
        file_data.append((f.filename or "resume", await f.read(), f.content_type or ""))

    results = await application_service.bulk_submit_from_resumes(
        db, job_id=job_id, source=source, files=file_data,
    )
    created = sum(1 for r in results if r["status"] == "success")
    return {"results": results, "created": created, "failed": len(results) - created}


@router.get("/bulk-upload-template")
async def bulk_upload_template(
    user=Depends(require_roles(*_HR_ROLES)),
):
    """Downloadable spreadsheet template for the Excel bulk-upload path."""
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Candidates"
    headers = [
        "Full Name", "Email", "Phone", "Current Location", "Total Experience",
        "Current Company", "Current Designation", "Education", "Skills",
        "LinkedIn", "Current CTC", "Expected CTC",
    ]
    ws.append(headers)
    ws.append([
        "Jordan Lee", "jordan.lee@example.com", "+91 98765 43210", "Bengaluru, India", "5 years",
        "Acme Corp", "Senior Data Scientist", "B.Tech, CSE, IIT Delhi", "Python, PyTorch, LLMs",
        "https://linkedin.com/in/jordanlee", "18 LPA", "24 LPA",
    ])
    for col_idx in range(1, len(headers) + 1):
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = 20

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=candidate_bulk_upload_template.xlsx"},
    )


@router.post("/bulk-upload-excel")
async def bulk_upload_excel(
    job_id: uuid.UUID = Form(...),
    source: str = Form("talent_acquisition"),
    file: UploadFile = File(...),
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Bulk-create sourced applications from a spreadsheet — no resume required
    per candidate. See bulk_upload_template for the expected column headers."""
    from app.models.job import Job

    if source not in _HR_SUBMIT_SOURCES:
        raise HTTPException(400, f"Invalid source. Allowed: {', '.join(sorted(_HR_SUBMIT_SOURCES))}")
    if not await db.get(Job, job_id):
        raise HTTPException(404, "Job not found")

    content = await file.read()
    rows = application_service.parse_bulk_excel(content)
    if not rows:
        raise HTTPException(400, "No valid candidate rows found (need at least Full Name and Email per row).")
    if len(rows) > application_service.MAX_BULK_EXCEL_ROWS:
        raise HTTPException(400, f"Please upload at most {application_service.MAX_BULK_EXCEL_ROWS} candidates at a time.")

    results = await application_service.bulk_submit_from_excel(
        db, job_id=job_id, source=source, rows=rows,
    )
    created = sum(1 for r in results if r["status"] == "success")
    return {"results": results, "created": created, "failed": len(results) - created}


@router.get("/export")
async def export_applications(
    job_id: Optional[uuid.UUID] = Query(None),
    stage: Optional[str] = Query(None),
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    rows = await application_service.export_applications(db, job_id=job_id, stage=stage)
    output = io.StringIO()
    fields = ["id", "candidate_name", "candidate_email", "job_title", "stage", "source",
              "rating", "applied_at", "stage_updated_at", "linkedin_url", "portfolio_url", "github_url"]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=applications.csv"},
    )


@router.get("", response_model=ApplicationListResponse)
async def list_applications(
    job_id: Optional[uuid.UUID] = Query(None),
    stage: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    agency_id: Optional[uuid.UUID] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=500),
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.get_all_applications(
        db, job_id=job_id, stage=stage, search=search, agency_id=agency_id, page=page, limit=limit
    )


@router.get("/{application_id}", response_model=ApplicationDetailResponse)
async def get_application(
    application_id: uuid.UUID,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.get_application_by_id(db, application_id)


@router.patch("/{application_id}", response_model=ApplicationResponse)
async def update_application(
    application_id: uuid.UUID,
    data: ApplicationUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.update_application(db, application_id, current_user, data)


@router.patch("/{application_id}/stage", response_model=ApplicationResponse)
async def move_stage(
    application_id: uuid.UUID,
    data: ApplicationStageUpdate,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.move_stage(db, application_id, data.stage, user.id, data.notes, data.rejection_reason)


@router.patch("/{application_id}/star", response_model=ApplicationResponse)
async def toggle_star(
    application_id: uuid.UUID,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.toggle_star(db, application_id)


@router.patch("/{application_id}/rating", response_model=ApplicationResponse)
async def set_rating(
    application_id: uuid.UUID,
    data: ApplicationRatingUpdate,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.set_rating(db, application_id, data.rating)


@router.patch("/{application_id}/assign", response_model=ApplicationResponse)
async def assign_application(
    application_id: uuid.UUID,
    data: ApplicationAssignUpdate,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.assign_application(db, application_id, data.assignee_id)


@router.post("/{application_id}/notes", response_model=StageHistoryEntry)
async def add_note(
    application_id: uuid.UUID,
    data: NoteCreate,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.add_note(db, application_id, data.note, user.id)


@router.get("/{application_id}/timeline", response_model=list[StageHistoryEntry])
async def get_timeline(
    application_id: uuid.UUID,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await application_service.get_timeline(db, application_id)


@router.delete("/{application_id}/withdraw", status_code=204)
async def withdraw(
    application_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await application_service.withdraw_application(db, application_id, current_user.id)


@router.get("/{application_id}/interviews")
async def get_my_interviews(
    application_id: uuid.UUID,
    current_user=Depends(require_roles(Role.APPLICANT)),
    db: AsyncSession = Depends(get_db),
):
    from app.services import interview_service
    return await interview_service.list_candidate_interviews(db, application_id, current_user.id)
