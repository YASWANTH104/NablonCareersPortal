"""Microsoft SSO login (delegated OIDC authorization-code flow) for internal
staff — separate concern from ms_graph_service.py's app-only calendar calls,
even though both reuse the same Entra ID app registration (MS_GRAPH_TENANT_ID/
CLIENT_ID/CLIENT_SECRET): this flow is a real user redirect + sign-in, that one
is the backend acting as itself with no user involved.

Optional login method — password login keeps working unchanged regardless of
whether this is configured. Candidates never use this path: a successful sign-in
here proves the person is a Member of the Nablon Entra tenant, so auth_service.
login_with_microsoft provisions them as `employee` if they have no account yet.
Guests (B2B-invited agency contacts, clients, contractors) are Members' opposite
number in the same directory and are rejected — see `is_member()`.
"""
import logging
import re
import uuid
from urllib.parse import urlencode
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
USERINFO_URL = "https://graph.microsoft.com/oidc/userinfo"
ME_URL = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName,userType,department,jobTitle"

# User.Read is what makes `userType` readable — the OIDC userinfo endpoint does
# not return it, and without it we cannot tell a Member from a guest.
SCOPES = "openid profile email User.Read"

# Multi-tenant authorities accept every Microsoft account in existence. This flow
# treats "authenticated successfully" as "works at Nablon", which is only true
# while the authority is pinned to our own tenant GUID. Guard it explicitly so a
# well-meaning `common` here can never silently turn SSO into open registration.
_WILDCARD_TENANTS = {"common", "organizations", "consumers"}


def is_configured() -> bool:
    return settings.ms_graph_configured and _tenant_is_pinned()


def _tenant_is_pinned() -> bool:
    tenant = (settings.MS_GRAPH_TENANT_ID or "").strip().lower()
    if not tenant:
        return False
    if tenant in _WILDCARD_TENANTS:
        logger.error(
            "MS_GRAPH_TENANT_ID is %r — a multi-tenant authority. Microsoft "
            "sign-in is disabled because it would let any Microsoft account in "
            "the world be provisioned as a Nablon employee. Set it to the "
            "tenant GUID.",
            tenant,
        )
        return False
    try:
        uuid.UUID(tenant)
        return True
    except ValueError:
        # A verified domain (nablon.ai / nablon.onmicrosoft.com) is also
        # single-tenant, so allow it — but nothing else.
        if re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", tenant):
            return True
        logger.error("MS_GRAPH_TENANT_ID is not a tenant GUID or verified domain: %r", tenant)
        return False


def is_member(userinfo: dict) -> bool:
    """Entra `userType` is 'Member' for staff and 'Guest' for B2B invitees.
    Anything else (missing/unknown) is treated as not-a-member: this decides
    whether an account gets auto-created, so it must fail closed."""
    return (userinfo.get("user_type") or "").lower() == "member"


def build_authorize_url(redirect_uri: str, state: str) -> str:
    params = {
        "client_id": settings.MS_GRAPH_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": SCOPES,
        "state": state,
    }
    url = AUTHORIZE_URL.format(tenant=settings.MS_GRAPH_TENANT_ID)
    return f"{url}?{urlencode(params)}"


async def exchange_code_for_userinfo(code: str, redirect_uri: str) -> Optional[dict]:
    """Exchanges the authorization code for an access token, then reads the
    signed-in person's directory record. Avoids validating an id_token signature
    ourselves — the token endpoint is pinned to our tenant, so a token existing
    at all already proves tenant membership. Returns None on any failure.

    Reads Graph /me rather than the OIDC userinfo endpoint because userinfo omits
    `userType`, and telling a Member from a guest is the whole basis for
    auto-provisioning. Falls back to userinfo if /me is unavailable (e.g. User.Read
    not consented) — the caller then sees user_type=None and refuses to provision.
    """
    token_url = TOKEN_URL.format(tenant=settings.MS_GRAPH_TENANT_ID)
    data = {
        "client_id": settings.MS_GRAPH_CLIENT_ID,
        "client_secret": settings.MS_GRAPH_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "scope": SCOPES,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(token_url, data=data)
        if token_resp.status_code != 200:
            return None
        access_token = token_resp.json().get("access_token")
        if not access_token:
            return None

        headers = {"Authorization": f"Bearer {access_token}"}
        me_resp = await client.get(ME_URL, headers=headers)
        if me_resp.status_code == 200:
            me = me_resp.json()
            # `mail` is unset for accounts with no mailbox; UPN is always present
            # and is the sign-in identity, so it is the more reliable key.
            email = me.get("mail") or me.get("userPrincipalName")
            if not email:
                return None
            return {
                "email": email.lower(),
                "name": me.get("displayName"),
                "user_type": me.get("userType"),
                "department": me.get("department"),
                "job_title": me.get("jobTitle"),
            }

        userinfo_resp = await client.get(USERINFO_URL, headers=headers)
        if userinfo_resp.status_code != 200:
            return None
        payload = userinfo_resp.json()

    email = payload.get("email")
    if not email:
        return None
    # No user_type available on this path — deliberately absent so the caller
    # fails closed rather than provisioning an account it cannot vouch for.
    return {"email": email.lower(), "name": payload.get("name"), "user_type": None}
