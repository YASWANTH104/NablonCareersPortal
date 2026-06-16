import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles, Role
from typing import Optional
from app.schemas.offer import (
    OfferTemplateCreate, OfferTemplateUpdate, OfferTemplateResponse,
    OfferLetterCreate, OfferLetterUpdate, OfferLetterResponse,
    OfferLetterListResponse, OfferRespondRequest, CandidateOfferResponse,
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


# ── Applicant portal routes (authenticated) — must come before /{offer_id} ───

@router.get("/mine/{application_id}", response_model=Optional[CandidateOfferResponse])
async def get_my_offer(
    application_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.get_offer_for_applicant(db, application_id, current_user.id)


@router.post("/mine/{application_id}/respond", response_model=CandidateOfferResponse)
async def respond_my_offer(
    application_id: uuid.UUID,
    data: OfferRespondRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.respond_offer_for_applicant(
        db, application_id, current_user.id, data.decision, data.candidate_signature
    )


@router.get("/mine/{application_id}/view")
async def view_my_offer_html(
    application_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.offer import OfferLetter
    from sqlalchemy import select as _select
    from fastapi import HTTPException
    offer = (await db.execute(
        _select(OfferLetter).where(OfferLetter.application_id == application_id)
    )).scalar_one_or_none()
    if not offer or offer.status not in ("sent", "accepted", "rejected", "expired", "revoked"):
        raise HTTPException(404, "Offer not found or not yet sent")
    html = await offer_service.build_offer_html(db, offer.id)
    return Response(content=html, media_type="text/html; charset=utf-8")


@router.get("/mine/{application_id}/download")
async def download_my_offer_pdf(
    application_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.offer import OfferLetter
    from sqlalchemy import select as _select
    from fastapi import HTTPException
    offer = (await db.execute(
        _select(OfferLetter).where(OfferLetter.application_id == application_id)
    )).scalar_one_or_none()
    if not offer or offer.status not in ("sent", "accepted", "rejected", "expired", "revoked"):
        raise HTTPException(404, "Offer not found or not yet sent")
    pdf_bytes = await offer_service.build_offer_pdf(db, offer.id)
    filename = "offer_letter_signed.pdf" if offer.candidate_signature else "offer_letter.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


@router.get("/by-application/{application_id}", response_model=Optional[OfferLetterResponse])
async def get_offer_by_application(
    application_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await offer_service.get_offer_by_application(db, application_id)


@router.get("/{offer_id}/view")
async def view_offer_html(
    offer_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.offer import OfferLetter
    from fastapi import HTTPException as _HTTPException
    offer = await db.get(OfferLetter, offer_id)
    if not offer:
        raise _HTTPException(404, "Offer not found")
    html = await offer_service.build_offer_html(db, offer_id)
    return Response(content=html, media_type="text/html; charset=utf-8")


@router.get("/{offer_id}/download")
async def download_offer_pdf(
    offer_id: uuid.UUID,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.offer import OfferLetter
    from fastapi import HTTPException as _HTTPException
    offer = await db.get(OfferLetter, offer_id)
    if not offer:
        raise _HTTPException(404, "Offer not found")
    pdf_bytes = await offer_service.build_offer_pdf(db, offer_id)
    filename = "offer_letter_signed.pdf" if offer.candidate_signature else "offer_letter.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
