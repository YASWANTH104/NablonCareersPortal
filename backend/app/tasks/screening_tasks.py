import asyncio
from app.tasks.celery_app import celery_app


def _task_session():
    from app.tasks.email_tasks import _task_session as _shared
    return _shared()


@celery_app.task(name="auto_reject_expired_screening_requests")
def auto_reject_expired_screening_requests():
    """Periodic sweep: rejects any application still sitting at 'applied'
    whose screening questionnaire link expired without a submission. Applies
    to every job with the screening questionnaire enabled, not just a fixed
    list — see app/services/screening_service.auto_reject_expired for the
    guard that skips anyone HR already moved on manually."""
    from app.services.screening_service import auto_reject_expired

    async def _run():
        async with _task_session() as db:
            return await auto_reject_expired(db)

    count = asyncio.run(_run())
    return f"Auto-rejected {count} expired screening request(s)"


@celery_app.task(name="send_delayed_screening_rejection_emails")
def send_delayed_screening_rejection_emails():
    """Periodic sweep: sends the candidate-facing rejection email for any
    application the screening flow auto-rejected whose hold period
    (screening_service.REJECTION_EMAIL_DELAY) has passed. The stage move to
    'rejected' already happened immediately at auto-reject time — only the
    email was held (see application_service.move_stage(notify_delay=)) —
    so this only ever fires the email, never a stage change.

    Idempotent: claims each row with a conditional UPDATE and commits that
    mark BEFORE queuing any email. Queuing first and committing after meant a
    failed commit (it happened: an unregistered model broke the flush) left
    every row unmarked, so the same candidates were re-emailed every sweep.
    The conditional UPDATE also means two overlapping sweeps (e.g. old and
    new beat revisions during a deploy) can never both claim the same row."""
    from datetime import datetime, timezone
    from sqlalchemy import update
    from app.models.application import Application
    from app.tasks.email_tasks import send_stage_update_email

    async def _run():
        async with _task_session() as db:
            now = datetime.now(timezone.utc)
            claimed = (await db.execute(
                update(Application)
                .where(
                    Application.stage == "rejected",
                    Application.rejection_notify_at.isnot(None),
                    Application.rejection_notify_at <= now,
                    Application.rejection_email_sent_at.is_(None),
                )
                .values(rejection_email_sent_at=now)
                .returning(Application.id, Application.rejection_notify_from_stage)
            )).all()
            await db.commit()

        for app_id, from_stage in claimed:
            send_stage_update_email.delay(str(app_id), "rejected", from_stage)
        return len(claimed)

    count = asyncio.run(_run())
    return f"Sent {count} delayed screening rejection email(s)"
