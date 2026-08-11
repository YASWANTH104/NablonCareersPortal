import uuid
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

ROUND_TYPES = ("tr1", "tr2", "hr")


class SlotPublishRequest(BaseModel):
    interviewer_id: Optional[uuid.UUID] = None
    # Only HR/admin may set this to someone other than themselves — enforced
    # in the service layer, not just the router's role gate.
    job_id: uuid.UUID
    round_type: str = Field(pattern="^(tr1|tr2|hr)$")
    duration_mins: Literal[30, 60] = 30
    start_times: list[datetime] = Field(min_length=1)


class SlotResponse(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    job_title: Optional[str] = None
    round_type: str
    start_time: datetime
    duration_mins: int
    status: str
    interview_id: Optional[uuid.UUID] = None
    interviewer_id: Optional[uuid.UUID] = None
    interviewer_name: Optional[str] = None
    candidate_name: Optional[str] = None

    model_config = {"from_attributes": True}


class AvailableSlotGroup(BaseModel):
    """Anonymized aggregate — no interviewer identity, ever."""
    start_time: datetime
    duration_mins: int
    round_type: str
    available_count: int


class SlotBookRequest(BaseModel):
    slot_id: uuid.UUID
    application_id: uuid.UUID


class AgencySlotBookRequest(BaseModel):
    start_time: datetime
    round_type: str = Field(pattern="^(tr1|tr2|hr)$")
    duration_mins: Literal[30, 60] = 30
    application_id: uuid.UUID
