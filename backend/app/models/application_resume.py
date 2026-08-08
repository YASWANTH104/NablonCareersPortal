import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ApplicationResume(Base):
    """One revision of a candidate's resume for a single application.

    `Application.resume_url` still points at the newest revision, so every
    existing read path (list, detail, exports, the HR resume tab) keeps working
    untouched — this table is the history sitting behind that pointer. It exists
    because panels interview against a specific version: without it, a candidate
    uploading a revised CV silently rewrites what a completed TR1 was judged on.
    """

    __tablename__ = "application_resumes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # 1-based, contiguous per application. Version 1 is the resume submitted
    # with the application itself.
    version: Mapped[int] = mapped_column(Integer, nullable=False)

    file_url: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(255))
    note: Mapped[str | None] = mapped_column(Text)

    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    # Snapshot of the uploader's role at upload time — a user's role can change
    # later, and "who replaced this, candidate or recruiter" must stay accurate.
    uploaded_by_role: Mapped[str | None] = mapped_column(String(30))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("application_id", "version", name="uq_application_resume_version"),
    )
