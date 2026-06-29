import asyncio
import logging
from contextlib import asynccontextmanager
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


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


@celery_app.task(name="send_feedback_reminders")
def send_feedback_reminders():
    async def _run():
        from datetime import datetime, timezone, timedelta
        from sqlalchemy import select, func, and_
        from app.models.interview import Interview, InterviewPanelist, InterviewFeedback
        from app.models.user import User
        from app.models.application import Application
        from app.models.job import Job
        from app.services.email_service import send_email
        from app.config import settings

        async with _task_session() as db:
            now = datetime.now(timezone.utc)
            window_start = now - timedelta(minutes=75)
            window_end = now - timedelta(minutes=60)

            # Interviews whose end time falls in the 60–75 min ago window
            interviews = (await db.execute(
                select(Interview).where(
                    Interview.status == "completed",
                    Interview.scheduled_at + func.make_interval(
                        0, 0, 0, 0, 0, func.coalesce(Interview.duration_mins, 60)
                    ).between(window_start, window_end),
                )
            )).scalars().all()

            if not interviews:
                return 0

            reminded = 0
            for interview in interviews:
                panelists = (await db.execute(
                    select(InterviewPanelist).where(InterviewPanelist.interview_id == interview.id)
                )).scalars().all()

                submitted_by_ids = {
                    row.submitted_by for row in (await db.execute(
                        select(InterviewFeedback.submitted_by).where(
                            InterviewFeedback.interview_id == interview.id
                        )
                    )).all()
                }

                app = await db.get(Application, interview.application_id)
                if not app:
                    continue
                job = await db.get(Job, app.job_id)
                candidate = await db.get(User, app.applicant_id)

                for panelist in panelists:
                    if panelist.user_id in submitted_by_ids:
                        continue

                    interviewer = await db.get(User, panelist.user_id)
                    if not interviewer:
                        continue

                    interviews_url = f"{settings.FRONTEND_URL}/hr/interviews"
                    await send_email(
                        to_email=interviewer.email,
                        subject=f"Reminder: Please submit your feedback – {job.title if job else 'Interview'}",
                        template_name="feedback_reminder",
                        context={
                            "full_name": interviewer.full_name,
                            "candidate_name": candidate.full_name if candidate else "the candidate",
                            "job_title": job.title if job else "the position",
                            "interview_title": interview.title or f"Round {interview.round_number}",
                            "interviews_url": interviews_url,
                        },
                    )
                    logger.info(
                        f"Feedback reminder sent: interview={interview.id}, interviewer={interviewer.email}"
                    )
                    reminded += 1

            return reminded

    count = asyncio.run(_run())
    return f"Feedback reminders sent: {count}"

# _0faxynd4ahgiyqpqihth19dw7ohv4rk