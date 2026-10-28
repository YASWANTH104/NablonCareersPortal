from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.services import scheduled_report_service as svc

router = APIRouter(prefix="/scheduled-reports", tags=["scheduled-reports"])
_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
_ADMIN_ROLES = (Role.ADMIN, Role.SUPER_ADMIN)

MAX_RECIPIENTS = 25


def _serialize(cfg) -> dict:
    return {
        "recipients": list(cfg.recipients or []),
        "weekly_enabled": cfg.weekly_enabled,
        "monthly_enabled": cfg.monthly_enabled,
        "last_weekly_sent_on": cfg.last_weekly_sent_on.isoformat() if cfg.last_weekly_sent_on else None,
        "last_monthly_sent_on": cfg.last_monthly_sent_on.isoformat() if cfg.last_monthly_sent_on else None,
        "next_send": svc.next_send_times(datetime.now(timezone.utc)),
    }


@router.get("/settings")
async def get_report_settings(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    cfg = await svc.get_settings(db)
    await db.commit()
    return _serialize(cfg)


class ScheduledReportSettingsUpdate(BaseModel):
    recipients: list[EmailStr]
    weekly_enabled: bool
    monthly_enabled: bool

    @field_validator("recipients")
    @classmethod
    def _dedupe(cls, v: list[EmailStr]) -> list[str]:
        out: list[str] = []
        for e in v:
            e = str(e).strip().lower()
            if e not in out:
                out.append(e)
        if len(out) > MAX_RECIPIENTS:
            raise ValueError(f"At most {MAX_RECIPIENTS} recipients")
        return out


@router.put("/settings")
async def update_report_settings(
    data: ScheduledReportSettingsUpdate,
    user=Depends(require_roles(*_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    cfg = await svc.get_settings(db)
    cfg.recipients = data.recipients
    cfg.weekly_enabled = data.weekly_enabled
    cfg.monthly_enabled = data.monthly_enabled
    cfg.updated_by = user.id
    await db.commit()
    await db.refresh(cfg)
    return _serialize(cfg)


@router.post("/preview")
async def send_report_preview(
    kind: Literal["weekly", "monthly"] = Query(...),
    user=Depends(require_roles(*_HR_ROLES)),
):
    """Emails the current period's report to the caller only — runs in Celery
    because the AI insights call can take several seconds."""
    from app.tasks.scheduled_report_tasks import send_scheduled_report_preview

    send_scheduled_report_preview.delay(kind, user.email)
    return {"status": "queued", "to": user.email}
