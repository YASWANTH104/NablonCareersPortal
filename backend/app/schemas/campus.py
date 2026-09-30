import uuid
from datetime import datetime
from pydantic import BaseModel
from typing import Optional


class CampusCreate(BaseModel):
    name: str
    contact_name: Optional[str] = None
    contact_email: str


class CampusUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    is_active: Optional[bool] = None


class CampusResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    contact_name: Optional[str] = None
    contact_email: str
    portal_token: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class JobCampusAssignmentCreate(BaseModel):
    campus_id: uuid.UUID
    drive_date: Optional[datetime] = None
    max_submissions: Optional[int] = None
    expires_at: Optional[datetime] = None


class JobCampusAssignmentUpdate(BaseModel):
    drive_date: Optional[datetime] = None
    max_submissions: Optional[int] = None


class JobCampusAssignmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_id: uuid.UUID
    campus_id: uuid.UUID
    ref_token: str
    drive_date: Optional[datetime] = None
    max_submissions: Optional[int] = None
    expires_at: Optional[datetime] = None
    created_at: datetime
    campus_name: Optional[str] = None
    job_title: Optional[str] = None


class CampusPortalCandidate(BaseModel):
    application_id: uuid.UUID
    candidate_name: str
    email: str
    stage: str
    applied_at: datetime
    stage_updated_at: datetime
    has_assessment: bool = False


class CampusPortalResponse(BaseModel):
    campus_name: str
    job_title: str
    ref_token: str
    drive_date: Optional[datetime] = None
    max_submissions: Optional[int] = None
    expires_at: Optional[datetime] = None
    submission_count: int
    candidates: list[CampusPortalCandidate]


class CampusBulkScheduleRequest(BaseModel):
    """One assessment created per application_id — see
    assessment_service.bulk_create_assessments. Each creation dispatches its
    own candidate email independently (Celery), so this is the "bulk email"
    action for a placement drive."""

    application_ids: list[uuid.UUID]
    title: str
    assessment_type: str = "online_test"
    deadline: datetime
    duration_mins: Optional[int] = None
    platform_link: str
    instructions: Optional[str] = None
