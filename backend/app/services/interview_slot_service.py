import uuid
from datetime import datetime, timedelta
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_, func

from app.models.interview_slot import InterviewSlot
from app.schemas.interview import InterviewCreate, PanelistCreate
from app.schemas.interview_slot import SlotResponse, AvailableSlotGroup

ROUND_TO_NUMBER = {"tr1": 1, "tr2": 2, "hr": 3}
ROUND_TO_INTERVIEW_TYPE = {"tr1": "technical", "tr2": "technical", "hr": "hr"}
SLOT_CONFLICT_MESSAGE = "This slot is no longer available — please pick another."


def _is_hr(user) -> bool:
    return user.role in ("hr_manager", "admin", "super_admin")


async def list_publishable_jobs(db: AsyncSession) -> list[dict]:
    """Minimal {id, title} list for the availability-publishing job picker.

    Deliberately NOT the general GET /jobs endpoint — that treats interviewer
    as a public/candidate-facing caller and filters to published, externally
    visible jobs only, which would hide paused/internal jobs an interviewer
    still needs to publish availability against.
    """
    from app.models.job import Job

    rows = (await db.execute(select(Job.id, Job.title).order_by(Job.title))).all()
    return [{"id": job_id, "title": title} for job_id, title in rows]


async def publish_slots(
    db: AsyncSession,
    *,
    requesting_user,
    interviewer_id: Optional[uuid.UUID],
    job_id: uuid.UUID,
    round_type: str,
    duration_mins: int,
    start_times: list[datetime],
) -> list[SlotResponse]:
    # Only HR/admin may publish on someone else's behalf — an interviewer can
    # only ever publish their own availability, regardless of what the router
    # passed through.
    if not _is_hr(requesting_user):
        interviewer_id = requesting_user.id
    elif interviewer_id is None:
        interviewer_id = requesting_user.id

    # Duration is now configurable per publish batch (30 or 60 min), so two
    # slots for the same interviewer can overlap even without sharing an
    # exact start_time (e.g. a 60-min slot at 10:00 and a 30-min slot at
    # 10:30) — check real interval overlap against everything already on
    # this interviewer's calendar, not just an exact-timestamp collision.
    existing = (await db.execute(
        select(InterviewSlot.start_time, InterviewSlot.duration_mins).where(
            InterviewSlot.interviewer_id == interviewer_id
        )
    )).all()
    existing_intervals = [(st, st + timedelta(minutes=dur)) for st, dur in existing]

    created = []
    for st in start_times:
        new_end = st + timedelta(minutes=duration_mins)
        if any(st < e_end and new_end > e_start for e_start, e_end in existing_intervals):
            continue
        slot = InterviewSlot(
            interviewer_id=interviewer_id, job_id=job_id,
            round_type=round_type, start_time=st, duration_mins=duration_mins,
        )
        db.add(slot)
        created.append(slot)
        existing_intervals.append((st, new_end))  # guards overlaps within this same batch too

    await db.commit()
    for slot in created:
        await db.refresh(slot)
    return [_to_response(s) for s in created]


async def unpublish_slot(db: AsyncSession, slot_id: uuid.UUID, requesting_user) -> None:
    slot = await db.get(InterviewSlot, slot_id)
    if not slot:
        raise HTTPException(404, "Slot not found")
    if not _is_hr(requesting_user) and slot.interviewer_id != requesting_user.id:
        raise HTTPException(403, "You can only un-publish your own slots")
    if slot.status != "open":
        raise HTTPException(400, "Only open (unbooked) slots can be removed")
    await db.delete(slot)
    await db.commit()


async def _slots_for_interviewer(db: AsyncSession, interviewer_id: uuid.UUID) -> list[SlotResponse]:
    from app.models.job import Job
    from app.models.interview import Interview
    from app.models.application import Application
    from app.models.user import User

    rows = (await db.execute(
        select(InterviewSlot, Job.title)
        .join(Job, Job.id == InterviewSlot.job_id)
        .where(InterviewSlot.interviewer_id == interviewer_id)
        .order_by(InterviewSlot.start_time)
    )).all()

    # Batch-fetch candidate names for any booked slots rather than querying per-row.
    interview_ids = [slot.interview_id for slot, _ in rows if slot.interview_id]
    candidate_by_interview = {}
    if interview_ids:
        cand_rows = (await db.execute(
            select(Interview.id, User.full_name)
            .select_from(Interview)
            .join(Application, Application.id == Interview.application_id)
            .join(User, User.id == Application.applicant_id)
            .where(Interview.id.in_(interview_ids))
        )).all()
        candidate_by_interview = dict(cand_rows)

    return [
        _to_response(slot, job_title=job_title, candidate_name=candidate_by_interview.get(slot.interview_id))
        for slot, job_title in rows
    ]


async def get_my_slots(db: AsyncSession, interviewer_id: uuid.UUID) -> list[SlotResponse]:
    return await _slots_for_interviewer(db, interviewer_id)


