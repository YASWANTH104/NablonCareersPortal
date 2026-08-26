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
    max_submissions: Optional[int] = None


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


class AgencyPortalResponse(BaseModel):
    agency_name: str
    job_title: str
    ref_token: str
    max_submissions: Optional[int] = None
    expires_at: Optional[datetime] = None
    submission_count: int
    candidates: list[AgencyPortalCandidate]
