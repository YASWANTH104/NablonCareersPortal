import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.database import get_db
from app.dependencies import get_current_user, require_roles, Role
from app.models.user import User
from app.models.candidate_profile import CandidateProfile
from app.schemas.user import (
    UserResponse, UserUpdate, UserInvite,
    CandidateProfileResponse, CandidateProfileUpdate,
)
from app.utils.security import hash_password, generate_token
from pydantic import BaseModel

router = APIRouter(prefix="/users", tags=["users"])

_ADMIN_ROLES = (Role.ADMIN, Role.SUPER_ADMIN)
_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
PANEL_ROLES = {"interviewer", "hr_manager", "admin", "super_admin"}
VALID_ROLES = {"super_admin", "admin", "hr_manager", "interviewer", "employee", "applicant"}


class RoleUpdate(BaseModel):
    role: str


@router.get("/me", response_model=UserResponse)
async def get_me(current_user=Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserResponse)
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(current_user, field, val)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.get("/me/profile", response_model=CandidateProfileResponse)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await db.get(CandidateProfile, current_user.id)
    return profile or CandidateProfile(user_id=current_user.id)


@router.patch("/me/profile", response_model=CandidateProfileResponse)
async def update_my_profile(
    data: CandidateProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await db.get(CandidateProfile, current_user.id)
    if not profile:
        profile = CandidateProfile(user_id=current_user.id)
        db.add(profile)
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(profile, field, val)
    await db.commit()
    await db.refresh(profile)
    return profile


@router.get("", response_model=list[UserResponse])
async def list_users(
    role: Optional[str] = Query(None),
    panel_eligible: bool = Query(False),
    active_only: bool = Query(False),
    search: Optional[str] = Query(None),
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    filters = []

    if panel_eligible:
        filters.append(User.role.in_(list(PANEL_ROLES)))
        filters.append(User.is_active == True)
    else:
        if active_only:
            filters.append(User.is_active == True)
        if role:
            filters.append(User.role == role)

    if search:
        filters.append(User.full_name.ilike(f"%{search}%"))

    stmt = select(User).order_by(User.full_name)
    if filters:
        stmt = stmt.where(and_(*filters))

    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("/invite", response_model=UserResponse, status_code=201)
async def invite_user(
    data: UserInvite,
    _=Depends(require_roles(*_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(select(User).where(User.email == data.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Email already registered")

    if data.role not in VALID_ROLES:
        raise HTTPException(400, f"Invalid role. Must be one of: {', '.join(sorted(VALID_ROLES))}")

    temp_password = generate_token()[:12]
    user = User(
        email=data.email,
        full_name=data.full_name,
        role=data.role,
        department=data.department,
        employee_id=data.employee_id,
        password_hash=hash_password(temp_password),
        is_active=True,
        is_verified=False,
        verification_token=generate_token(),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: uuid.UUID,
    _=Depends(require_roles(*_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: uuid.UUID,
    data: UserUpdate,
    _=Depends(require_roles(*_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(user, field, val)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/{user_id}/role", response_model=UserResponse)
async def change_role(
    user_id: uuid.UUID,
    data: RoleUpdate,
    current_user=Depends(require_roles(*_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    if data.role not in VALID_ROLES:
        raise HTTPException(400, f"Invalid role")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if str(user.id) == str(current_user.id):
        raise HTTPException(400, "Cannot change your own role")
    user.role = data.role
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/{user_id}/deactivate", response_model=UserResponse)
async def toggle_active(
    user_id: uuid.UUID,
    current_user=Depends(require_roles(*_ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if str(user.id) == str(current_user.id):
        raise HTTPException(400, "Cannot deactivate yourself")
    user.is_active = not user.is_active
    await db.commit()
    await db.refresh(user)
    return user
