import uuid
from datetime import datetime
from pydantic import BaseModel, EmailStr
from typing import Optional


class AgencyCreate(BaseModel):
    name: str
    contact_name: Optional[str] = None
    contact_email: str


class AgencyUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    is_active: Optional[bool] = None


class AgencyResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    contact_name: Optional[str] = None
    contact_email: str
    portal_token: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class JobAgencyAssignmentCreate(BaseModel):
    agency_id: uuid.UUID
    max_submissions: Optional[int] = None
    expires_at: Optional[datetime] = None


class JobAgencyAssignmentUpdate(BaseModel):
    # Only fields actually sent are applied (exclude_unset), so an explicit
    # null still means "unlimited" / "no end date" while an omitted field is
    # left as-is.
    max_submissions: Optional[int] = None
    expires_at: Optional[datetime] = None


class JobAgencyAssignmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_id: uuid.UUID
    agency_id: uuid.UUID
    ref_token: str
    max_submissions: Optional[int] = None
    expires_at: Optional[datetime] = None
    created_at: datetime
    agency_name: Optional[str] = None
    job_title: Optional[str] = None


class AgencyPortalAssessment(BaseModel):
    """What an agency sees of its candidate's assessment: status, dates and
    headline scores. Never the questions, answers or responses file — those
    would leak the question bank to every agency."""
    title: str
    status: str
    sent_at: datetime
    deadline: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    score_pct: Optional[float] = None
    points_scored: Optional[float] = None
    points_available: Optional[float] = None
    trust_pct: Optional[int] = None
    flags: Optional[int] = None
    graded: Optional[bool] = None
    # advanced | rejected | skipped — what the result did to the candidate
    decision: Optional[str] = None


class AgencyPortalInterview(BaseModel):
    """One interview round as the agency sees it: when, which round, and where
    it stands. Never the interviewers or what they wrote — the slot flow is
    deliberately anonymous, and feedback is HR's to share."""
    round_type: Optional[str] = None
    round_label: str
    scheduled_at: datetime
    duration_mins: int
    interview_type: Optional[str] = None
    # scheduled | rescheduled | awaiting_feedback | feedback_received | cancelled | no_show
    status: str


class AgencyPortalCandidate(BaseModel):
    application_id: uuid.UUID
    candidate_name: str
    stage: str
    applied_at: datetime
    stage_updated_at: datetime
    # Rounds this candidate already has a live (non-cancelled) interview for.
    # The portal hides them from those rounds' booking lists; cancelling the
    # interview drops the round out of here and the name comes back on its own.
    booked_rounds: list[str] = []
    assessment: Optional[AgencyPortalAssessment] = None
    # Newest first
    interviews: list[AgencyPortalInterview] = []


class AgencyPortalResponse(BaseModel):
    agency_name: str
    job_title: str
    ref_token: str
    max_submissions: Optional[int] = None
    expires_at: Optional[datetime] = None
    submission_count: int
    candidates: list[AgencyPortalCandidate]


# ── Agency slot requests ─────────────────────────────────────────────────────

from datetime import date as _date
from typing import Literal
from pydantic import Field, model_validator


class AgencySlotRequestCreate(BaseModel):
    round_type: Literal["screening", "tr1", "tr2", "final_tr", "hr"]
    candidates_count: int = Field(default=1, ge=1, le=50)
    date_from: _date
    date_to: _date
    time_preference: Literal["any", "morning", "afternoon", "evening"] = "any"
    note: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _dates(self):
        if self.date_to < self.date_from:
            raise ValueError("The end date can't be before the start date")
        if (self.date_to - self.date_from).days > 30:
            raise ValueError("Pick a window of 30 days or less")
        return self


class AgencySlotRequestResponse(BaseModel):
    id: uuid.UUID
    round_type: str
    round_label: str
    candidates_count: int
    date_from: _date
    date_to: _date
    time_preference: str
    note: Optional[str] = None
    status: str
    created_at: datetime
    resolved_at: Optional[datetime] = None
    resolution_note: Optional[str] = None
    slots_published: Optional[int] = None
    # HR inbox only
    agency_id: Optional[uuid.UUID] = None
    agency_name: Optional[str] = None
    job_id: Optional[uuid.UUID] = None
    job_title: Optional[str] = None
    open_slots_now: Optional[int] = None


class AgencySlotRequestResolve(BaseModel):
    status: Literal["fulfilled", "dismissed"]
    note: Optional[str] = Field(default=None, max_length=500)