async def get_interviewer_slots_for_hr(db: AsyncSession, interviewer_id: uuid.UUID) -> list[SlotResponse]:
    return await _slots_for_interviewer(db, interviewer_id)


async def get_available_slots_for_job(
    db: AsyncSession, job_id: uuid.UUID, round_type: Optional[str] = None
) -> list[AvailableSlotGroup]:
    filters = [InterviewSlot.job_id == job_id, InterviewSlot.status == "open"]
    if round_type:
        filters.append(InterviewSlot.round_type == round_type)

    rows = (await db.execute(
        select(InterviewSlot.start_time, InterviewSlot.duration_mins, InterviewSlot.round_type, func.count())
        .where(and_(*filters))
        .group_by(InterviewSlot.start_time, InterviewSlot.duration_mins, InterviewSlot.round_type)
        .order_by(InterviewSlot.start_time)
    )).all()

    return [
        AvailableSlotGroup(start_time=st, duration_mins=dur, round_type=rt, available_count=cnt)
        for st, dur, rt, cnt in rows
    ]


async def get_job_slots_for_hr(db: AsyncSession, job_id: uuid.UUID) -> list[SlotResponse]:
    from app.models.job import Job
    from app.models.user import User

    rows = (await db.execute(
        select(InterviewSlot, Job.title, User.full_name)
        .join(Job, Job.id == InterviewSlot.job_id)
        .join(User, User.id == InterviewSlot.interviewer_id)
        .where(InterviewSlot.job_id == job_id, InterviewSlot.status == "open")
        .order_by(InterviewSlot.start_time)
    )).all()
    return [
        _to_response(slot, job_title=job_title, interviewer_name=interviewer_name)
        for slot, job_title, interviewer_name in rows
    ]


async def book_slot(
    db: AsyncSession,
    *,
    application_id: uuid.UUID,
    slot_id: Optional[uuid.UUID] = None,
    job_id: Optional[uuid.UUID] = None,
    round_type: Optional[str] = None,
    start_time: Optional[datetime] = None,
    duration_mins: Optional[int] = None,
    booked_by_agency_id: Optional[uuid.UUID] = None,
    booked_by_user_id: Optional[uuid.UUID] = None,
) -> SlotResponse:
    """Atomically claims one open slot matching the given criteria, then
    creates a real Interview for it via the existing scheduling pipeline.

    The claiming UPDATE below executes within the current (uncommitted)
    transaction — `interview_service.create_interview()` is called on the
    SAME session right after, and its own `db.commit()` is what finalizes
    both the slot claim and the interview creation together. If
    `create_interview()` raises (e.g. a real calendar conflict for that
    interviewer), the exception must propagate uncaught so `get_db()`'s
    rollback undoes the slot claim too — never wrap this call in a try/except
    that swallows it.
    """
    if slot_id:
        criteria = [InterviewSlot.id == slot_id, InterviewSlot.status == "open"]
    else:
        criteria = [
            InterviewSlot.job_id == job_id,
            InterviewSlot.round_type == round_type,
            InterviewSlot.start_time == start_time,
            InterviewSlot.status == "open",
        ]
        if duration_mins is not None:
            criteria.append(InterviewSlot.duration_mins == duration_mins)

    claim_stmt = (
        update(InterviewSlot)
        .where(InterviewSlot.id.in_(
            select(InterviewSlot.id).where(and_(*criteria)).with_for_update(skip_locked=True).limit(1)
        ))
        .values(status="booked")
        .returning(InterviewSlot)
    )
    slot = (await db.execute(claim_stmt)).scalar_one_or_none()
    if not slot:
        raise HTTPException(409, SLOT_CONFLICT_MESSAGE)

    from app.services import interview_service

    interview_data = InterviewCreate(
        application_id=application_id,
        round_number=ROUND_TO_NUMBER[slot.round_type],
        interview_type=ROUND_TO_INTERVIEW_TYPE[slot.round_type],
        scheduled_at=slot.start_time,
        duration_mins=slot.duration_mins,
        panelists=[PanelistCreate(user_id=slot.interviewer_id, role="interviewer")],
    )
    interview = await interview_service.create_interview(db, interview_data, created_by=booked_by_user_id)

    slot.interview_id = interview.id
    slot.booked_by_agency_id = booked_by_agency_id
    slot.booked_by_user_id = booked_by_user_id
    await db.commit()
    await db.refresh(slot)

    return _to_response(slot)


def _to_response(slot: InterviewSlot, job_title=None, interviewer_name=None, candidate_name=None) -> SlotResponse:
    # Anonymization for agencies is structural, not a hidden-field trick here —
    # the agency-facing aggregate uses AvailableSlotGroup, a schema with no
    # interviewer field at all, and never calls this function.
    return SlotResponse(
        id=slot.id,
        job_id=slot.job_id,
        job_title=job_title,
        round_type=slot.round_type,
        start_time=slot.start_time,
        duration_mins=slot.duration_mins,
        status=slot.status,
        interview_id=slot.interview_id,
        interviewer_id=slot.interviewer_id,
        interviewer_name=interviewer_name,
        candidate_name=candidate_name,
    )
