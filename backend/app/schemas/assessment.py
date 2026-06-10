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
