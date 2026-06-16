import asyncio
from contextlib import asynccontextmanager
from app.tasks.celery_app import celery_app


@asynccontextmanager
async def _task_session():
    from app.config import settings
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    eng = create_async_engine(settings.DATABASE_URL, pool_size=2, max_overflow=0)
    Session = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
    try:
        async with Session() as session:
            yield session
    finally:
        await eng.dispose()


@celery_app.task(name="auto_complete_past_interviews")
def auto_complete_past_interviews():
    from app.services.interview_service import auto_complete_past_interviews as _auto_complete

    async def _run():
        async with _task_session() as db:
            count = await _auto_complete(db)
            return count

    count = asyncio.run(_run())
    return f"Auto-completed {count} interview(s)"
