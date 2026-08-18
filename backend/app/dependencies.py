from enum import Enum
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.utils.security import decode_access_token

bearer_scheme = HTTPBearer()
optional_bearer_scheme = HTTPBearer(auto_error=False)


class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    HR_MANAGER = "hr_manager"
    INTERVIEWER = "interviewer"
    EMPLOYEE = "employee"
    APPLICANT = "applicant"


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    from app.models.user import User

    token = credentials.credentials
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Returns the current user if no token is present (anonymous) or a valid
    token is provided. A token that IS present but expired/invalid raises 401
    rather than silently downgrading to anonymous — otherwise an authenticated
    caller (e.g. HR) whose access token expires mid-session gets silently
    re-scoped to the public/unauthenticated result set on routes like
    GET /jobs, which for HR means internal-only or unpublished jobs vanish
    from view with no error and no token refresh triggered."""
    if not credentials:
        return None
    from app.models.user import User

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    return user


def require_roles(*roles: Role):
    def guard(current_user=Depends(get_current_user)):
        if current_user.role not in [r.value for r in roles]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return guard


def require_verified(current_user=Depends(get_current_user)):
    if not current_user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email not verified",
        )
    return current_user
