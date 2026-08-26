import uuid
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

from app.constants.stages import SLOT_ROUND_TYPES

# Re-exported under the old name — several call sites import ROUND_TYPES
# from here rather than from app.constants.stages.
ROUND_TYPES = SLOT_ROUND_TYPES
ROUND_TYPE_PATTERN = "^(" + "|".join(SLOT_ROUND_TYPES) + ")$"


class SlotPublishRequest(BaseModel):
    interviewer_id: Optional[uuid.UUID] = None
    # Only HR/admin may set this to someone other than themselves — enforced
    # in the service layer, not just the router's role gate.
    # Both optional now: an interviewer publishing their own availability no
    # longer picks a job/round at all — that happens later via SlotAssignBatchRequest,
    # once HR assigns the slot to a specific job's hiring pipeline.
    job_id: Optional[uuid.UUID] = None
    round_type: Optional[str] = Field(default=None, pattern=ROUND_TYPE_PATTERN)
    duration_mins: Literal[30, 60] = 60
    start_times: list[datetime] = Field(min_length=1)


class SlotRescheduleRequest(BaseModel):
    """Editing a not-yet-booked slot's time and/or duration in place. Duration
    is capped to the same {30, 60} set as SlotPublishRequest/AgencySlotBookRequest —
    a resized slot must stay bookable by the agency self-book path, which only
    ever queries for 30 or 60 min slots."""
    start_time: Optional[datetime] = None
    duration_mins: Optional[Literal[30, 60]] = None


class SlotAssignBatchRequest(BaseModel):
    """HR picking a job+round once and applying it to several selected slots
    at the same time, instead of repeating the single-slot assign per slot."""
    slot_ids: list[uuid.UUID] = Field(min_length=1)
    job_id: uuid.UUID
    round_type: str = Field(pattern=ROUND_TYPE_PATTERN)


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


class AgencyBookingConfirmation(BaseModel):
    """What an agency gets back after booking. Deliberately NOT SlotResponse:
    that carries interviewer_id/interviewer_name, and returning it here defeated
    the anonymisation the whole agency slot flow is built around — an agency
    could book, read interviewer_id off the response, and map the panel across
    bookings. Nothing identifying the interviewer belongs in this payload."""
    id: uuid.UUID
    job_id: Optional[uuid.UUID] = None
    round_type: Optional[str] = None
    start_time: datetime
    duration_mins: int
    status: str


class SlotBookRequest(BaseModel):
    slot_id: uuid.UUID
    application_id: uuid.UUID
    # HR-only escape hatch from the STAGE half of the round gate: normally the
    # candidate must be sitting at the stage the round belongs to. HR is the
    # authority on the internal pipeline and routinely books a round before
    # formally moving the stage, so that rule is a default here, not a wall.
    # It does NOT relax the duplicate rule — a candidate who already has a live
    # interview for the round still can't be booked into it again, by anyone.
    # Agencies have no equivalent flag; both rules are absolute for them.
    override_stage_gate: bool = False


class SlotBookUnassignedRequest(BaseModel):
    """HR's "Book for an interviewer" direct-booking path: picking the job,
    round, and candidate for a still-unassigned slot all in one action,
    instead of assigning a job/round first (which would make the slot
    visible to agencies) and only then picking a candidate."""
    slot_id: uuid.UUID
    job_id: uuid.UUID
    round_type: str = Field(pattern=ROUND_TYPE_PATTERN)
    application_id: uuid.UUID
    override_stage_gate: bool = False  # see SlotBookRequest


class AgencySlotBookRequest(BaseModel):
    start_time: datetime
    round_type: str = Field(pattern=ROUND_TYPE_PATTERN)
    duration_mins: Literal[30, 60] = 30
    application_id: uuid.UUID
