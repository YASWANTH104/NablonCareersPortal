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


def _notify_only_when_exhausted(task, send_task, interview_id, **kwargs) -> bool:
    """Fire the fallback notification only on the LAST attempt.

    These tasks used to send the notification and *then* retry. The retry re-ran
    the whole async body, which ends by sending the same notification again — so
    a task that failed twice emailed the candidate and every panelist three
    times. The invite still has to go out if Graph never recovers, so it's sent
    once, when there are no attempts left.

    Returns True when the caller should give up instead of retrying.
    """
    if task.request.retries >= task.max_retries:
        send_task.delay(interview_id, **kwargs)
        return True
    return False


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def create_teams_meeting_task(self, interview_id: str, cc_emails: list[str] | None = None):
    try:
        asyncio.run(_create_teams_meeting_async(interview_id, cc_emails=cc_emails))
    except Exception as exc:
        logger.error(f"Teams meeting creation failed: interview={interview_id}: {exc}")
        from app.tasks.email_tasks import send_interview_scheduled_notifications
        if _notify_only_when_exhausted(
            self, send_interview_scheduled_notifications, interview_id, cc_emails=cc_emails
        ):
            return
        raise self.retry(exc=exc)


async def _create_teams_meeting_async(interview_id: str, cc_emails: list[str] | None = None):
    from sqlalchemy import select
    from app.models.interview import Interview, InterviewPanelist
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services import ms_graph_service
    from app.tasks.email_tasks import send_interview_scheduled_notifications
    from app.config import settings

    iv_uuid = uuid.UUID(interview_id)

    async with _task_session() as db:
        interview = await db.get(Interview, iv_uuid)
        if not interview:
            return

        # A previous attempt already created the event. Calling Graph again would
        # mint a SECOND calendar event on the organiser's mailbox, and only the
        # last event_id is stored — every earlier one becomes an orphan nothing
        # can patch or delete, including cancellation. The notification is still
        # sent, because the crash may have happened between the commit below and
        # the send.
        if interview.ms_graph_event_id:
            logger.info(
                f"Teams event already exists for interview={interview_id}; "
                f"not creating another"
            )
            send_interview_scheduled_notifications.delay(interview_id, cc_emails=cc_emails)
            return

        app = await db.get(Application, interview.application_id)
        candidate = await db.get(User, app.applicant_id) if app else None
        job = await db.get(Job, app.job_id) if app else None

        panelists = (await db.execute(
            select(InterviewPanelist).where(InterviewPanelist.interview_id == iv_uuid)
        )).scalars().all()

        if not panelists or not candidate:
            send_interview_scheduled_notifications.delay(interview_id, cc_emails=cc_emails)
            return

        organizer_panelist = next((p for p in panelists if p.role == "interviewer"), panelists[0])
        organizer = await db.get(User, organizer_panelist.user_id)
        if not organizer:
            send_interview_scheduled_notifications.delay(interview_id, cc_emails=cc_emails)
            return

        attendee_emails = [candidate.email] + [
            (await db.get(User, p.user_id)).email
            for p in panelists if p.user_id != organizer.id
        ]

        job_title = job.title if job else "the position"
        subject = f"Interview: {candidate.full_name} — {job_title}"
        start = interview.scheduled_at
        end = start + timedelta(minutes=interview.duration_mins or 60)

        # Shown to every attendee on the invite, candidate included — the link
        # itself is HR-only (requires HR auth), so it's safe to expose here even
        # though the candidate can't open it.
        profile_url = f"{settings.FRONTEND_URL}/hr/applicants/{app.id}"

        result = None
        try:
            result = await ms_graph_service.create_teams_meeting(
                organizer_email=organizer.email,
                subject=subject,
                start=start,
                end=end,
                attendee_emails=attendee_emails,
                body_html=(
                    f"<p>Interview for {job_title} with {candidate.full_name}.</p>"
                    f'<p><a href="{profile_url}">View candidate profile</a></p>'
                ),
            )
        except Exception as exc:
            logger.error(f"Graph create_teams_meeting failed: interview={interview_id}: {exc}")

        if result and result.get("join_url"):
            interview.meeting_link = result["join_url"]
            interview.ms_graph_event_id = result["event_id"]
            interview.ms_graph_organizer_email = organizer.email
            await db.commit()
            logger.info(f"Teams meeting created: interview={interview_id}, organizer={organizer.email}")

        send_interview_scheduled_notifications.delay(interview_id, cc_emails=cc_emails)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def update_teams_meeting_task(self, interview_id: str):
    try:
        asyncio.run(_update_teams_meeting_async(interview_id))
    except Exception as exc:
        logger.error(f"Teams meeting update failed: interview={interview_id}: {exc}")
        from app.tasks.email_tasks import send_interview_rescheduled_notifications
        if _notify_only_when_exhausted(self, send_interview_rescheduled_notifications, interview_id):
            return
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
        if _notify_only_when_exhausted(self, send_interview_cancelled_notifications, interview_id):
            return
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
