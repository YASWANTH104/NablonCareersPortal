import uuid
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles, Role
from pydantic import BaseModel
from app.schemas.interview import (
    InterviewCreate, InterviewUpdate, InterviewResponse,
    InterviewFeedbackCreate, InterviewFeedbackResponse,
    InterviewListResponse,
    CandidateSelfFeedbackCreate, CandidateSelfFeedbackResponse,
    CandidateInterviewSummary,
    AvailabilityCheckRequest, PanelistAvailability,
    PanelistScheduleRequest, PanelistDaySchedule,
)


class CompleteInterviewRequest(BaseModel):
    notes: str | None = None
from app.services import interview_service

router = APIRouter(prefix="/interviews", tags=["interviews"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
_HR_AND_INTERVIEWER = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN, Role.INTERVIEWER)


@router.post("", response_model=InterviewResponse, status_code=201)
async def create_interview(
    data: InterviewCreate,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.create_interview(db, data, created_by=user.id)


@router.post("/check-availability", response_model=list[PanelistAvailability])
async def check_availability(
    data: AvailabilityCheckRequest,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.check_panelist_availability(
        db, data.panelist_ids, data.scheduled_at, data.duration_mins,
        exclude_interview_id=data.exclude_interview_id,
    )


@router.post("/panelist-schedule", response_model=list[PanelistDaySchedule])
async def panelist_schedule(
    data: PanelistScheduleRequest,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.get_panelist_day_schedule(
        db, data.panelist_ids, data.day_start, data.day_end,
    )


# date_from/date_to let the calendar views fetch exactly the window on screen
# (a month grid or a week grid) in one unpaginated request; the agenda list
# leaves them unset and keeps paginating.
@router.get("/mine", response_model=InterviewListResponse)
async def my_interviews(
    status: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=500),
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.list_my_interviews(
        db, user_id=user.id, status=status,
        date_from=date_from, date_to=date_to, page=page, limit=limit,
    )


@router.get("", response_model=InterviewListResponse)
async def list_interviews(
    application_id: Optional[uuid.UUID] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=500),
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.list_interviews(
        db, application_id=application_id, status=status,
        date_from=date_from, date_to=date_to, page=page, limit=limit,
    )


# ── Public (token-based, no auth): interviewer feedback from email link ─────
# Must be declared before the /{interview_id} routes so they match first.

@router.get("/feedback-by-token/{token}")
async def get_feedback_by_token(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.get_feedback_context_by_token(db, token)


@router.post("/feedback-by-token/{token}", response_model=InterviewFeedbackResponse)
async def submit_feedback_by_token(
    token: str,
    data: InterviewFeedbackCreate,
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.submit_feedback_by_token(db, token, data)


@router.post("/feedback-by-token/{token}/attachment")
async def upload_feedback_attachment_by_token(
    token: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.upload_feedback_attachment_by_token(db, token, file)


@router.get("/{interview_id}", response_model=InterviewResponse)
async def get_interview(
    interview_id: uuid.UUID,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.get_interview(db, interview_id)


@router.patch("/{interview_id}", response_model=InterviewResponse)
async def update_interview(
    interview_id: uuid.UUID,
    data: InterviewUpdate,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.update_interview(db, interview_id, data)


@router.patch("/{interview_id}/complete", response_model=InterviewResponse)
async def complete_interview(
    interview_id: uuid.UUID,
    data: CompleteInterviewRequest = CompleteInterviewRequest(),
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.complete_interview(db, interview_id, notes=data.notes)


@router.delete("/{interview_id}", status_code=204)
async def cancel_interview(
    interview_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    await interview_service.cancel_interview(db, interview_id)


@router.post("/{interview_id}/feedback", response_model=InterviewFeedbackResponse)
async def submit_feedback(
    interview_id: uuid.UUID,
    data: InterviewFeedbackCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.submit_feedback(db, interview_id, data, submitted_by=user.id)


@router.post("/{interview_id}/feedback/attachment")
async def upload_feedback_attachment(
    interview_id: uuid.UUID,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.upload_feedback_attachment(db, interview_id, file)


@router.get("/{interview_id}/feedback", response_model=list[InterviewFeedbackResponse])
async def get_feedback(
    interview_id: uuid.UUID,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.get_feedback(db, interview_id)


@router.get("/{interview_id}/candidate-summary", response_model=CandidateInterviewSummary)
async def get_candidate_interview_summary(
    interview_id: uuid.UUID,
    user=Depends(require_roles(Role.APPLICANT)),
    db: AsyncSession = Depends(get_db),
):
    rows = await interview_service.list_candidate_interviews(db, None, user.id, interview_id=interview_id)
    if not rows:
        from fastapi import HTTPException
        raise HTTPException(404, "Interview not found or not yours")
    return rows[0]


@router.post("/{interview_id}/self-feedback", response_model=CandidateSelfFeedbackResponse, status_code=201)
async def submit_self_feedback(
    interview_id: uuid.UUID,
    data: CandidateSelfFeedbackCreate,
    user=Depends(require_roles(Role.APPLICANT)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.submit_self_feedback(db, interview_id, data, candidate_id=user.id)


@router.get("/{interview_id}/self-feedback", response_model=CandidateSelfFeedbackResponse)
async def get_self_feedback(
    interview_id: uuid.UUID,
    user=Depends(require_roles(Role.APPLICANT)),
    db: AsyncSession = Depends(get_db),
):
    row = await interview_service.get_self_feedback(db, interview_id, candidate_id=user.id)
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, "No self-feedback submitted yet")
    return row
