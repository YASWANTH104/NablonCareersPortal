import uuid
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

ROUND_TYPES = ("tr1", "tr2", "hr")


class SlotPublishRequest(BaseModel):
    interviewer_id: Optional[uuid.UUID] = None
    # Only HR/admin may set this to someone other than themselves — enforced
    # in the service layer, not just the router's role gate.
    # Both optional now: an interviewer publishing their own availability no
    # longer picks a job/round at all — that happens later via SlotAssignBatchRequest,
    # once HR assigns the slot to a specific job's hiring pipeline.
    job_id: Optional[uuid.UUID] = None
    round_type: Optional[str] = Field(default=None, pattern="^(tr1|tr2|hr)$")
    duration_mins: Literal[30, 60] = 60
    start_times: list[datetime] = Field(min_length=1)


class SlotAssignBatchRequest(BaseModel):
    """HR picking a job+round once and applying it to several selected slots
    at the same time, instead of repeating the single-slot assign per slot."""
    slot_ids: list[uuid.UUID] = Field(min_length=1)
    job_id: uuid.UUID
    round_type: str = Field(pattern="^(tr1|tr2|hr)$")


class SlotResponse(BaseModel):
    id: uuid.UUID
    job_id: Optional[uuid.UUID] = None
    job_title: Optional[str] = None
    round_type: Optional[str] = None
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


class SlotBookUnassignedRequest(BaseModel):
    """HR's "Book for an interviewer" direct-booking path: picking the job,
    round, and candidate for a still-unassigned slot all in one action,
    instead of assigning a job/round first (which would make the slot
    visible to agencies) and only then picking a candidate."""
    slot_id: uuid.UUID
    job_id: uuid.UUID
    round_type: str = Field(pattern="^(tr1|tr2|hr)$")
    application_id: uuid.UUID


class AgencySlotBookRequest(BaseModel):
    start_time: datetime
    round_type: str = Field(pattern="^(tr1|tr2|hr)$")
    duration_mins: Literal[30, 60] = 30
    application_id: uuid.UUID
