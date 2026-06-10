from app.tasks.celery_app import celery_app
import asyncio
import logging

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_stage_update_email(self, application_id: str, new_stage: str):
    try:
        # Fetch application + user data and send email
        # Implemented in Phase 3 when application pipeline is built
        logger.info(f"Stage update email queued: app={application_id}, stage={new_stage}")
    except Exception as exc:
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_interview_notification(self, interview_id: str):
    try:
        logger.info(f"Interview notification queued: {interview_id}")
    except Exception as exc:
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_offer_email(self, offer_id: str):
    try:
        logger.info(f"Offer email queued: {offer_id}")
    except Exception as exc:
        raise self.retry(exc=exc)
