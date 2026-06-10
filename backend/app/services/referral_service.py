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
        select(Referral, Job.title.label("job_title"), User.full_name.label("referrer_name"))
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
    d["referrer_name"] = row.referrer_name
    if d.get("bonus_amount") is not None:
        d["bonus_amount"] = float(d["bonus_amount"])
    return d


async def create_referral(db: AsyncSession, data: ReferralCreate, referrer_id: uuid.UUID) -> dict:
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
    return _to_dict(row)


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
    return await get_referral(db, referral_id)
