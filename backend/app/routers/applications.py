import csv
import io
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
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
    return await application_service.update_application(db, application_id, current_user.id, data)


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
