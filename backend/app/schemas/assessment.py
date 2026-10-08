import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class AssessmentCreate(BaseModel):
    application_id: uuid.UUID
    title: str
    assessment_type: str = "online_test"
    deadline: datetime
    duration_mins: Optional[int] = None
    platform_link: str
    instructions: Optional[str] = None


class AssessmentUpdate(BaseModel):
    title: Optional[str] = None
    assessment_type: Optional[str] = None
    deadline: Optional[datetime] = None
    duration_mins: Optional[int] = None
    platform_link: Optional[str] = None
    instructions: Optional[str] = None
    status: Optional[str] = None
    score: Optional[float] = None
    max_score: Optional[float] = None
    evaluator_notes: Optional[str] = None


class AssessmentBulkCreate(BaseModel):
    """Schedule the same assessment for many applications at once — each row
    creates its own Assessment and fires its own candidate email independently
    (see assessment_service.bulk_create_assessments), so one bad application_id
    never blocks the rest of the batch."""

    application_ids: list[uuid.UUID]
    title: str
    assessment_type: str = "online_test"
    deadline: datetime
    duration_mins: Optional[int] = None
    platform_link: str
    instructions: Optional[str] = None


class AssessmentBulkResultRow(BaseModel):
    application_id: uuid.UUID
    status: str
    assessment_id: Optional[uuid.UUID] = None
    error: Optional[str] = None
    # Whether the candidate was also moved to the "assessment" stage, and why
    # not when they weren't (on hold, already past it, closed).
    stage_moved: Optional[bool] = None
    stage_note: Optional[str] = None


class AssessmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    application_id: uuid.UUID
    title: str
    assessment_type: str
    deadline: Optional[datetime] = None
    duration_mins: Optional[int] = None
    platform_link: Optional[str] = None
    instructions: Optional[str] = None
    status: str
    score: Optional[float] = None
    max_score: Optional[float] = None
    evaluator_notes: Optional[str] = None
    created_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime
