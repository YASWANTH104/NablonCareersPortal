"""Microsoft Graph integration for interview scheduling — app-only (client
credentials) auth. Creates a Teams meeting on the organizing interviewer's
calendar with the candidate + other panelists as attendees; Graph/Exchange
handles blocking each attendee's calendar and emailing the join link.

Requires an Entra ID app registration with the application permission
Calendars.ReadWrite, admin-consented. Every call is a no-op (returns None)
when MS_GRAPH_* settings aren't configured, so scheduling still works via
manual meeting links until the integration is set up.
"""
import time
import logging
from datetime import datetime, timezone as dt_timezone
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Module-level in-memory cache — fine for a single worker process; a cold
# cache just means one extra token request, never a correctness issue.
_token_cache: dict = {"token": None, "expires_at": 0.0}


def is_configured() -> bool:
    return settings.ms_graph_configured


async def _get_app_token() -> str:
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]

    url = f"https://login.microsoftonline.com/{settings.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token"
    data = {
        "client_id": settings.MS_GRAPH_CLIENT_ID,
        "client_secret": settings.MS_GRAPH_CLIENT_SECRET,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, data=data)
        resp.raise_for_status()
        payload = resp.json()

    _token_cache["token"] = payload["access_token"]
    _token_cache["expires_at"] = now + payload.get("expires_in", 3600)
    return _token_cache["token"]


def _event_payload(
    subject: str,
    start: datetime,
    end: datetime,
    attendee_emails: list[str],
    body_html: str = "",
) -> dict:
    return {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html},
        "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        "isOnlineMeeting": True,
        "onlineMeetingProvider": "teamsForBusiness",
        "attendees": [
            {"emailAddress": {"address": email}, "type": "required"}
            for email in attendee_emails
        ],
    }


async def create_teams_meeting(
    organizer_email: str,
    subject: str,
    start: datetime,
    end: datetime,
    attendee_emails: list[str],
    body_html: str = "",
) -> Optional[dict]:
    """Returns {"event_id", "join_url"} on success, None if Graph isn't configured."""
    if not is_configured():
        return None

    token = await _get_app_token()
    payload = _event_payload(subject, start, end, attendee_emails, body_html)

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/users/{organizer_email}/events",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        resp.raise_for_status()
        event = resp.json()

    return {
        "event_id": event["id"],
        "join_url": (event.get("onlineMeeting") or {}).get("joinUrl"),
    }


async def update_teams_meeting(
    organizer_email: str,
    event_id: str,
    *,
    subject: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> Optional[dict]:
    """Patches start/end/subject on an existing event. Returns {"join_url"} (unchanged
    unless Graph regenerates it) or None if Graph isn't configured."""
    if not is_configured():
        return None

    token = await _get_app_token()
    payload: dict = {}
    if subject is not None:
        payload["subject"] = subject
    if start is not None:
        payload["start"] = {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}
    if end is not None:
        payload["end"] = {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.patch(
            f"{GRAPH_BASE}/users/{organizer_email}/events/{event_id}",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        resp.raise_for_status()
        event = resp.json()

    return {"join_url": (event.get("onlineMeeting") or {}).get("joinUrl")}


def _parse_graph_dt(value: str) -> datetime:
    """Graph returns scheduleItem start/end as a naive dateTime string (we asked for
    UTC), sometimes with 7-digit fractional seconds Python's fromisoformat can't
    parse pre-3.11 — trim to microseconds and assume UTC."""
    if "." in value:
        base, frac = value.split(".", 1)
        value = f"{base}.{frac[:6]}"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=dt_timezone.utc)
    return dt


async def get_busy_blocks(
    lookup_mailbox: str,
    schedule_emails: list[str],
    start: datetime,
    end: datetime,
) -> dict[str, list[dict]]:
    """Returns {email: [{"start", "end", "status"}, ...]} — the actual busy/tentative/
    oof periods (not just a single worst-case status) for each email within
    [start, end), for rendering a day timeline. Empty dict if Graph isn't configured
    or the call fails — callers should treat that as "no Graph data available", not
    "definitely free"."""
    if not is_configured():
        return {}

    token = await _get_app_token()
    payload = {
        "schedules": schedule_emails,
        "startTime": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        "endTime": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        "availabilityViewInterval": 30,
    }

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/users/{lookup_mailbox}/calendar/getSchedule",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    results: dict[str, list[dict]] = {}
    for item in data.get("value", []):
        email = item.get("scheduleId")
        if not email or item.get("error"):
            continue
        blocks = []
        for si in item.get("scheduleItems", []):
            status = si.get("status", "busy")
            if status not in ("busy", "tentative", "oof"):
                continue
            st = (si.get("start") or {}).get("dateTime")
            en = (si.get("end") or {}).get("dateTime")
            if not st or not en:
                continue
            blocks.append({"start": _parse_graph_dt(st), "end": _parse_graph_dt(en), "status": status})
        results[email] = blocks
    return results


_BUSY_RANK = {"free": 0, "tentative": 1, "busy": 2, "oof": 3}


async def get_free_busy(
    lookup_mailbox: str,
    schedule_emails: list[str],
    start: datetime,
    end: datetime,
) -> dict[str, str]:
    """Returns {email: "free"|"tentative"|"busy"|"oof"|"unknown"} for each requested
    email over [start, end). getSchedule is invoked against lookup_mailbox's calendar
    but returns free/busy for the whole schedules list, not just that mailbox — any
    mailbox the app has Calendars.Read(Write) on works as the lookup target. Only
    returns busy/free status, never appointment subjects — safe to show HR without
    exposing what an interviewer's other meetings actually are."""
    if not is_configured():
        return {email: "unknown" for email in schedule_emails}

    token = await _get_app_token()
    payload = {
        "schedules": schedule_emails,
        "startTime": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        "endTime": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        "availabilityViewInterval": 30,
    }

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/users/{lookup_mailbox}/calendar/getSchedule",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    results: dict[str, str] = {}
    for item in data.get("value", []):
        email = item.get("scheduleId")
        if not email:
            continue
        if item.get("error"):
            results[email] = "unknown"
            continue
        worst = "free"
        for si in item.get("scheduleItems", []):
            label = si.get("status", "busy")
            if label in _BUSY_RANK and _BUSY_RANK[label] > _BUSY_RANK[worst]:
                worst = label
        results[email] = worst

    for email in schedule_emails:
        results.setdefault(email, "unknown")
    return results


async def delete_teams_meeting(organizer_email: str, event_id: str) -> None:
    """Deletes the event (cancels for all attendees). No-op if Graph isn't configured
    or the event is already gone (404 treated as success)."""
    if not is_configured():
        return

    token = await _get_app_token()
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.delete(
            f"{GRAPH_BASE}/users/{organizer_email}/events/{event_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code not in (204, 404):
            resp.raise_for_status()
