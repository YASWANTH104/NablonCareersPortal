import uuid
from datetime import date, datetime
from sqlalchemy import String, Text, Integer, Float, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class AutoproctorAttempt(Base):
    """One submitted AutoProctor test attempt, imported by the nightly sync
    (tasks/autoproctor_tasks.py). Imported whether or not it matches one of our
    assessments — an unmatched row is usually a candidate who sat the test
    under a different email, and HR links it by hand from the Assessments page.
    """
    __tablename__ = "autoproctor_attempts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # AutoProctor's own short id ("20Exr1GYhh") — what its report URLs use.
    attempt_label: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    test_label: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    test_title: Mapped[str] = mapped_column(String(300), nullable=False)

    candidate_email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    candidate_name: Mapped[str | None] = mapped_column(String(300))

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    device_type: Mapped[str | None] = mapped_column(String(100))

    trust_score_pct: Mapped[int | None] = mapped_column(Integer)
    percentage_scored: Mapped[float | None] = mapped_column(Float)
    points_scored: Mapped[float | None] = mapped_column(Float)
    points_available: Mapped[float | None] = mapped_column(Float)
    graded: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # {"tab_switched", "no_face", "multiple_faces", "noise", "exited_fullscreen", "multiple_monitors"}
    violations: Mapped[dict] = mapped_column(JSONB, default=dict)
    aux_device_verified: Mapped[bool | None] = mapped_column(Boolean)
    aux_video_url: Mapped[str | None] = mapped_column(Text)
    # [{"number", "question", "answer", "points", "max_points"}] — this
    # candidate's slice of the test's "Download All responses" workbook.
    responses: Mapped[list] = mapped_column(JSONB, default=list)

    responses_file_url: Mapped[str | None] = mapped_column(Text)
    # No longer filled (PDF generation dropped 2026-10-17, see
    # autoproctor_scraper); kept so attempts imported before then keep theirs.
    proctoring_report_url: Mapped[str | None] = mapped_column(Text)
    aux_report_url: Mapped[str | None] = mapped_column(Text)

    assessment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("assessments.id"), index=True)
    application_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("applications.id"), index=True)
    # auto | manual — manual links are never re-matched by a later sync.
    match_method: Mapped[str | None] = mapped_column(String(20))

    raw: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class AutoproctorSyncRun(Base):
    """One run of the nightly sync. Doubles as the run lock (a "running" row
    blocks a second run) and as the safety check the auto-drop sweep reads:
    nobody is dropped for "not completing" unless a sync actually succeeded
    recently, so a broken login can't drop people who did finish."""
    __tablename__ = "autoproctor_sync_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="running")  # running | success | failed
    trigger: Mapped[str] = mapped_column(String(20), default="schedule")  # schedule | manual
    # Set for HR's manual "scrape this date range" runs (IST days, inclusive);
    # NULL for the nightly incremental run.
    range_from: Mapped[date | None] = mapped_column(Date)
    range_to: Mapped[date | None] = mapped_column(Date)
    attempts_seen: Mapped[int] = mapped_column(Integer, default=0)
    attempts_imported: Mapped[int] = mapped_column(Integer, default=0)
    attempts_matched: Mapped[int] = mapped_column(Integer, default=0)
    attempts_failed: Mapped[int] = mapped_column(Integer, default=0)
    # Already stored, so not scraped again (only their score is refreshed).
    attempts_skipped: Mapped[int] = mapped_column(Integer, default=0)
    reminders_sent: Mapped[int] = mapped_column(Integer, default=0)
    candidates_dropped: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
