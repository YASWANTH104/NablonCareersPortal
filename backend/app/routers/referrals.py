import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles, Role
from app.schemas.referral import (
    ReferralCreate, ReferralResponse, ReferralListResponse,
    ReferralStatusUpdate, ReferralBonusUpdate,
)
from app.services import referral_service

router = APIRouter(prefix="/referrals", tags=["referrals"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
_EMPLOYEE_PLUS = (Role.EMPLOYEE, Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


@router.post("", response_model=ReferralResponse, status_code=201)
async def create_referral(
    data: ReferralCreate,
    current_user=Depends(require_roles(*_EMPLOYEE_PLUS)),
    db: AsyncSession = Depends(get_db),
):
    return await referral_service.create_referral(db, data, current_user.id)


@router.get("/mine", response_model=ReferralListResponse)
async def my_referrals(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await referral_service.list_referrals(
        db, referred_by=current_user.id, status=status, page=page, limit=limit
    )


@router.get("", response_model=ReferralListResponse)
async def list_referrals(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await referral_service.list_referrals(db, status=status, page=page, limit=limit)


@router.get("/{referral_id}", response_model=ReferralResponse)
async def get_referral(
    referral_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await referral_service.get_referral(db, referral_id)


@router.patch("/{referral_id}/status", response_model=ReferralResponse)
async def update_status(
    referral_id: uuid.UUID,
    data: ReferralStatusUpdate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await referral_service.update_status(db, referral_id, data.status)


@router.post("/{referral_id}/resend", response_model=ReferralResponse)
async def resend_invite(
    referral_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await referral_service.resend_invite(db, referral_id)


@router.patch("/{referral_id}/bonus", response_model=ReferralResponse)
async def update_bonus(
    referral_id: uuid.UUID,
    data: ReferralBonusUpdate,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await referral_service.update_bonus(db, referral_id, data)
