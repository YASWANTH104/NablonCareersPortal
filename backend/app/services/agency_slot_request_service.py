"""Agency → HR requests for interview slots.

An agency raises one from its portal when a role has no (or too few) open
times for a round. HR and admins get an in-app notification plus an email,
and the request sits in the "Publish to agencies" inbox on the Availability
page. It closes itself as fulfilled the moment HR publishes slots for the same
job and round (publish_slots / assign_slots_batch call fulfil_matching), or HR
dismisses it with a note. Either way the agency is emailed.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants.stages import ROUND_LABELS
from app.models.agency import Agency, AgencySlotRequest, JobAgencyAssignment
from app.schemas.agency import AgencySlotRequestCreate, AgencySlotRequestResponse

logger = logging.getLogger(__name__)

_HR_ROLE_VALUES = ("hr_manager", "admin", "super_admin")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_response(r: AgencySlotRequest, **extra) -> AgencySlotRequestResponse:
    return AgencySlotRequestResponse(
        id=r.id,
        round_type=r.round_type,
        round_label=ROUND_LABELS.get(r.round_type, r.round_type),
        candidates_count=r.candidates_count,
        date_from=r.date_from,
        date_to=r.date_to,
        time_preference=r.time_preference,
        note=r.note,
        status=r.status,
        created_at=r.created_at,
        resolved_at=r.resolved_at,
        resolution_note=r.resolution_note,
        slots_published=r.slots_published,
        **extra,
    )


def _queue(task_name: str, *args) -> None:
    try:
        from app.tasks import email_tasks
        getattr(email_tasks, task_name).delay(*args)
    except Exception:
        logger.exception(f"Couldn't queue {task_name}{args}")


# ── Agency side ──────────────────────────────────────────────────────────────

async def create_request(
    db: AsyncSession, agency: Agency, assignment: JobAgencyAssignment, data: AgencySlotRequestCreate,
) -> AgencySlotRequestResponse:
    from app.models.job import Job
    from app.models.notification import Notification
    from app.models.user import User
    from app.utils.timezone import IST

    today_ist = _now().astimezone(IST).date()
    if data.date_from < today_ist:
        raise HTTPException(422, "Pick dates from today onwards")

    existing = (await db.execute(
        select(AgencySlotRequest).where(
            AgencySlotRequest.assignment_id == assignment.id,
            AgencySlotRequest.round_type == data.round_type,
            AgencySlotRequest.status == "open",
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(
            409,
            f"You already asked for {ROUND_LABELS.get(data.round_type, data.round_type)} times — "
            "the hiring team has it and will publish slots soon.",
        )

    req = AgencySlotRequest(
        agency_id=agency.id,
        assignment_id=assignment.id,
        job_id=assignment.job_id,
        round_type=data.round_type,
        candidates_count=data.candidates_count,
        date_from=data.date_from,
        date_to=data.date_to,
        time_preference=data.time_preference,
        note=(data.note or "").strip() or None,
        status="open",
        created_at=_now(),
    )
    db.add(req)
    await db.flush()

    job = await db.get(Job, assignment.job_id)
    round_label = ROUND_LABELS.get(data.round_type, data.round_type)
    who = f"{data.candidates_count} candidate{'s' if data.candidates_count != 1 else ''}"
    hr_ids = (await db.execute(
        select(User.id).where(User.role.in_(_HR_ROLE_VALUES), User.is_active == True)  # noqa: E712
    )).scalars().all()
    for uid in hr_ids:
        db.add(Notification(
            user_id=uid,
            type="agency_slot_request",
            title=f"{agency.name} needs {round_label} slots",
            body=f"{job.title if job else 'A role'} · {who} · "
                 f"{data.date_from.strftime('%d %b')}–{data.date_to.strftime('%d %b')}",
            link=f"/hr/availability?mode=publish&request={req.id}",
        ))
    await db.commit()

    _queue("send_agency_slot_request_hr_email", str(req.id))
    return _to_response(req)


async def list_for_assignment(db: AsyncSession, assignment_id: uuid.UUID) -> list[AgencySlotRequestResponse]:
    rows = (await db.execute(
        select(AgencySlotRequest)
        .where(AgencySlotRequest.assignment_id == assignment_id)
        .order_by(AgencySlotRequest.created_at.desc())
        .limit(10)
    )).scalars().all()
    return [_to_response(r) for r in rows]


# ── HR side ──────────────────────────────────────────────────────────────────

async def list_for_hr(db: AsyncSession, status: Optional[str] = "open") -> dict:
    from app.models.job import Job
    from app.models.interview_slot import InterviewSlot

    q = (
        select(AgencySlotRequest, Agency.name, Job.title)
        .join(Agency, Agency.id == AgencySlotRequest.agency_id)
        .join(Job, Job.id == AgencySlotRequest.job_id)
        .order_by(AgencySlotRequest.created_at.desc())
    )
    if status:
        q = q.where(AgencySlotRequest.status == status)
    rows = (await db.execute(q.limit(100))).all()

    # How many bookable times that job+round already has, so HR can see
    # whether a request is still a real gap before publishing more
    open_counts: dict = {}
    pairs = {(r.job_id, r.round_type) for r, _, _ in rows if r.status == "open"}
    if pairs:
        for job_id, round_type, n in (await db.execute(
            select(InterviewSlot.job_id, InterviewSlot.round_type, func.count())
            .where(
                InterviewSlot.status == "open",
                InterviewSlot.start_time > _now(),
                InterviewSlot.job_id.in_([p[0] for p in pairs]),
            )
            .group_by(InterviewSlot.job_id, InterviewSlot.round_type)
        )).all():
            open_counts[(job_id, round_type)] = n

    open_total = (await db.execute(
        select(func.count()).select_from(AgencySlotRequest).where(AgencySlotRequest.status == "open")
    )).scalar_one()
    return {
        "open_count": open_total,
        "items": [
            _to_response(
                r, agency_id=r.agency_id, agency_name=agency_name, job_id=r.job_id, job_title=job_title,
                open_slots_now=open_counts.get((r.job_id, r.round_type), 0) if r.status == "open" else None,
            )
            for r, agency_name, job_title in rows
        ],
    }


async def resolve(db: AsyncSession, request_id: uuid.UUID, status: str, note: Optional[str], user) -> AgencySlotRequestResponse:
    req = (await db.execute(
        select(AgencySlotRequest).where(AgencySlotRequest.id == request_id).with_for_update()
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Request not found")
    if req.status != "open":
        raise HTTPException(400, f"This request is already {req.status}")
    req.status = status
    req.resolved_at = _now()
    req.resolved_by = user.id
    req.resolution_note = (note or "").strip() or None
    await db.commit()
    _queue("send_agency_slot_request_update_email", str(req.id))
    return _to_response(req)


async def fulfil_matching(db: AsyncSession, job_id: uuid.UUID, round_type: str, published: int) -> int:
    """Called right after HR publishes slots for a job+round: closes that
    job+round's open requests and emails each agency that times are up.
    Never raises — publishing must not fail because of this."""
    if not published or not job_id or not round_type:
        # Raw availability with no job yet isn't bookable by agencies, so it fulfils nothing
        return 0
    try:
        reqs = (await db.execute(
            select(AgencySlotRequest).where(
                AgencySlotRequest.job_id == job_id,
                AgencySlotRequest.round_type == round_type,
                AgencySlotRequest.status == "open",
            ).with_for_update(skip_locked=True)
        )).scalars().all()
        for r in reqs:
            r.status = "fulfilled"
            r.resolved_at = _now()
            r.slots_published = published
        if reqs:
            await db.commit()
        for r in reqs:
            _queue("send_agency_slot_request_update_email", str(r.id))
        return len(reqs)
    except Exception:
        logger.exception(f"Auto-fulfilling slot requests failed for job {job_id} / {round_type}")
        await db.rollback()
        return 0
