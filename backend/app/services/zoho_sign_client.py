"""Thin async client for the Zoho Sign REST API (offer letter e-signature).

Auth is a long-lived Self Client refresh token exchanged for 1-hour access
tokens. The access token lives in Redis, not a module dict like ms_graph: the
API, Celery worker and beat each run several processes, and Zoho throttles
token minting per refresh token, so every process sharing one token matters
here in a way it doesn't for Graph."""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

TOKEN_KEY = "zoho_sign:access_token"
TOKEN_LOCK_KEY = "zoho_sign:token_lock"
USERS_KEY = "zoho_sign:users"
USERS_TTL_SECONDS = 600

# Fallback when Redis is unreachable — one process, one token, still correct.
_local_token: dict = {"token": None, "expires_at": 0.0}


class ZohoSignError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def is_configured() -> bool:
    return settings.zoho_sign_configured


def missing_keys() -> list[str]:
    keys = ("ZOHO_SIGN_CLIENT_ID", "ZOHO_SIGN_CLIENT_SECRET", "ZOHO_SIGN_REFRESH_TOKEN", "ZOHO_SIGN_WEBHOOK_SECRET")
    return [k for k in keys if not getattr(settings, k)]


# ── Access token ─────────────────────────────────────────────────────────────

async def _mint_token() -> tuple[str, int]:
    url = f"{settings.ZOHO_SIGN_ACCOUNTS_URL.rstrip('/')}/oauth/v2/token"
    params = {
        "refresh_token": settings.ZOHO_SIGN_REFRESH_TOKEN,
        "client_id": settings.ZOHO_SIGN_CLIENT_ID,
        "client_secret": settings.ZOHO_SIGN_CLIENT_SECRET,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, params=params)
    try:
        payload = resp.json()
    except ValueError:
        payload = {}
    # Zoho answers a bad refresh token with HTTP 200 + {"error": "..."}
    if resp.status_code != 200 or "access_token" not in payload:
        err = payload.get("error") or resp.text[:200]
        logger.error(f"Zoho Sign token refresh failed: {resp.status_code} {err}")
        raise ZohoSignError(f"Couldn't sign in to Zoho Sign ({err}). Check the ZOHO_SIGN_* keys.", 502)
    return payload["access_token"], int(payload.get("expires_in", 3600))


async def _get_token(force: bool = False) -> str:
    if not is_configured():
        raise ZohoSignError("Zoho Sign isn't configured yet. Add the ZOHO_SIGN_* keys.", 503)

    try:
        from app.services.auth_service import _redis_client
        redis = _redis_client()
        if not force:
            cached = await redis.get(TOKEN_KEY)
            if cached:
                return cached
        # Only one process mints; the rest wait briefly for it to land.
        if await redis.set(TOKEN_LOCK_KEY, "1", nx=True, ex=20):
            try:
                token, expires_in = await _mint_token()
                await redis.set(TOKEN_KEY, token, ex=max(60, expires_in - 120))
                return token
            finally:
                await redis.delete(TOKEN_LOCK_KEY)
        for _ in range(20):
            await asyncio.sleep(0.25)
            cached = await redis.get(TOKEN_KEY)
            if cached:
                return cached
    except ZohoSignError:
        raise
    except Exception as exc:
        logger.warning(f"Zoho Sign: Redis token cache unavailable ({exc}); using process cache")

    now = time.time()
    if not force and _local_token["token"] and _local_token["expires_at"] > now + 120:
        return _local_token["token"]
    token, expires_in = await _mint_token()
    _local_token.update(token=token, expires_at=now + expires_in)
    return token


async def _clear_token() -> None:
    _local_token.update(token=None, expires_at=0.0)
    try:
        from app.services.auth_service import _redis_client
        await _redis_client().delete(TOKEN_KEY)
    except Exception:
        pass


# ── Requests ─────────────────────────────────────────────────────────────────

def _url(path: str) -> str:
    return f"{settings.ZOHO_SIGN_API_BASE.rstrip('/')}/{path.lstrip('/')}"


