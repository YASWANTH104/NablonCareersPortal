import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class InterviewSlot(Base):
    """A block of time an interviewer has published as available. Booking one
    (by an agency, anonymized, or by HR, full detail) creates a real
    Interview and flips this row to 'booked'."""

    __tablename__ = "interview_slots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interviewer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # Nullable: an interviewer publishes raw free time with no job/round
    # attached at all. HR later "assigns" a job+round to an open slot (see
    # assign_slots_batch in interview_slot_service.py), which is what makes it
    # show up for that job's agencies to book. NULL here means "not yet
    # assigned". Booking an unassigned slot directly for an internal
    # candidate (book_unassigned_slot) sets job_id/round_type and status to
    # "booked" in the same atomic step instead, so it never passes through
    # this agency-visible "assigned but open" state at all.
    job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id"))
    round_type: Mapped[str | None] = mapped_column(String(20))
    # tr1 | tr2 | hr — mirrors the pipeline stage vocabulary in app/constants/stages.py
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_mins: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    # open | booked
    interview_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("interviews.id"))
    booked_by_agency_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("agencies.id"))
    booked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("interviewer_id", "start_time", name="uq_interview_slot_interviewer_time"),)
