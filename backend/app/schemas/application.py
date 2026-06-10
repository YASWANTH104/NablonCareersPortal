import uuid
from datetime import datetime
from pydantic import BaseModel
from typing import Optional


class ApplicationCreate(BaseModel):
    job_id: uuid.UUID
    resume_url: str
    cover_letter: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None
    answers: dict = {}
    referral_id: Optional[uuid.UUID] = None


class ApplicationUpdate(BaseModel):
    cover_letter: Optional[str] = None
    resume_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None


class ApplicationStageUpdate(BaseModel):
    stage: str
    notes: Optional[str] = None


class ApplicationRatingUpdate(BaseModel):
    rating: Optional[int] = None


class ApplicationAssignUpdate(BaseModel):
    assignee_id: Optional[uuid.UUID] = None


class NoteCreate(BaseModel):
    note: str


class ApplicantBrief(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    avatar_url: Optional[str] = None


class StageHistoryEntry(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    from_stage: Optional[str] = None
    to_stage: str
    notes: Optional[str] = None
    changed_by: Optional[uuid.UUID] = None
    created_at: datetime


class ApplicationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_id: uuid.UUID
    applicant_id: uuid.UUID
    referral_id: Optional[uuid.UUID] = None
    resume_url: str
    cover_letter: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None
    answers: dict
    stage: str
    rejection_reason: Optional[str] = None
    source: str
    rating: Optional[int] = None
    is_starred: bool
    assigned_to: Optional[uuid.UUID] = None
    applied_at: datetime
    stage_updated_at: datetime
    created_at: datetime
    updated_at: datetime
    applicant: Optional[ApplicantBrief] = None
    job_title: Optional[str] = None


class ApplicationDetailResponse(ApplicationResponse):
    stage_history: list[StageHistoryEntry] = []
    interview_count: int = 0


class ApplicationListResponse(BaseModel):
    items: list[ApplicationResponse]
    total: int
    page: int
    limit: int
    pages: int