def _error_message(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        return body.get("message") or body.get("error") or resp.text[:300]
    except ValueError:
        return resp.text[:300] or f"HTTP {resp.status_code}"


async def _request(method: str, path: str, *, raw: bool = False, timeout: float = 30, **kwargs) -> Any:
    for attempt in range(2):
        token = await _get_token(force=attempt == 1)
        headers = {"Authorization": f"Zoho-oauthtoken {token}"}
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.request(method, _url(path), headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise ZohoSignError(f"Couldn't reach Zoho Sign ({exc.__class__.__name__}). Try again in a moment.", 502)

        if resp.status_code == 401 and attempt == 0:
            await _clear_token()
            continue
        if resp.status_code >= 400:
            msg = _error_message(resp)
            logger.warning(f"Zoho Sign {method} {path} → {resp.status_code}: {msg}")
            raise ZohoSignError(f"Zoho Sign: {msg}", 502)
        if raw:
            return resp.content
        try:
            body = resp.json()
        except ValueError:
            raise ZohoSignError("Zoho Sign returned an unexpected response.", 502)
        # Zoho reports some failures as HTTP 200 with a non-zero code
        if body.get("status") == "failure" or body.get("code") not in (None, 0):
            raise ZohoSignError(f"Zoho Sign: {body.get('message') or 'request failed'}", 502)
        return body
    raise ZohoSignError("Zoho Sign rejected our access token.", 502)


async def create_request(pdf_bytes: bytes, filename: str, request_json: dict) -> dict:
    """Uploads the letter and creates a draft request with its recipients.
    Returns Zoho's `requests` object (request_id, actions[].action_id, document_ids)."""
    body = await _request(
        "POST", "requests",
        files={"file": (filename, pdf_bytes, "application/pdf")},
        data={"data": json.dumps({"requests": request_json})},
        timeout=60,
    )
    return body["requests"]


async def submit_request(request_id: str, actions: list[dict]) -> dict:
    """Places the signature fields and sends the request out to the parties."""
    body = await _request(
        "POST", f"requests/{request_id}/submit",
        data={"data": json.dumps({"requests": {"actions": actions}})},
    )
    return body["requests"]


async def get_request(request_id: str) -> dict:
    body = await _request("GET", f"requests/{request_id}")
    return body["requests"]


async def remind(request_id: str) -> None:
    await _request("POST", f"requests/{request_id}/remind")


async def recall(request_id: str) -> None:
    await _request("POST", f"requests/{request_id}/recall")


async def delete_request(request_id: str) -> None:
    await _request("PUT", f"requests/{request_id}/delete")


async def download_pdf(request_id: str) -> bytes:
    return await _request("GET", f"requests/{request_id}/pdf", raw=True, timeout=60)


async def download_certificate(request_id: str) -> bytes:
    return await _request("GET", f"requests/{request_id}/completioncertificate", raw=True, timeout=60)


# ── Users (party picker) ─────────────────────────────────────────────────────

def _normalise_user(u: dict) -> Optional[dict]:
    # Live shape (sign.zoho.in, 2026-11-10): user_email, user_name, role, is_allowed,
    # user_id, profile, confirmed_email_ids. is_allowed=False is a deactivated seat.
    email = (u.get("user_email") or u.get("email") or "").strip().lower()
    if not email or u.get("is_allowed") is False:
        return None
    status = str(u.get("profile_status") or u.get("status") or "active").lower()
    if status in ("inactive", "deleted", "disabled"):
        return None
    name = " ".join(p for p in (u.get("first_name"), u.get("last_name")) if p).strip()
    name = (name or u.get("user_name") or u.get("display_name") or "").strip() or email.split("@")[0]
    return {"name": name, "email": email, "role": u.get("role") or u.get("user_role")}


async def list_users(force: bool = False) -> list[dict]:
    """Every active user in the Zoho Sign org, cached for 10 minutes."""
    if not force:
        try:
            from app.services.auth_service import _redis_client
            cached = await _redis_client().get(USERS_KEY)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    users: list[dict] = []
    start = 1
    while True:
        # Zoho rejects bare paging params ("Extra key found") — they go in a page_context blob
        page_context = {"page_context": {"row_count": 100, "start_index": start}}
        body = await _request("GET", "users", params={"data": json.dumps(page_context)})
        page = body.get("users") or []
        users.extend(n for n in (_normalise_user(u) for u in page) if n)
        if len(page) < 100 or start > 1000:
            break
        start += 100
    users.sort(key=lambda u: u["name"].lower())

    try:
        from app.services.auth_service import _redis_client
        await _redis_client().set(USERS_KEY, json.dumps(users), ex=USERS_TTL_SECONDS)
    except Exception:
        pass
    return users


async def search_users(q: str, limit: int = 8) -> list[dict]:
    users = await list_users()
    q = (q or "").strip().lower()
    if q:
        users = [u for u in users if q in u["name"].lower() or q in u["email"]]
    return users[:limit]


# ── Webhook ──────────────────────────────────────────────────────────────────

def verify_webhook_signature(raw_body: bytes, signature: Optional[str]) -> bool:
    """Zoho signs the raw body: base64(HMAC-SHA256(secret, body)) in X-ZS-WEBHOOK-SIGNATURE."""
    secret = settings.ZOHO_SIGN_WEBHOOK_SECRET
    if not secret or not signature:
        return False
    digest = hmac.new(secret.encode(), raw_body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode()
    return hmac.compare_digest(expected, signature.strip())
