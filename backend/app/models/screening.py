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
    # College is scored against NIRF India Rankings 2025 (Engineering) — see
    # app/constants/nirf_rankings.py. college_tier is now a coarse derived
    # bucket kept only for the existing HR badge (1 = NIRF top 25, 2 = NIRF
    # top 100, 3 = NIRF 101-150 band, None = unranked) — it has no gating
    # meaning; college_nirf_rank/band carry the real published figure.
    college_tier: Mapped[int | None] = mapped_column(Integer)
    college_nirf_rank: Mapped[int | None] = mapped_column(Integer)  # exact rank 1-100, if published
    college_nirf_band: Mapped[str | None] = mapped_column(String(20))  # e.g. "101-150", if only banded
    college_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    cgpa_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    skills_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    project_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    overall_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    recommendation: Mapped[str | None] = mapped_column(String(30))
    # strong_fit | moderate_fit | weak_fit — unset when auto_reject is True

    # Hard-gate rejection (CGPA below the floor, or overall composite score
    # below the floor) — deterministic, not AI-judged, so it behaves
    # identically whether or not Azure OpenAI is configured. College is
    # scoring-only (NIRF-based) and never gates rejection on its own — see
    # screening_service.score_screening_response.
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
