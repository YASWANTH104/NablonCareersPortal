import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_, func

from app.models.interview_slot import InterviewSlot
from app.schemas.interview import InterviewCreate, PanelistCreate
from app.schemas.interview_slot import SlotResponse, AvailableSlotGroup

# CC'd on every candidate/interviewer email that results from booking a
# published slot (HR direct-book or agency self-book) — a standing ask to
# keep visibility into slot-driven scheduling specifically, not interviews
# scheduled the regular manual way.
SLOT_BOOKING_CC = ["sneha.vangada@nablon.ai"]

ROUND_TO_NUMBER = {"tr1": 1, "tr2": 2, "hr": 3}
ROUND_TO_INTERVIEW_TYPE = {"tr1": "technical", "tr2": "technical", "hr": "hr"}
SLOT_CONFLICT_MESSAGE = "This slot is no longer available — please pick another."
# On-demand, HR-triggered nudge ("please go publish your free slots"), not an
# automated sweep — so the cooldown is enforced synchronously against the
# requesting HR user instead of silently skipping, the way the feedback-
# reminder Celery job does. Short enough that a genuinely urgent re-nudge
# later the same day isn't blocked, long enough that several HR staff
# clicking the same interviewer in a row doesn't turn into spam.
AVAILABILITY_REQUEST_COOLDOWN = timedelta(hours=6)


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

    # No per-slot refresh — id/status/duration/timestamps are all Python-side
    # defaults already set on these objects before the INSERT, not values
    # only the server knows. A refresh loop here would be one extra network
    # round trip per slot for data we already have, which is what made a
    # multi-slot drag-publish feel slow against a remote Postgres instance.
    await db.commit()
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


async def reschedule_slot(
    db: AsyncSession,
    slot_id: uuid.UUID,
    requesting_user,
    *,
    start_time: Optional[datetime] = None,
    duration_mins: Optional[int] = None,
) -> SlotResponse:
    """Editing a not-yet-booked slot's time/duration in place, instead of
    unpublish-then-republish — used by the availability grid's drag-to-resize
    (duration only) and the slot detail popover's reschedule form (start_time,
    or both). Same ownership rule as unpublish_slot; booked slots are never
    touched here (they're a real scheduled interview, not raw availability)."""
    slot = await db.get(InterviewSlot, slot_id)
    if not slot:
        raise HTTPException(404, "Slot not found")
    if not _is_hr(requesting_user) and slot.interviewer_id != requesting_user.id:
        raise HTTPException(403, "You can only reschedule your own slots")
    if slot.status != "open":
        raise HTTPException(400, "Only open (unbooked) slots can be changed")
    if start_time is None and duration_mins is None:
        raise HTTPException(400, "Nothing to change")

    new_start = start_time if start_time is not None else slot.start_time
    new_duration = duration_mins if duration_mins is not None else slot.duration_mins

    now = datetime.now(timezone.utc)
    if new_start.tzinfo is None:
        new_start = new_start.replace(tzinfo=timezone.utc)
    if new_start < now:
        raise HTTPException(400, "Can't move a slot into the past")

    # Same real-interval-overlap check as publish_slots, against every other
    # slot on this interviewer's calendar (the slot being edited is excluded
    # so it never collides with its own current time/duration).
    existing = (await db.execute(
        select(InterviewSlot.start_time, InterviewSlot.duration_mins).where(
            InterviewSlot.interviewer_id == slot.interviewer_id,
            InterviewSlot.id != slot.id,
        )
    )).all()
    new_end = new_start + timedelta(minutes=new_duration)
    for e_start, e_dur in existing:
        e_end = e_start + timedelta(minutes=e_dur)
        if new_start < e_end and new_end > e_start:
            raise HTTPException(409, "That time overlaps another slot on your calendar")

    slot.start_time = new_start
    slot.duration_mins = new_duration
    await db.commit()  # see unassign_slot below — no refresh needed
    return _to_response(slot)


async def unassign_slot(db: AsyncSession, slot_id: uuid.UUID) -> SlotResponse:
    """HR pulling a published-but-never-booked slot back to raw availability —
    clears job_id/round_type but keeps the underlying time slot intact (status
    stays "open") so it can be re-published against a different job instead of
    the interviewer having to publish a brand new slot for the same time.
    HR-only, enforced at the router. A booked slot can't be reused this way —
    unbooking is a separate, deliberate action (interview cancellation), not
    something this "free it up again" flow should silently trigger."""
    slot = await db.get(InterviewSlot, slot_id)
    if not slot:
        raise HTTPException(404, "Slot not found")
    if slot.status != "open":
        raise HTTPException(400, "Only open (unbooked) slots can be reused")

    slot.job_id = None
    slot.round_type = None
    # No refresh needed — every field on this row is either a value we just
    # set in Python or a Python-side default/onupdate (uuid4, "open",
    # datetime.utcnow, ...), never something computed server-side. Refreshing
    # would just be an extra network round trip to re-fetch data we already
    # have, which is real latency against a remote Postgres instance.
    await db.commit()
    return _to_response(slot)


