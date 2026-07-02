import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, Text, DateTime, Integer, ForeignKey, PrimaryKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Interview(Base):
    __tablename__ = "interviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    round_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    title: Mapped[str | None] = mapped_column(String(255))
    interview_type: Mapped[str | None] = mapped_column(String(30))
    # video | phone | onsite | technical | hr | panel
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_mins: Mapped[int] = mapped_column(Integer, default=60)
    meeting_link: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="scheduled")
    # scheduled | completed | cancelled | no_show | rescheduled
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    last_feedback_reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    panelists: Mapped[list["InterviewPanelist"]] = relationship(
        "InterviewPanelist", back_populates="interview", cascade="all, delete-orphan"
    )
    feedback: Mapped[list["InterviewFeedback"]] = relationship(
        "InterviewFeedback", back_populates="interview", cascade="all, delete-orphan"
    )


class InterviewPanelist(Base):
    __tablename__ = "interview_panelists"

    interview_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("interviews.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(50), default="interviewer")  # interviewer | observer

    __table_args__ = (PrimaryKeyConstraint("interview_id", "user_id"),)

    interview: Mapped["Interview"] = relationship("Interview", back_populates="panelists")


class InterviewFeedback(Base):
    __tablename__ = "interview_feedback"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("interviews.id"), nullable=False)
    submitted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    overall_rating: Mapped[int | None] = mapped_column(Integer)
    recommendation: Mapped[str | None] = mapped_column(String(20))
    # strong_yes | yes | neutral | no | strong_no

    technical_score: Mapped[int | None] = mapped_column(Integer)
    communication_score: Mapped[int | None] = mapped_column(Integer)
    cultural_fit_score: Mapped[int | None] = mapped_column(Integer)
    problem_solving_score: Mapped[int | None] = mapped_column(Integer)

    strengths: Mapped[str | None] = mapped_column(Text)
    weaknesses: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    is_shared_with_candidate: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    interview: Mapped["Interview"] = relationship("Interview", back_populates="feedback")


class CandidateInterviewSelfFeedback(Base):
    """Candidate's own post-interview self-assessment."""
    __tablename__ = "candidate_interview_self_feedback"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("interviews.id"), nullable=False, unique=True)
    candidate_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Heatmap scores 0-10
    overall_score: Mapped[int | None] = mapped_column(Integer)
    communication_score: Mapped[int | None] = mapped_column(Integer)
    technical_confidence: Mapped[int | None] = mapped_column(Integer)

    # Yes / No
    was_prepared: Mapped[bool | None] = mapped_column(Boolean)
    would_recommend: Mapped[bool | None] = mapped_column(Boolean)

    # Multiple choice
    difficulty: Mapped[str | None] = mapped_column(String(20))
    # easy | medium | hard | very_hard
    experience_rating: Mapped[str | None] = mapped_column(String(20))
    # excellent | good | average | poor

    comments: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    interview: Mapped["Interview"] = relationship("Interview")
