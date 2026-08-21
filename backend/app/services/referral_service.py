import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, case

from app.models.referral import Referral
from app.models.job import Job
from app.models.user import User
from app.schemas.referral import ReferralCreate, ReferralBonusUpdate


VALID_STATUSES = {"pending", "invited", "applied", "in_progress", "hired", "rejected", "expired"}

# Once a referral has a real linked application, that application's stage is
# ground truth — Referral.status is a separately-writable column (HR can set
# it freely via PATCH /referrals/{id}/status, and move_stage only ever pushes
# INTO it for hired/rejected, never re-syncs it back), so a manual edit or a
# missed sync can leave it stuck showing e.g. "rejected" forever while the
# application has actually moved on to "applied"/further. Rather than trust
# the stored column once ground truth exists elsewhere, every read derives
# the displayed status from the application's current stage. The stored
# column still matters for referrals with no application yet (pending /
# invited / expired), where there's nothing to derive from.
_STAGE_TO_REFERRAL_STATUS = {
    "applied": "applied",
    "screening": "in_progress",
    "assessment": "in_progress",
    "tr1": "in_progress",
    "tr2": "in_progress",
    "hr": "in_progress",
    "offer": "in_progress",
    "hired": "hired",
    "rejected": "rejected",
    "interview_drop": "rejected",
    "offer_drop": "rejected",
    "withdrawn": "rejected",
}


def _derived_status_expr():
    """SQL mirror of _STAGE_TO_REFERRAL_STATUS, for filtering/counting on the
    same derived status _to_dict() displays — keeps the status tabs on
    ReferralsPage/MyReferralsPage consistent with what each row's badge
    actually shows instead of filtering on the raw (possibly stale) column."""
    from app.models.application import Application

    return case(
        (Application.stage == "applied", "applied"),
        (Application.stage.in_(["screening", "assessment", "tr1", "tr2", "hr", "offer"]), "in_progress"),
        (Application.stage == "hired", "hired"),
        (Application.stage.in_(["rejected", "interview_drop", "offer_drop", "withdrawn"]), "rejected"),
        else_=Referral.status,
    )


def _build_join_query(condition=None):
    from app.models.application import Application

    q = (
        select(
            Referral,
            Job.title.label("job_title"),
            Job.slug.label("job_slug"),
            User.full_name.label("referrer_name"),
            Application.stage.label("application_stage"),
            Application.id.label("application_id"),
        )
        .join(Job, Referral.job_id == Job.id)
        .join(User, Referral.referred_by == User.id)
        .outerjoin(Application, Application.referral_id == Referral.id)
    )
    if condition is not None:
        q = q.where(condition)
    return q


def _to_dict(row) -> dict:
    from app.services.storage_service import refresh_url

    r = row.Referral
    d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
    d["job_title"] = row.job_title
    d["job_slug"] = row.job_slug
    d["referrer_name"] = row.referrer_name
    if d.get("bonus_amount") is not None:
        d["bonus_amount"] = float(d["bonus_amount"])
    # Same expiring-SAS issue as application resumes/documents — the URL
    # stored at upload time only carries a 7-day token, so re-sign on every read.
    if d.get("resume_url"):
        d["resume_url"] = refresh_url(d["resume_url"])

    application_stage = getattr(row, "application_stage", None)
    if application_stage is not None:
        d["status"] = _STAGE_TO_REFERRAL_STATUS.get(application_stage, d["status"])
    d["application_id"] = getattr(row, "application_id", None)
    return d


async def create_referral(db: AsyncSession, data: ReferralCreate, referrer_id: uuid.UUID) -> dict:
    from datetime import datetime, timezone, timedelta

    job = await db.get(Job, data.job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.is_internal or not job.allow_referrals:
        raise HTTPException(403, "This job is not open to referrals")

    # Block referral if candidate was rejected within the last 6 months
    from app.services.duplicate_detection_service import check_cooloff

    candidate_user = (await db.execute(
        select(User).where(User.email == data.candidate_email)
    )).scalar_one_or_none()

    if candidate_user:
        recent_rejection = await check_cooloff(db, candidate_user.id)
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
        technical_proficiency=data.technical_proficiency,
        note=data.note,
        resume_url=data.resume_url,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(referral)
    await db.flush()
    row = (await db.execute(_build_join_query(Referral.id == referral.id))).first()
    await db.commit()
    result = _to_dict(row)

    # Email (a real ACS send takes several seconds) runs out-of-request via
    # Celery — same fix as interview/assessment scheduling and document
    # requests, which had the identical await-send_email-inline bug.
    try:
        from app.tasks.email_tasks import send_referral_invite_email_task
        send_referral_invite_email_task.delay(str(result["id"]))
    except Exception:
        pass

    return result


async def auto_expire_referrals(db: AsyncSession) -> int:
    """Flip stale pending/invited referrals to 'expired' once their 24h window passes.

    The application-submit path already rejects an expired referral_id on its own
    (checks expires_at live, doesn't depend on this), so a candidate can never
    apply against a dead token even if this job hasn't run yet — this exists so
    the status HR/employees actually SEE (ReferralsPage, MyReferralsPage) reflects
    reality instead of showing "Pending"/"Invited" forever on a token that already
    silently stopped working.
    """
    now = datetime.now(timezone.utc)
    stale = (await db.execute(
        select(Referral).where(
            Referral.status.in_(["pending", "invited"]),
            Referral.expires_at.is_not(None),
            Referral.expires_at < now,
        )
    )).scalars().all()

    for referral in stale:
        referral.status = "expired"
        referral.updated_at = now

    if stale:
        await db.commit()
    return len(stale)


async def list_referrals(
    db: AsyncSession,
    *,
    referred_by: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    from app.models.application import Application

    filters = []
    if referred_by:
        filters.append(Referral.referred_by == referred_by)
    if status:
        filters.append(_derived_status_expr() == status)

    condition = and_(*filters) if filters else None

    count_q = select(func.count()).select_from(Referral).outerjoin(
        Application, Application.referral_id == Referral.id
    )
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
    from app.models.application import Application

    if status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status: {status}")

    referral = (await db.execute(select(Referral).where(Referral.id == referral_id))).scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")

    # Once the candidate has a real application, its stage is what get_referral/
    # list_referrals actually display (see _STAGE_TO_REFERRAL_STATUS) — manually
    # overriding the raw column here would just get silently overwritten on the
    # next read, which is exactly the bug this guard closes (a stale manual
    # "rejected" surviving forever while the real pipeline moved on to
    # "applied"). Point HR at the actual pipeline instead of letting them set a
    # value that can never stick.
    linked_application = (await db.execute(
        select(Application.id).where(Application.referral_id == referral_id)
    )).scalar_one_or_none()
    if linked_application:
        raise HTTPException(
            status_code=400,
            detail=(
                "This referral already has an application — its status now follows the "
                "application's stage automatically. Update the stage on the Applicants page instead."
            ),
        )

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
    referral.expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    referral.updated_at = datetime.now(timezone.utc)
    await db.commit()
    result = await get_referral(db, referral_id)

    try:
        from app.tasks.email_tasks import send_referral_invite_email_task
        send_referral_invite_email_task.delay(str(referral_id))
    except Exception:
        pass

    return result
