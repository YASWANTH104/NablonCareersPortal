import uuid
import secrets
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Campus(Base):
    """A college/university placement cell — same token-portal shape as Agency
    (see app/models/agency.py): the portal_token IS the credential, no login."""

    __tablename__ = "campuses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_name: Mapped[str | None] = mapped_column(String(255))
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    portal_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True, default=lambda: secrets.token_urlsafe(32))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class JobCampusAssignment(Base):
    """A placement drive: one campus opened to one job req. ref_token is the
    student-facing self-apply link; the portal's bulk roster upload and bulk
    assessment scheduling both operate on the candidates this produces."""

    __tablename__ = "job_campus_assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False, index=True)
    campus_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campuses.id"), nullable=False, index=True)
    ref_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True, default=lambda: secrets.token_urlsafe(16))
    drive_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_submissions: Mapped[int | None] = mapped_column(Integer)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
