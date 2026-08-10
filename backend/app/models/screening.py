import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class ScreeningResponse(Base):
    """One-off screening form for the Intern - AI Engineering / Associate AI
    Engineer backlog. Meant to be dropped later once this pass is done —
    see the c0d1e2f3a4b5 migration."""

    __tablename__ = "screening_responses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)

    college_name: Mapped[str | None] = mapped_column(String(255))
    degree: Mapped[str | None] = mapped_column(String(100))
    branch: Mapped[str | None] = mapped_column(String(100))
    graduation_year: Mapped[int | None] = mapped_column(Integer)
    cgpa: Mapped[str | None] = mapped_column(String(20))
    key_skills: Mapped[str | None] = mapped_column(Text)
    certifications: Mapped[list] = mapped_column(JSONB, default=list)
    # each: {name, issuer, year}
    projects: Mapped[list] = mapped_column(JSONB, default=list)
    # each: {title, description, tech_stack, link}

    email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("application_id", name="uq_screening_response_application"),)
