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
