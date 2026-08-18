import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.schemas.screening import ScreeningSubmit, ScreeningPublicInfo, ScreeningResponseOut
from app.services import screening_service

router = APIRouter(tags=["screening"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


# ── Public candidate routes (token-based, no login) ─────────────────────────

@router.get("/screening/{token}", response_model=ScreeningPublicInfo)
async def get_screening_status(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    return await screening_service.get_public_info(db, token)


@router.post("/screening/{token}/submit", response_model=ScreeningResponseOut)
async def submit_screening_form(
    token: str,
    data: ScreeningSubmit,
    db: AsyncSession = Depends(get_db),
):
    return await screening_service.submit_screening(db, token, data)


# ── HR route ─────────────────────────────────────────────────────────────────

@router.get("/applications/{application_id}/screening", response_model=ScreeningResponseOut | None)
async def get_application_screening(
    application_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await screening_service.get_for_application(db, application_id)
