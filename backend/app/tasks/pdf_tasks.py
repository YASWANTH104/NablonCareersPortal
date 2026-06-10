from app.tasks.celery_app import celery_app
import logging

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def generate_offer_pdf(self, offer_id: str):
    """Generate offer letter PDF and upload to S3. Implemented in Phase 4."""
    try:
        logger.info(f"PDF generation queued: offer={offer_id}")
    except Exception as exc:
        raise self.retry(exc=exc)
