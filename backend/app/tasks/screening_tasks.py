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

    Idempotent: marks rejection_email_sent_at right after queuing so a
    second sweep before the Celery task actually runs never double-queues
    the same application (same mark-then-fire convention as
    screening_service.create_and_queue_email)."""
    from datetime import datetime, timezone
    from sqlalchemy import select
    from app.models.application import Application
    from app.tasks.email_tasks import send_stage_update_email

    async def _run():
        sent = 0
        async with _task_session() as db:
            now = datetime.now(timezone.utc)
            rows = (await db.execute(
                select(Application).where(
                    Application.stage == "rejected",
                    Application.rejection_notify_at.isnot(None),
                    Application.rejection_notify_at <= now,
                    Application.rejection_email_sent_at.is_(None),
                )
            )).scalars().all()

            for app in rows:
                send_stage_update_email.delay(
                    str(app.id), "rejected", app.rejection_notify_from_stage
                )
                app.rejection_email_sent_at = now
                sent += 1

            await db.commit()
        return sent

    count = asyncio.run(_run())
    return f"Sent {count} delayed screening rejection email(s)"
