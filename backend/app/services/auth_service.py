from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException, status
import redis.asyncio as aioredis

from app.config import settings
from app.models.user import User
from app.schemas.auth import RegisterRequest, LoginRequest
from app.utils.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    generate_token,
)
from app.services.email_service import send_verification_email, send_password_reset_email

REFRESH_KEY_PREFIX = "refresh:"


def _redis_client():
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


async def register_user(data: RegisterRequest, db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    verification_token = generate_token()
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        role="applicant",
        verification_token=verification_token,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await send_verification_email(user.email, user.full_name, verification_token)
    return user


async def login_user(data: LoginRequest, db: AsyncSession) -> dict:
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))

    async with _redis_client() as r:
        key = f"{REFRESH_KEY_PREFIX}{user.id}:{refresh_token[-16:]}"
        await r.setex(key, settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400, str(user.id))

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    return {"access_token": access_token, "refresh_token": refresh_token}


async def refresh_tokens(refresh_token: str) -> dict:
    payload = decode_refresh_token(refresh_token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user_id = payload.get("sub")
    key = f"{REFRESH_KEY_PREFIX}{user_id}:{refresh_token[-16:]}"

    async with _redis_client() as r:
        stored = await r.get(key)
        if not stored:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired or revoked")

    access_token = create_access_token(user_id)
    return {"access_token": access_token}


async def logout_user(refresh_token: str, user_id: str) -> None:
    key = f"{REFRESH_KEY_PREFIX}{user_id}:{refresh_token[-16:]}"
    async with _redis_client() as r:
        await r.delete(key)


async def verify_email(token: str, db: AsyncSession) -> None:
    result = await db.execute(select(User).where(User.verification_token == token))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    user.is_verified = True
    user.verification_token = None
    await db.commit()


async def forgot_password(email: str, db: AsyncSession) -> None:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        return  # Don't reveal whether email exists

    reset_token = generate_token()
    user.password_reset_token = reset_token
    user.password_reset_expires = datetime.now(timezone.utc) + timedelta(hours=1)
    await db.commit()

    await send_password_reset_email(user.email, user.full_name, reset_token)


async def reset_password(token: str, new_password: str, db: AsyncSession) -> None:
    result = await db.execute(select(User).where(User.password_reset_token == token))
    user = result.scalar_one_or_none()

    if not user or not user.password_reset_expires:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    if user.password_reset_expires.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token has expired")

    user.password_hash = hash_password(new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    await db.commit()