async def assign_slots_batch(
    db: AsyncSession, slot_ids: list[uuid.UUID], *, job_id: uuid.UUID, round_type: str
) -> list[SlotResponse]:
    """HR attaching a job+round to several raw, interviewer-published slots at
    once — this is the "pick a job, tick several slots, publish them all"
    flow, and it's what makes a slot eligible to show up for that job's
    agencies to book (agency queries filter by job_id, so an unassigned NULL
    job_id never matches). Rows that
    are no longer open (booked/removed since the HR page loaded them) are
    silently skipped rather than failing the whole batch, since a stale
    selection shouldn't block publishing the ones that are still valid."""
    from app.models.job import Job
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    if not slot_ids:
        return []

    rows = (await db.execute(
        select(InterviewSlot).where(InterviewSlot.id.in_(slot_ids))
    )).scalars().all()

    updated = [s for s in rows if s.status == "open"]
    for slot in updated:
        slot.job_id = job_id
        slot.round_type = round_type

    await db.commit()  # see unassign_slot above — no per-row refresh needed
    return [_to_response(s, job_title=job.title) for s in updated]


async def _slots_for_interviewer(db: AsyncSession, interviewer_id: uuid.UUID) -> list[SlotResponse]:
    from app.models.job import Job
    from app.models.interview import Interview
    from app.models.application import Application
    from app.models.user import User

    # outerjoin, not join: an interviewer's own calendar must still show
    # slots they've published that HR hasn't assigned a job to yet — an
    # inner join would silently drop every unassigned (job_id IS NULL) slot.
    rows = (await db.execute(
        select(InterviewSlot, Job.title)
        .outerjoin(Job, Job.id == InterviewSlot.job_id)
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


async def request_publish_reminder(
    db: AsyncSession, interviewer_id: uuid.UUID, requested_by
) -> dict:
    """HR asking an interviewer (who hasn't published much/any free time) to
    go do it — fires an in-app notification plus an email, same as every
    other "someone should look at this" moment in the app (interview
    scheduling, feedback reminders). Rate-limited per interviewer, not per
    HR user, since the goal is protecting the interviewer's inbox regardless
    of how many different HR staff try to nudge them."""
    from app.models.user import User

    interviewer = await db.get(User, interviewer_id)
    if not interviewer or interviewer.role != "interviewer":
        raise HTTPException(404, "Interviewer not found")

    now = datetime.now(timezone.utc)
    last_sent = interviewer.last_availability_request_sent_at
    if last_sent is not None:
        # Older DBs may still have naive timestamps from before this column
        # was timezone-aware end to end — treat them as UTC rather than
        # crashing on a naive/aware comparison.
        if last_sent.tzinfo is None:
            last_sent = last_sent.replace(tzinfo=timezone.utc)
        retry_at = last_sent + AVAILABILITY_REQUEST_COOLDOWN
        if retry_at > now:
            minutes_left = int((retry_at - now).total_seconds() // 60) + 1
            raise HTTPException(
                429,
                f"{interviewer.full_name} was already reminded recently — try again in "
                f"{minutes_left} minute{'s' if minutes_left != 1 else ''}.",
            )

    interviewer.last_availability_request_sent_at = now

    try:
        from app.models.notification import Notification
        db.add(Notification(
            user_id=interviewer.id,
            type="availability_request",
            title="HR needs your interview availability",
            body=f"{requested_by.full_name} asked you to publish your free slots for upcoming interviews.",
            link="/hr/availability",
        ))
    except Exception:
        pass

    await db.commit()

    try:
        from app.tasks.email_tasks import send_availability_request_email_task
        send_availability_request_email_task.delay(str(interviewer.id), requested_by.full_name)
    except Exception:
        pass

    return {"message": f"Reminder sent to {interviewer.full_name}."}


async def get_publishable_slots(db: AsyncSession) -> list[SlotResponse]:
    """Every open, upcoming slot across ALL interviewers that isn't booked yet —
    both raw unassigned availability (job_id IS NULL, needs a job picked) and
    already-published-but-not-yet-booked slots (job_id set, still status="open").
    This is what the "Publish slots to agencies" panel shows by default, so HR
    doesn't have to pick one interviewer at a time to see either what's waiting
    to be published or what's published but going stale without a booking —
    the latter is what makes reuse (unassign_slot) discoverable at all."""
    from app.models.job import Job
    from app.models.user import User

    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(InterviewSlot, User.full_name, Job.title)
        .join(User, User.id == InterviewSlot.interviewer_id)
        .outerjoin(Job, Job.id == InterviewSlot.job_id)
        .where(
            InterviewSlot.status == "open",
            InterviewSlot.start_time >= now,
        )
        .order_by(InterviewSlot.start_time)
    )).all()
    return [
        _to_response(slot, job_title=job_title, interviewer_name=interviewer_name)
        for slot, interviewer_name, job_title in rows
    ]


async def get_available_slots_for_job(
    db: AsyncSession, job_id: uuid.UUID, round_type: Optional[str] = None
) -> list[AvailableSlotGroup]:
    # Agency self-book flow (routers/agencies.py) reads this directly — an
    # open-but-unbooked slot whose start_time has already passed must not be
    # offered as bookable, same "upcoming only" rule as get_publishable_slots.
    filters = [
        InterviewSlot.job_id == job_id,
        InterviewSlot.status == "open",
        InterviewSlot.start_time >= datetime.now(timezone.utc),
    ]
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
        .where(
            InterviewSlot.job_id == job_id,
            InterviewSlot.status == "open",
            InterviewSlot.start_time >= datetime.now(timezone.utc),
        )
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
    # Hard floor, not just a list-filtering concern: even if the caller's
    # slot list was fetched a moment ago while still upcoming, the clock may
    # have passed start_time by the time this claim actually runs — never let
    # a slot be booked once its time is in the past, regardless of what the
    # client had cached.
    now = datetime.now(timezone.utc)

    if slot_id:
        criteria = [InterviewSlot.id == slot_id, InterviewSlot.status == "open", InterviewSlot.start_time >= now]
    else:
        criteria = [
            InterviewSlot.job_id == job_id,
            InterviewSlot.round_type == round_type,
            InterviewSlot.start_time == start_time,
            InterviewSlot.status == "open",
            InterviewSlot.start_time >= now,
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

    # The slot_id path (HR booking directly) has no job/round in its match
    # criteria, so a still-unassigned slot could otherwise be claimed here —
    # raising propagates uncaught, which is what rolls the "booked" claim
    # above back via get_db()'s rollback (see docstring above). Unassigned
    # slots have their own dedicated booking path, book_unassigned_slot below.
    if not slot.job_id or not slot.round_type:
        raise HTTPException(400, "This slot hasn't been assigned to a job yet")

    return await _finalize_booking(
        db, slot, application_id=application_id,
        booked_by_agency_id=booked_by_agency_id, booked_by_user_id=booked_by_user_id,
    )


async def book_unassigned_slot(
    db: AsyncSession,
    *,
    slot_id: uuid.UUID,
    job_id: uuid.UUID,
    round_type: str,
    application_id: uuid.UUID,
    booked_by_user_id: uuid.UUID,
) -> SlotResponse:
    """HR's "Book for an interviewer" direct-booking path for a slot the
    interviewer published but nobody has assigned a job to yet — picking the
    job/round and picking the candidate happen as one action here, not two.

    Deliberately NOT assign_slots_batch() followed by book_slot(): doing it in two
    separate calls would leave the slot sitting in the open+assigned state
    (exactly what makes a slot visible to agencies) for however long it takes
    HR to then pick a candidate — a real window where an agency could book
    the same slot out from under the interview HR is in the middle of
    scheduling. Setting job_id/round_type/status="booked" in a single atomic
    UPDATE means the slot never passes through that agency-visible state at
    all when booked this way.
    """
    from app.models.job import Job
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    claim_stmt = (
        update(InterviewSlot)
        .where(InterviewSlot.id.in_(
            select(InterviewSlot.id)
            .where(
                InterviewSlot.id == slot_id,
                InterviewSlot.job_id.is_(None),
                InterviewSlot.status == "open",
                InterviewSlot.start_time >= datetime.now(timezone.utc),
            )
            .with_for_update(skip_locked=True).limit(1)
        ))
        .values(job_id=job_id, round_type=round_type, status="booked")
        .returning(InterviewSlot)
    )
    slot = (await db.execute(claim_stmt)).scalar_one_or_none()
    if not slot:
        raise HTTPException(409, SLOT_CONFLICT_MESSAGE)

    return await _finalize_booking(
        db, slot, application_id=application_id, booked_by_user_id=booked_by_user_id, job_title=job.title,
    )


async def _finalize_booking(
    db: AsyncSession,
    slot: InterviewSlot,
    *,
    application_id: uuid.UUID,
    booked_by_user_id: Optional[uuid.UUID] = None,
    booked_by_agency_id: Optional[uuid.UUID] = None,
    job_title: Optional[str] = None,
) -> SlotResponse:
    """Shared tail of both booking paths above: the slot row is already
    claimed (status="booked", job_id/round_type set) — this just creates the
    real Interview for it and records who booked it."""
    from app.services import interview_service

    interview_data = InterviewCreate(
        application_id=application_id,
        round_number=ROUND_TO_NUMBER[slot.round_type],
        interview_type=ROUND_TO_INTERVIEW_TYPE[slot.round_type],
        scheduled_at=slot.start_time,
        duration_mins=slot.duration_mins,
        panelists=[PanelistCreate(user_id=slot.interviewer_id, role="interviewer")],
    )
    interview = await interview_service.create_interview(
        db, interview_data, created_by=booked_by_user_id, cc_emails=SLOT_BOOKING_CC,
    )

    slot.interview_id = interview.id
    slot.booked_by_agency_id = booked_by_agency_id
    slot.booked_by_user_id = booked_by_user_id
    await db.commit()  # see unassign_slot above — no refresh needed

    return _to_response(slot, job_title=job_title)


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
