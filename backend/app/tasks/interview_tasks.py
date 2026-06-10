import asyncio
from app.tasks.celery_app import celery_app


@celery_app.task(name="auto_complete_past_interviews")
def auto_complete_past_interviews():
    from app.database import AsyncSessionLocal
    from app.services.interview_service import auto_complete_past_interviews as _auto_complete

    async def _run():
        async with AsyncSessionLocal() as db:
            count = await _auto_complete(db)
            return count

    count = asyncio.run(_run())
    return f"Auto-completed {count} interview(s)"
