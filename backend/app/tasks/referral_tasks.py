import asyncio
from app.tasks.celery_app import celery_app


def _task_session():
    from app.tasks.email_tasks import _task_session as _shared
    return _shared()


@celery_app.task(name="auto_expire_referrals")
def auto_expire_referrals():
    from app.services.referral_service import auto_expire_referrals as _auto_expire

    async def _run():
        async with _task_session() as db:
            return await _auto_expire(db)

    count = asyncio.run(_run())
    return f"Auto-expired {count} referral(s)"
