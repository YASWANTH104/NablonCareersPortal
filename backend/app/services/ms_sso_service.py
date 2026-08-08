"""Microsoft SSO login (delegated OIDC authorization-code flow) for internal
staff — separate concern from ms_graph_service.py's app-only calendar calls,
even though both reuse the same Entra ID app registration (MS_GRAPH_TENANT_ID/
CLIENT_ID/CLIENT_SECRET): this flow is a real user redirect + sign-in, that one
is the backend acting as itself with no user involved.

Optional login method — password login keeps working unchanged regardless of
whether this is configured. Candidates never use this path; only accounts that
already exist with a non-applicant role can sign in this way (see auth_service.
login_with_microsoft) — there's no self-service account creation via SSO.
"""
from urllib.parse import urlencode
from typing import Optional

import httpx

from app.config import settings

AUTHORIZE_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
USERINFO_URL = "https://graph.microsoft.com/oidc/userinfo"

SCOPES = "openid profile email"


def is_configured() -> bool:
    return settings.ms_graph_configured


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
    """Exchanges the authorization code for an access token, then calls the OIDC
    userinfo endpoint to get the signed-in person's email/name — avoids having to
    validate an id_token's signature ourselves. Returns None on any failure."""
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

        userinfo_resp = await client.get(
            USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
        )
        if userinfo_resp.status_code != 200:
            return None
        payload = userinfo_resp.json()

    email = payload.get("email")
    if not email:
        return None
    return {"email": email, "name": payload.get("name")}
