import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, Text, DateTime, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False, index=True)
    applicant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    referral_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("referrals.id"))

    resume_url: Mapped[str] = mapped_column(Text, nullable=False)
    cover_letter: Mapped[str | None] = mapped_column(Text)
    linkedin_url: Mapped[str | None] = mapped_column(Text)
    portfolio_url: Mapped[str | None] = mapped_column(Text)
    github_url: Mapped[str | None] = mapped_column(Text)
    # Compensation — collected optionally at apply time, editable later.
    # Free text (e.g. "18 LPA", "₹24,00,000") rather than numeric.
    # 255, not 50: these are deliberately free-text, and real answers overflowed
    # a 50-char cap ("3 months, negotiable — currently serving until 15 Sept"),
    # which surfaced as a Postgres StringDataRightTruncationError at commit and
    # a bare 500 for whoever was submitting. See _validate_free_text_lengths.
    current_ctc: Mapped[str | None] = mapped_column(String(255))
    expected_ctc: Mapped[str | None] = mapped_column(String(255))
    notice_period: Mapped[str | None] = mapped_column(String(255))
    answers: Mapped[dict] = mapped_column(JSONB, default=dict)

    stage: Mapped[str] = mapped_column(String(50), default="applied", index=True)
    # applied | screening | assessment | tr1 | tr2 | hr | offer | hired | rejected
    # | withdrawn | interview_drop | offer_drop  (see app/constants/stages.py)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    # Structured category for rejected/interview_drop/offer_drop, e.g. "got_another_offer" —
    # rejection_reason above is reused as the free-text note across all three.
    drop_category: Mapped[str | None] = mapped_column(String(50))

    source: Mapped[str] = mapped_column(String(50), default="direct")
    agency_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("agencies.id"))
    rating: Mapped[int | None] = mapped_column(Integer)
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False)
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    # On-hold is orthogonal to `stage` — the candidate stays in their current
    # Kanban column, just flagged paused (e.g. waiting on budget approval).
    on_hold: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    hold_reason: Mapped[str | None] = mapped_column(Text)

    # Possible-duplicate detection — set when another candidate account shares this
    # applicant's normalized full name (identity may have changed email/phone since).
    # Never blocks the application; HR reviews and dismisses via duplicate_reviewed_*.
    duplicate_flag: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    duplicate_reason: Mapped[str | None] = mapped_column(Text)
    duplicate_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duplicate_reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    stage_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("job_id", "applicant_id", name="uq_application_job_applicant"),)

    stage_history: Mapped[list["ApplicationStageHistory"]] = relationship(
        "ApplicationStageHistory", back_populates="application", cascade="all, delete-orphan"
    )


class ApplicationStageHistory(Base):
    __tablename__ = "application_stage_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    from_stage: Mapped[str | None] = mapped_column(String(50))
    to_stage: Mapped[str] = mapped_column(String(50), nullable=False)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    # Files/images attached to a note (to_stage == "_note"). Never set on a real
    # stage-transition row. [{url, name, content_type, size}, ...]
    attachments: Mapped[list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    application: Mapped["Application"] = relationship("Application", back_populates="stage_history")
