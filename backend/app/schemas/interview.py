import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class PanelistCreate(BaseModel):
    user_id: uuid.UUID
    role: str = "interviewer"  # interviewer | observer


class InterviewCreate(BaseModel):
    application_id: uuid.UUID
    round_number: int = 1
    title: Optional[str] = None
    interview_type: Optional[str] = None  # video | phone | onsite | technical | hr | panel
    scheduled_at: datetime
    duration_mins: int = 60
    meeting_link: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    panelists: list[PanelistCreate] = []


class InterviewUpdate(BaseModel):
    round_number: Optional[int] = None
    title: Optional[str] = None
    interview_type: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_mins: Optional[int] = None
    meeting_link: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class PanelistResponse(BaseModel):
    model_config = {"from_attributes": True}

    interview_id: uuid.UUID
    user_id: uuid.UUID
    role: str


class InterviewFeedbackCreate(BaseModel):
    overall_rating: Optional[int] = None  # 1-5
    recommendation: Optional[str] = None  # strong_yes | yes | neutral | no | strong_no
    technical_score: Optional[int] = None
    communication_score: Optional[int] = None
    cultural_fit_score: Optional[int] = None
    problem_solving_score: Optional[int] = None
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    notes: Optional[str] = None


class InterviewFeedbackResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    interview_id: uuid.UUID
    submitted_by: uuid.UUID
    overall_rating: Optional[int] = None
    recommendation: Optional[str] = None
    technical_score: Optional[int] = None
    communication_score: Optional[int] = None
    cultural_fit_score: Optional[int] = None
    problem_solving_score: Optional[int] = None
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    notes: Optional[str] = None
    is_shared_with_candidate: bool
    created_at: datetime


class PreviousRoundFeedbackEntry(BaseModel):
    round_number: int
    interview_title: Optional[str] = None
    feedback: list[InterviewFeedbackResponse]


class InterviewResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    application_id: uuid.UUID
    round_number: int
    title: Optional[str] = None
    interview_type: Optional[str] = None
    scheduled_at: datetime
    duration_mins: int
    meeting_link: Optional[str] = None
    location: Optional[str] = None
    status: str
    notes: Optional[str] = None
    created_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime
    panelists: list[PanelistResponse] = []
    feedback: list[InterviewFeedbackResponse] = []
    # Enriched fields (populated in list view)
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    job_id: Optional[uuid.UUID] = None
    candidate_self_feedback: Optional["CandidateSelfFeedbackResponse"] = None
    previous_rounds_feedback: list[PreviousRoundFeedbackEntry] = []


class InterviewListResponse(BaseModel):
    items: list[InterviewResponse]
    total: int
    page: int
    limit: int
    pages: int


class CandidateSelfFeedbackCreate(BaseModel):
    overall_score: Optional[int] = None          # 0-10
    communication_score: Optional[int] = None    # 0-10
    technical_confidence: Optional[int] = None   # 0-10
    was_prepared: Optional[bool] = None
    would_recommend: Optional[bool] = None
    difficulty: Optional[str] = None             # easy | medium | hard | very_hard
    experience_rating: Optional[str] = None      # excellent | good | average | poor
    comments: Optional[str] = None


class CandidateSelfFeedbackResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    interview_id: uuid.UUID
    candidate_id: uuid.UUID
    overall_score: Optional[int] = None
    communication_score: Optional[int] = None
    technical_confidence: Optional[int] = None
    was_prepared: Optional[bool] = None
    would_recommend: Optional[bool] = None
    difficulty: Optional[str] = None
    experience_rating: Optional[str] = None
    comments: Optional[str] = None
    created_at: datetime


class CandidateInterviewSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    application_id: uuid.UUID
    round_number: int
    title: Optional[str] = None
    interview_type: Optional[str] = None
    scheduled_at: datetime
    duration_mins: int
    status: str
    self_feedback_submitted: bool = False
