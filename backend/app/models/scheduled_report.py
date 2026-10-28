import uuid
from datetime import datetime, date
from sqlalchemy import String, Boolean, Date, DateTime, Integer, ForeignKey, ARRAY, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ScheduledReportSettings(Base):
    """Single-row config for the weekly (Friday) and monthly (last day of
    month) hiring summary emails. One shared recipient list for both — it's a
    distribution list, not per-user subscriptions, and recipients don't need a
    portal account (leadership, client-side stakeholders).

    last_*_sent_on is the claim key: the beat task flips it with a conditional
    UPDATE before sending, so a double-fired beat can't email twice."""
    __tablename__ = "scheduled_report_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    recipients: Mapped[list[str]] = mapped_column(ARRAY(String(255)), nullable=False, default=list, server_default="{}")
    weekly_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    monthly_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    last_weekly_sent_on: Mapped[date | None] = mapped_column(Date)
    last_monthly_sent_on: Mapped[date | None] = mapped_column(Date)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (CheckConstraint("id = 1", name="ck_scheduled_report_settings_single_row"),)
