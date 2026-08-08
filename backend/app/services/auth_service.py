from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
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
REFRESH_KEY_PREFIX = "refresh:"


def _redis_client():
    # redis.asyncio's SSL parsing only accepts lowercase
    # "required"/"optional"/"none" for ssl_cert_reqs, while the sync
    # redis-py client (used elsewhere for Celery) expects the uppercase
    # ssl.CERT_REQUIRED enum name — so REDIS_URL may carry the uppercase
    # form. from_url() docs are explicit that querystring values always
    # win over kwargs, so passing ssl_cert_reqs as a kwarg alone can't
    # override a conflicting value already in the URL — strip it from the
    # URL first, then set it explicitly.
    kwargs = {"decode_responses": True}
    url = settings.REDIS_URL
    if url.startswith("rediss://"):
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        query.pop("ssl_cert_reqs", None)
        url = urlunparse(parsed._replace(query=urlencode(query, doseq=True)))
        # redis.asyncio's RedisSSLContext.__init__ only handles cert_reqs as
        # None or a str ("none"/"optional"/"required") — passing the actual
        # ssl.CERT_REQUIRED enum object hits neither branch, so it silently
        # never sets self.cert_reqs at all (AttributeError on first use).
        kwargs["ssl_cert_reqs"] = "required"
    return aioredis.from_url(url, **kwargs)


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

    from app.tasks.email_tasks import send_verification_email_task
    send_verification_email_task.delay(user.email, user.full_name, verification_token)
    return user


async def _issue_tokens(user: User, db: AsyncSession) -> dict:
    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))

    async with _redis_client() as r:
        key = f"{REFRESH_KEY_PREFIX}{user.id}:{refresh_token[-16:]}"
        await r.setex(key, settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400, str(user.id))

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    return {"access_token": access_token, "refresh_token": refresh_token}


async def login_user(data: LoginRequest, db: AsyncSession) -> dict:
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    return await _issue_tokens(user, db)


def _ms_redirect_uri() -> str:
    # Must byte-for-byte match the redirect URI registered on the Entra app —
    # computed here once so the authorize-url step and the callback exchange
    # step can never drift apart.
    return f"{settings.FRONTEND_URL}/auth/microsoft/callback"


def microsoft_authorize_url(state: str) -> str:
    from app.services import ms_sso_service

    if not ms_sso_service.is_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Microsoft sign-in is not configured")
    return ms_sso_service.build_authorize_url(_ms_redirect_uri(), state)


async def login_with_microsoft(code: str, db: AsyncSession) -> dict:
    from app.services import ms_sso_service

    if not ms_sso_service.is_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Microsoft sign-in is not configured")

    userinfo = await ms_sso_service.exchange_code_for_userinfo(code, _ms_redirect_uri())
    if not userinfo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Microsoft sign-in failed — please try again")

    result = await db.execute(select(User).where(User.email == userinfo["email"]))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No Nablon account found for {userinfo['email']}. Contact HR to get access, or sign in with your password if you already have an account.",
        )
    if user.role == "applicant":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Microsoft sign-in isn't available for candidate accounts — please sign in with your email and password.",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    return await _issue_tokens(user, db)


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

    # Dispatched via Celery, not awaited inline — same fix as interview/assessment
    # scheduling. This also closes a timing side-channel: this endpoint returns
    # immediately for a non-existent email (line above) but used to take several
    # seconds longer for a real one, letting response time alone leak whether an
    # email is registered despite the deliberate identical response body.
    from app.tasks.email_tasks import send_password_reset_email_task
    send_password_reset_email_task.delay(user.email, user.full_name, reset_token)


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
