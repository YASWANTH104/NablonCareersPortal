import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.schemas.esign import EsignSettingsUpdate
from app.services import esign_service, zoho_sign_client as zoho
from app.services.zoho_sign_client import ZohoSignError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/esign", tags=["esign"])
_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
_ADMIN_ROLES = (Role.ADMIN, Role.SUPER_ADMIN)


@router.get("/status")
async def esign_status(
    request: Request,
    _=Depends(require_roles(*_HR_ROLES)),
):
    return esign_service.integration_status(str(request.base_url))


@router.post("/test")
async def test_connection(_=Depends(require_roles(*_ADMIN_ROLES))):
    return await esign_service.test_connection()


@router.get("/settings")
async def get_esign_settings(
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    cfg = await esign_service.get_settings(db)
    await db.commit()
    return esign_service.serialize_settings(cfg)


@router.put("/settings")
async def update_esign_settings(
    data: EsignSettingsUpdate,
    user=Depends(require_roles(*_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    cfg = await esign_service.update_settings(db, data, user.id)
    return esign_service.serialize_settings(cfg)


@router.get("/zoho-users")
async def search_zoho_users(
    q: str = Query("", max_length=100),
    _=Depends(require_roles(*_HR_ROLES)),
):
    try:
        return await zoho.search_users(q)
    except ZohoSignError as exc:
        raise HTTPException(exc.status_code, exc.message)


@router.post("/webhook/zoho", include_in_schema=False)
async def zoho_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Public — authenticated by Zoho's HMAC over the raw body, not a session."""
    raw = await request.body()
    if not zoho.verify_webhook_signature(raw, request.headers.get("X-ZS-WEBHOOK-SIGNATURE")):
        logger.warning("Zoho Sign webhook rejected: bad or missing signature")
        raise HTTPException(401, "Invalid signature")
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "Invalid JSON")

    request_id = await esign_service.handle_webhook(db, payload)
    if request_id:
        from app.tasks.esign_tasks import sync_zoho_sign_request
        sync_zoho_sign_request.delay(str(request_id))
    # Always 200 for verified calls — Zoho retries non-2xx, and documents that
    # aren't offer letters are simply not ours to handle
    return {"status": "ok"}
