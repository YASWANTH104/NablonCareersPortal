import asyncio
import logging
import uuid

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _task_session():
    from app.tasks.email_tasks import _task_session as _shared
    return _shared()


async def _sync_one(request_id: str) -> str:
    from app.services import esign_service

    async with _task_session() as db:
        status = await esign_service.sync_request(db, uuid.UUID(request_id))
        esign_service.dispatch_after_commit(db)
        return f"{request_id}: {status}"


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def sync_zoho_sign_request(self, request_id: str):
    """Fired by the Zoho Sign webhook — reads the request back from Zoho and applies it."""
    try:
        return asyncio.run(_sync_one(request_id))
    except Exception as exc:
        logger.error(f"Zoho Sign sync failed: request={request_id}: {exc}")
        raise self.retry(exc=exc)


async def _poll_inflight() -> str:
    from datetime import timedelta
    from app.config import settings
    from app.services import esign_service

    if not settings.zoho_sign_configured:
        return "Zoho Sign not configured"

    async with _task_session() as db:
        ids = await esign_service.inflight_request_ids(db, timedelta(minutes=30))

    synced = failed = 0
    for rid in ids:
        # One request failing (Zoho hiccup, deleted in Zoho) mustn't stop the rest
        try:
            await _sync_one(str(rid))
            synced += 1
        except Exception as exc:
            failed += 1
            logger.warning(f"Zoho Sign poll: request {rid} failed: {exc}")
    return f"Zoho Sign poll: {synced} synced, {failed} failed"


@celery_app.task(name="poll_inflight_esign_requests")
def poll_inflight_esign_requests():
    """Safety net for missed webhooks: re-syncs envelopes nobody has heard about in 30 min."""
    return asyncio.run(_poll_inflight())
