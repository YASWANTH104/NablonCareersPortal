import asyncio
import logging

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _task_session():
    from app.tasks.email_tasks import _task_session as _shared
    return _shared()


# A run logs in, then spends ~1.5 min per new attempt (report page, two PDFs)
# plus ~20s per test for its responses workbook, so a busy day is tens of minutes. The hard limit stops a hung browser from
# holding a worker slot forever; the sync-run row it leaves "running" is
# reclaimed as abandoned by the next run.
@celery_app.task(name="sync_autoproctor_results", soft_time_limit=3 * 3600 - 300, time_limit=3 * 3600)
def sync_autoproctor_results(trigger: str = "schedule", date_from: str | None = None, date_to: str | None = None,
                             run_id: str | None = None):
    """Nightly 00:00 IST: import new AutoProctor attempts, mark matching
    assessments completed, then send 3-day reminders and run the 7-day
    auto-drop. See autoproctor_service for the guards on the drop.

    HR's manual range scrape queues this with trigger="manual", ISO
    date_from/date_to (IST days, inclusive) and the id of the "queued" run
    row its click created — import only, no follow-ups."""
    import uuid
    from datetime import date
    from app.config import settings
    from app.services import autoproctor_service

    if not settings.AUTOPROCTOR_ENABLED:
        if run_id:
            # Close out the queued row, or it blocks the Scrape button until it times out.
            async def _close():
                async with _task_session() as db:
                    await autoproctor_service.fail_queued_run(
                        db, uuid.UUID(run_id), "AutoProctor sync is turned off on the worker")
            asyncio.run(_close())
        return "AutoProctor sync disabled (AUTOPROCTOR_ENABLED=false)"

    async def _run():
        async with _task_session() as db:
            return await autoproctor_service.run_sync(
                db, trigger=trigger,
                date_from=date.fromisoformat(date_from) if date_from else None,
                date_to=date.fromisoformat(date_to) if date_to else None,
                run_id=uuid.UUID(run_id) if run_id else None,
            )

    result = asyncio.run(_run())
    logger.info(f"AutoProctor sync: {result}")
    return result
