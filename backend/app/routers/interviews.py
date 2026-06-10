import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles, Role
from pydantic import BaseModel
from app.schemas.interview import (
    InterviewCreate, InterviewUpdate, InterviewResponse,
    InterviewFeedbackCreate, InterviewFeedbackResponse,
    InterviewListResponse,
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


@router.get("/mine", response_model=InterviewListResponse)
async def my_interviews(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.list_my_interviews(
        db, user_id=user.id, status=status, page=page, limit=limit
    )


@router.get("", response_model=InterviewListResponse)
async def list_interviews(
    application_id: Optional[uuid.UUID] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.list_interviews(
        db, application_id=application_id, status=status, page=page, limit=limit
    )


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


@router.get("/{interview_id}/feedback", response_model=list[InterviewFeedbackResponse])
async def get_feedback(
    interview_id: uuid.UUID,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_service.get_feedback(db, interview_id)
