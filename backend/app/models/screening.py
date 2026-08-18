import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, Integer, Numeric, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class ScreeningResponse(Base):
    """One screening questionnaire per application — created and emailed to the
    candidate right after their application-received email, on any job with
    `Job.screening_enabled = True` (see application_service.submit_application /
    submit_sourced_application). Candidate submits once via the public token
    link; scoring runs immediately on submit and the outcome auto-advances the
    application to `screening` (pass) or `rejected` (hard-gate fail) — see
    app/services/screening_service.py."""

    __tablename__ = "screening_responses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # pending | submitted

    # ── Candidate-submitted answers ──────────────────────────────────────────
    college_name: Mapped[str | None] = mapped_column(String(255))
    cgpa: Mapped[float | None] = mapped_column(Numeric(4, 2))
    relevant_experience: Mapped[str | None] = mapped_column(Text)
    skills: Mapped[list | None] = mapped_column(JSONB)
    # [{title, description, github_url, tech_stack}, ...]
    projects: Mapped[list | None] = mapped_column(JSONB)
    achievements: Mapped[str | None] = mapped_column(Text)
    github_profile_url: Mapped[str | None] = mapped_column(Text)

    # ── Scoring output (see screening_service.SCORE_WEIGHTS) ─────────────────
    college_tier: Mapped[int | None] = mapped_column(Integer)  # 1 (best) .. 5 (worst)
    college_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    cgpa_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    skills_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    project_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    overall_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    recommendation: Mapped[str | None] = mapped_column(String(30))
    # strong_fit | moderate_fit | weak_fit — unset when auto_reject is True

    # Hard-gate rejection (college tier 4/5, or CGPA < 8) — deterministic, not
    # AI-judged, so it behaves identically whether or not Azure OpenAI is configured.
    auto_reject: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    auto_reject_reason: Mapped[str | None] = mapped_column(Text)  # internal/HR-facing detail

    # Free-form reasoning per dimension, HR-facing only — never shown to the candidate.
    # {"college": "...", "skills": "...", "projects": "..."}
    ai_reasoning: Mapped[dict | None] = mapped_column(JSONB)
    is_ai_scored: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("application_id", name="uq_screening_response_application"),)
