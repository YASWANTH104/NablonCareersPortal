import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import Application
from app.models.user import User

COOLOFF_DAYS = 183

# Roles a "candidate" identity can plausibly hold — excludes internal HR/interviewer
# staff so a coincidental name match against a colleague never gets flagged.
_CANDIDATE_ROLES = ("applicant", "employee")


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


async def check_cooloff(db: AsyncSession, user_id: uuid.UUID) -> Optional[Application]:
    """Most recent rejection for this exact account within the 6-month cool-off
    window, or None if they're eligible to apply. Same-account rejections are an
    authoritative signal (unlike a fuzzy name match), so this is used to hard-block
    reapplication — regardless of whether the submission comes from the public
    apply form, HR/TA, an agency, or a bulk upload."""
    cooloff_start = datetime.now(timezone.utc) - timedelta(days=COOLOFF_DAYS)
    return (await db.execute(
        select(Application)
        .where(
            Application.applicant_id == user_id,
            Application.stage == "rejected",
            Application.stage_updated_at >= cooloff_start,
        )
        .order_by(Application.stage_updated_at.desc())
    )).scalars().first()


def cooloff_message(rejection: Application) -> str:
    eligible_date = (rejection.stage_updated_at + timedelta(days=COOLOFF_DAYS)).strftime("%d %B %Y")
    return f"You are not eligible to apply at this time. You may reapply after {eligible_date}."


async def find_name_duplicates(db: AsyncSession, full_name: str, exclude_user_id: uuid.UUID) -> list[User]:
    """Other candidate accounts whose full name normalizes to the same value as
    this one — the signal we can still catch once email and phone have both
    changed, since a person's name rarely does."""
    normalized = normalize_name(full_name)
    if not normalized:
        return []
    return (await db.execute(
        select(User).where(
            User.id != exclude_user_id,
            User.role.in_(_CANDIDATE_ROLES),
            func.lower(func.regexp_replace(User.full_name, r'\s+', ' ', 'g')) == normalized,
        )
    )).scalars().all()


async def build_duplicate_flag(db: AsyncSession, *, user: User, full_name: str) -> tuple[bool, Optional[str]]:
    """Looks for other candidate accounts sharing this normalized name. Never
    blocks — a name match alone isn't proof of identity, so this only flags the
    application for HR to review and decide. If a matched account is itself
    within its own rejection cool-off, that's called out explicitly since it's
    the highest-signal case (same person re-applying under a new email/phone to
    dodge the reapply block)."""
    from app.models.job import Job

    matches = await find_name_duplicates(db, full_name, exclude_user_id=user.id)
    if not matches:
        return False, None

    lines = []
    for match in matches:
        row = (await db.execute(
            select(Application, Job.title)
            .join(Job, Job.id == Application.job_id)
            .where(Application.applicant_id == match.id)
            .order_by(Application.applied_at.desc())
        )).first()

        detail = f"{match.full_name} ({match.email})"
        if row:
            app, job_title = row
            detail += f" — applied for '{job_title}' on {app.applied_at.strftime('%d %b %Y')}, currently at stage '{app.stage}'"

        rejection = await check_cooloff(db, match.id)
        if rejection:
            detail += f" — rejected {rejection.stage_updated_at.strftime('%d %b %Y')}, still within the 6-month reapply cooldown"

        lines.append(detail)

    reason = "Same name as an existing candidate record with a different email/phone: " + "; ".join(lines)
    return True, reason
