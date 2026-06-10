import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles, Role
from app.schemas.offer import (
    OfferTemplateCreate, OfferTemplateUpdate, OfferTemplateResponse,
    OfferLetterCreate, OfferLetterUpdate, OfferLetterResponse,
    OfferLetterListResponse, OfferRespondRequest,
)
from app.services import offer_service

router = APIRouter(prefix="/offers", tags=["offers"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


# ── Templates ────────────────────────────────────────────────────────────────

@router.get("/templates", response_model=list[OfferTemplateResponse])
async def list_templates(
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.list_templates(db)


@router.post("/templates", response_model=OfferTemplateResponse, status_code=201)
async def create_template(
    data: OfferTemplateCreate,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.create_template(db, data, created_by=user.id)


@router.put("/templates/{template_id}", response_model=OfferTemplateResponse)
async def update_template(
    template_id: uuid.UUID,
    data: OfferTemplateUpdate,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.update_template(db, template_id, data)


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    await offer_service.delete_template(db, template_id)


# ── Offer Letters ─────────────────────────────────────────────────────────────

@router.post("", response_model=OfferLetterResponse, status_code=201)
async def create_offer(
    data: OfferLetterCreate,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.create_offer(db, data, created_by=user.id)


@router.get("", response_model=OfferLetterListResponse)
async def list_offers(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.list_offers(db, status=status, page=page, limit=limit)


# IMPORTANT: /respond/:token must come before /{offer_id} to avoid routing conflict
@router.post("/respond/{token}", response_model=OfferLetterResponse)
async def respond_offer(
    token: str,
    data: OfferRespondRequest,
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.respond_offer(
        db, token, data.decision, data.candidate_signature
    )


@router.get("/{offer_id}", response_model=OfferLetterResponse)
async def get_offer(
    offer_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.get_offer(db, offer_id)


@router.put("/{offer_id}", response_model=OfferLetterResponse)
async def update_offer(
    offer_id: uuid.UUID,
    data: OfferLetterUpdate,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.update_offer(db, offer_id, data)


@router.post("/{offer_id}/send", response_model=OfferLetterResponse)
async def send_offer(
    offer_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.send_offer(db, offer_id)


@router.get("/{offer_id}/preview", response_class=HTMLResponse)
async def preview_offer(
    offer_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    html = await offer_service.preview_offer(db, offer_id)
    return HTMLResponse(content=html)


@router.post("/{offer_id}/revoke", response_model=OfferLetterResponse)
async def revoke_offer(
    offer_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.revoke_offer(db, offer_id)


@router.get("/by-application/{application_id}", response_model=Optional[OfferLetterResponse])
async def get_offer_by_application(
    application_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.get_offer_by_application(db, application_id)
