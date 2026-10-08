import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ActionSnooze(Base):
    """An Action Center item a recruiter has deliberately parked ("candidate is
    travelling, chase on Monday"). Keyed on (application, action_type, stage)
    rather than application alone: once the candidate moves stage the old
    snooze no longer matches, so a parked "schedule TR1" can never silently
    hide the "schedule TR2" that follows it. Team-wide, not per-viewer — the
    alert is about the candidate, and whoever opens the Action Center next
    should see that someone already parked it and why."""
    __tablename__ = "action_snoozes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="CASCADE"), nullable=False,
    )
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    stage: Mapped[str] = mapped_column(String(50), nullable=False)
    snoozed_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    snoozed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (
        Index("ix_action_snoozes_lookup", "application_id", "action_type", "stage"),
    )
