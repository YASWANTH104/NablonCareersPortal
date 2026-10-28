import asyncio
import logging

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _task_session():
    from app.tasks.email_tasks import _task_session as _shared
    return _shared()


async def _send_scheduled(kind: str) -> str:
    """Builds the report BEFORE claiming (it's read-only, so a double-fired
    beat only costs a duplicate build), then claims the day on
    scheduled_report_settings with a conditional UPDATE and commits before
    sending — same claim-then-send shape as send_action_center_digests. A
    send that fails after the claim means no report that day rather than a
    duplicate; HR can still use "Send preview" to get the numbers."""
    from datetime import datetime, timezone
    from sqlalchemy import update, or_
    from app.models.scheduled_report import ScheduledReportSettings as S
    from app.services import scheduled_report_service as svc
    from app.utils.timezone import IST

    now = datetime.now(timezone.utc)
    today = now.astimezone(IST).date()
    sent_col = S.last_weekly_sent_on if kind == "weekly" else S.last_monthly_sent_on
    enabled_col = S.weekly_enabled if kind == "weekly" else S.monthly_enabled

    async with _task_session() as db:
        cfg = await svc.get_settings(db)
        await db.commit()
        if not getattr(cfg, enabled_col.key) or not cfg.recipients:
            return f"{kind} report skipped (disabled or no recipients)"

        report = await svc.build_report(db, kind, now)

        claimed = (await db.execute(
            update(S)
            .where(S.id == 1, enabled_col.is_(True), or_(sent_col.is_(None), sent_col < today))
            .values({sent_col.key: today})
            .returning(S.recipients)
        )).first()
        await db.commit()
        if not claimed or not claimed.recipients:
            return f"{kind} report already sent today"

        ok = await svc.send_report(report, list(claimed.recipients))
        if not ok:
            logger.error(f"Scheduled {kind} hiring report send failed")
            return f"{kind} report send FAILED"
        return f"{kind} report sent to {len(claimed.recipients)} recipient(s)"


@celery_app.task(name="send_weekly_hiring_report")
def send_weekly_hiring_report():
    return asyncio.run(_send_scheduled("weekly"))


@celery_app.task(name="send_monthly_hiring_report")
def send_monthly_hiring_report():
    """Beat fires on days 28–31; only the last calendar day (IST) sends, which
    is how "every month on the 30th" survives February and 31-day months."""
    from datetime import datetime, timezone
    from app.services.scheduled_report_service import is_last_day_of_month
    from app.utils.timezone import IST

    if not is_last_day_of_month(datetime.now(timezone.utc).astimezone(IST).date()):
        return "not the last day of the month"
    return asyncio.run(_send_scheduled("monthly"))


@celery_app.task(name="send_scheduled_report_preview")
def send_scheduled_report_preview(kind: str, to_email: str):
    """Current-period report to one person (the admin who clicked "Send
    preview"). Doesn't touch the claim columns, so it never blocks or
    replaces the scheduled send."""
    from app.services import scheduled_report_service as svc

    async def _run():
        async with _task_session() as db:
            report = await svc.build_report(db, kind)
        return await svc.send_report(report, [to_email], preview=True)

    ok = asyncio.run(_run())
    return f"{kind} preview {'sent' if ok else 'FAILED'} to {to_email}"
