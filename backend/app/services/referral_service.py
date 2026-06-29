import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.referral import Referral
from app.models.job import Job
from app.models.user import User
from app.schemas.referral import ReferralCreate, ReferralBonusUpdate


VALID_STATUSES = {"pending", "invited", "applied", "in_progress", "hired", "rejected", "expired"}


def _build_join_query(condition=None):
    q = (
        select(Referral, Job.title.label("job_title"), Job.slug.label("job_slug"), User.full_name.label("referrer_name"))
        .join(Job, Referral.job_id == Job.id)
        .join(User, Referral.referred_by == User.id)
    )
    if condition is not None:
        q = q.where(condition)
    return q


def _to_dict(row) -> dict:
    r = row.Referral
    d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
    d["job_title"] = row.job_title
    d["job_slug"] = row.job_slug
    d["referrer_name"] = row.referrer_name
    if d.get("bonus_amount") is not None:
        d["bonus_amount"] = float(d["bonus_amount"])
    return d


async def _send_referral_invite_email(referral_dict: dict) -> None:
    from app.services.email_service import send_email
    from app.config import settings

    apply_url = f"{settings.FRONTEND_URL}/jobs/{referral_dict['job_slug']}/apply"
    await send_email(
        to_email=referral_dict["candidate_email"],
        subject=f"You've been referred for a role at Nablon AI – {referral_dict['job_title']}",
        template_name="referral_invite",
        context={
            "candidate_name": referral_dict["candidate_name"],
            "referrer_name": referral_dict["referrer_name"],
            "job_title": referral_dict["job_title"],
            "apply_url": apply_url,
        },
    )


async def create_referral(db: AsyncSession, data: ReferralCreate, referrer_id: uuid.UUID) -> dict:
    from datetime import datetime, timezone, timedelta
    from app.models.application import Application

    # Block referral if candidate was rejected within the last 6 months
    candidate_user = (await db.execute(
        select(User).where(User.email == data.candidate_email)
    )).scalar_one_or_none()

    if candidate_user:
        cooloff_start = datetime.now(timezone.utc) - timedelta(days=183)
        recent_rejection = (await db.execute(
            select(Application).where(
                Application.applicant_id == candidate_user.id,
                Application.stage == "rejected",
                Application.stage_updated_at >= cooloff_start,
            )
        )).scalar_one_or_none()

        if recent_rejection:
            eligible_date = (recent_rejection.stage_updated_at + timedelta(days=183)).strftime("%d %B %Y")
            raise HTTPException(
                403,
                f"This candidate is not eligible for referral at this time. They may be referred again after {eligible_date}.",
            )

    existing = (await db.execute(
        select(Referral).where(
            Referral.job_id == data.job_id,
            Referral.candidate_email == data.candidate_email,
        )
    )).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"This candidate has already been referred for this role by {'another employee' if existing.referred_by != referrer_id else 'you'}.",
        )

    referral = Referral(
        job_id=data.job_id,
        referred_by=referrer_id,
        candidate_name=data.candidate_name,
        candidate_email=data.candidate_email,
        candidate_phone=data.candidate_phone,
        relationship=data.relationship,
        note=data.note,
        resume_url=data.resume_url,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=14),
    )
    db.add(referral)
    await db.flush()
    row = (await db.execute(_build_join_query(Referral.id == referral.id))).first()
    await db.commit()
    result = _to_dict(row)
    await _send_referral_invite_email(result)
    return result


async def list_referrals(
    db: AsyncSession,
    *,
    referred_by: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    filters = []
    if referred_by:
        filters.append(Referral.referred_by == referred_by)
    if status:
        filters.append(Referral.status == status)

    condition = and_(*filters) if filters else None

    count_q = select(func.count()).select_from(Referral)
    if condition is not None:
        count_q = count_q.where(condition)
    total = (await db.execute(count_q)).scalar_one()

    offset = (page - 1) * limit
    q = _build_join_query(condition).order_by(Referral.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(q)).all()

    items = [_to_dict(r) for r in rows]
    return {"items": items, "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


async def get_referral(db: AsyncSession, referral_id: uuid.UUID) -> dict:
    row = (await db.execute(_build_join_query(Referral.id == referral_id))).first()
    if not row:
        raise HTTPException(status_code=404, detail="Referral not found")
    return _to_dict(row)


async def update_status(db: AsyncSession, referral_id: uuid.UUID, status: str) -> dict:
    if status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status: {status}")

    referral = (await db.execute(select(Referral).where(Referral.id == referral_id))).scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")

    referral.status = status
    if status == "invited" and not referral.invited_at:
        referral.invited_at = datetime.now(timezone.utc)
    if status == "hired":
        referral.bonus_eligible = True
    referral.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_referral(db, referral_id)


async def update_bonus(db: AsyncSession, referral_id: uuid.UUID, data: ReferralBonusUpdate) -> dict:
    referral = (await db.execute(select(Referral).where(Referral.id == referral_id))).scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")

    if data.bonus_eligible is not None:
        referral.bonus_eligible = data.bonus_eligible
    if data.bonus_paid is not None:
        referral.bonus_paid = data.bonus_paid
    if data.bonus_amount is not None:
        referral.bonus_amount = data.bonus_amount
    referral.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_referral(db, referral_id)


async def resend_invite(db: AsyncSession, referral_id: uuid.UUID) -> dict:
    referral = (await db.execute(select(Referral).where(Referral.id == referral_id))).scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")

    referral.status = "invited"
    referral.invited_at = datetime.now(timezone.utc)
    referral.expires_at = datetime.now(timezone.utc) + timedelta(days=14)
    referral.updated_at = datetime.now(timezone.utc)
    await db.commit()
    result = await get_referral(db, referral_id)
    await _send_referral_invite_email(result)
    return result
