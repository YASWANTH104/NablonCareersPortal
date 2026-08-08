"""Microsoft Teams calendar integration for interview scheduling. Runs out-of-request
via Celery, same reasoning as email_tasks.py — a Graph token fetch + event create/patch/
delete is a real network round trip and must never block the HTTP response.

Each task fails open: if the Graph call errors (not configured, revoked consent, bad
organizer mailbox, etc.) it logs and still fires the existing candidate/panelist
notification email, so interview scheduling itself is never blocked by a Graph outage —
HR just doesn't get an auto-generated Teams link for that interview.
"""
from app.tasks.celery_app import celery_app
import asyncio
import uuid
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)


def _task_session():
    from app.tasks.email_tasks import _task_session as _shared
    return _shared()


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def create_teams_meeting_task(self, interview_id: str):
    try:
        asyncio.run(_create_teams_meeting_async(interview_id))
    except Exception as exc:
        logger.error(f"Teams meeting creation failed: interview={interview_id}: {exc}")
        # Notifications must still go out even if this retries/exhausts.
        from app.tasks.email_tasks import send_interview_scheduled_notifications
        send_interview_scheduled_notifications.delay(interview_id)
        raise self.retry(exc=exc)


async def _create_teams_meeting_async(interview_id: str):
    from sqlalchemy import select
    from app.models.interview import Interview, InterviewPanelist
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services import ms_graph_service
    from app.tasks.email_tasks import send_interview_scheduled_notifications

    iv_uuid = uuid.UUID(interview_id)

    async with _task_session() as db:
        interview = await db.get(Interview, iv_uuid)
        if not interview:
            return
        app = await db.get(Application, interview.application_id)
        candidate = await db.get(User, app.applicant_id) if app else None
        job = await db.get(Job, app.job_id) if app else None

        panelists = (await db.execute(
            select(InterviewPanelist).where(InterviewPanelist.interview_id == iv_uuid)
        )).scalars().all()

        if not panelists or not candidate:
            send_interview_scheduled_notifications.delay(interview_id)
            return

        organizer_panelist = next((p for p in panelists if p.role == "interviewer"), panelists[0])
        organizer = await db.get(User, organizer_panelist.user_id)
        if not organizer:
            send_interview_scheduled_notifications.delay(interview_id)
            return

        attendee_emails = [candidate.email] + [
            (await db.get(User, p.user_id)).email
            for p in panelists if p.user_id != organizer.id
        ]

        job_title = job.title if job else "the position"
        subject = f"Interview: {candidate.full_name} — {job_title}"
        start = interview.scheduled_at
        end = start + timedelta(minutes=interview.duration_mins or 60)

        result = None
        try:
            result = await ms_graph_service.create_teams_meeting(
                organizer_email=organizer.email,
                subject=subject,
                start=start,
                end=end,
                attendee_emails=attendee_emails,
                body_html=f"<p>Interview for {job_title} with {candidate.full_name}.</p>",
            )
        except Exception as exc:
            logger.error(f"Graph create_teams_meeting failed: interview={interview_id}: {exc}")

        if result and result.get("join_url"):
            interview.meeting_link = result["join_url"]
            interview.ms_graph_event_id = result["event_id"]
            interview.ms_graph_organizer_email = organizer.email
            await db.commit()
            logger.info(f"Teams meeting created: interview={interview_id}, organizer={organizer.email}")

        send_interview_scheduled_notifications.delay(interview_id)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def update_teams_meeting_task(self, interview_id: str):
    try:
        asyncio.run(_update_teams_meeting_async(interview_id))
    except Exception as exc:
        logger.error(f"Teams meeting update failed: interview={interview_id}: {exc}")
        from app.tasks.email_tasks import send_interview_rescheduled_notifications
        send_interview_rescheduled_notifications.delay(interview_id)
        raise self.retry(exc=exc)


async def _update_teams_meeting_async(interview_id: str):
    from app.models.interview import Interview
    from app.services import ms_graph_service
    from app.tasks.email_tasks import send_interview_rescheduled_notifications

    iv_uuid = uuid.UUID(interview_id)

    async with _task_session() as db:
        interview = await db.get(Interview, iv_uuid)
        if not interview:
            return

        if interview.ms_graph_event_id and interview.ms_graph_organizer_email:
            end = interview.scheduled_at + timedelta(minutes=interview.duration_mins or 60)
            try:
                result = await ms_graph_service.update_teams_meeting(
                    organizer_email=interview.ms_graph_organizer_email,
                    event_id=interview.ms_graph_event_id,
                    start=interview.scheduled_at,
                    end=end,
                )
                if result and result.get("join_url"):
                    interview.meeting_link = result["join_url"]
                    await db.commit()
                logger.info(f"Teams meeting updated: interview={interview_id}")
            except Exception as exc:
                logger.error(f"Graph update_teams_meeting failed: interview={interview_id}: {exc}")

        send_interview_rescheduled_notifications.delay(interview_id)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def delete_teams_meeting_task(self, interview_id: str):
    try:
        asyncio.run(_delete_teams_meeting_async(interview_id))
    except Exception as exc:
        logger.error(f"Teams meeting deletion failed: interview={interview_id}: {exc}")
        from app.tasks.email_tasks import send_interview_cancelled_notifications
        send_interview_cancelled_notifications.delay(interview_id)
        raise self.retry(exc=exc)


async def _delete_teams_meeting_async(interview_id: str):
    from app.models.interview import Interview
    from app.services import ms_graph_service
    from app.tasks.email_tasks import send_interview_cancelled_notifications

    iv_uuid = uuid.UUID(interview_id)

    async with _task_session() as db:
        interview = await db.get(Interview, iv_uuid)
        if not interview:
            return

        if interview.ms_graph_event_id and interview.ms_graph_organizer_email:
            try:
                await ms_graph_service.delete_teams_meeting(
                    organizer_email=interview.ms_graph_organizer_email,
                    event_id=interview.ms_graph_event_id,
                )
                logger.info(f"Teams meeting deleted: interview={interview_id}")
            except Exception as exc:
                logger.error(f"Graph delete_teams_meeting failed: interview={interview_id}: {exc}")

        send_interview_cancelled_notifications.delay(interview_id)
