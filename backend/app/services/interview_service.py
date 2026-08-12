import uuid
from typing import Optional
from datetime import datetime, timedelta
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.interview import Interview, InterviewPanelist, InterviewFeedback, CandidateInterviewSelfFeedback
from app.schemas.interview import (
    InterviewCreate, InterviewUpdate, InterviewFeedbackCreate,
    InterviewResponse, InterviewFeedbackResponse, PanelistResponse,
    CandidateSelfFeedbackCreate, CandidateSelfFeedbackResponse,
    CandidateInterviewSummary,
)


async def _get_previous_rounds(
    db: AsyncSession,
    application_id: uuid.UUID,
    current_round: int,
) -> list[dict]:
    """Feedback from all completed rounds prior to current_round for the same application."""
    if current_round <= 1:
        return []
    prior = (await db.execute(
        select(Interview).where(
            Interview.application_id == application_id,
            Interview.round_number < current_round,
        ).order_by(Interview.round_number)
    )).scalars().all()
    if not prior:
        return []
    prior_ids = [iv.id for iv in prior]
    all_fb = (await db.execute(
        select(InterviewFeedback).where(InterviewFeedback.interview_id.in_(prior_ids))
    )).scalars().all()
    fb_by = {}
    for f in all_fb:
        fb_by.setdefault(f.interview_id, []).append(f)
    return [
        {"round_number": iv.round_number, "interview_title": iv.title,
         "feedback": [_feedback_to_dict(f) for f in fb_by.get(iv.id, [])]}
        for iv in prior
    ]


async def _batch_previous_rounds(db: AsyncSession, rows: list) -> dict:
    """Batch version of _get_previous_rounds for list views. Returns {interview_id: [entries]}."""
    needs_prev = [(row[0].application_id, row[0].round_number, row[0].id)
                  for row in rows if row[0].round_number > 1]
    if not needs_prev:
        return {}

    app_ids = list({t[0] for t in needs_prev})
    all_ivs = (await db.execute(
        select(Interview).where(
            Interview.application_id.in_(app_ids),
        )
    )).scalars().all()

    ivs_by_app: dict = {}
    for iv in all_ivs:
        ivs_by_app.setdefault(iv.application_id, []).append(iv)

    prev_ids = [iv.id for iv in all_ivs]
    all_fb = (await db.execute(
        select(InterviewFeedback).where(InterviewFeedback.interview_id.in_(prev_ids))
    )).scalars().all() if prev_ids else []
    fb_by: dict = {}
    for f in all_fb:
        fb_by.setdefault(f.interview_id, []).append(f)

    result = {}
    for app_id, current_round, interview_id in needs_prev:
        prior = sorted(
            [iv for iv in ivs_by_app.get(app_id, []) if iv.round_number < current_round],
            key=lambda x: x.round_number,
        )
        result[interview_id] = [
            {"round_number": iv.round_number, "interview_title": iv.title,
             "feedback": [_feedback_to_dict(f) for f in fb_by.get(iv.id, [])]}
            for iv in prior
        ]
    return result


async def _check_panelist_conflicts(
    db: AsyncSession,
    panelist_ids: list[uuid.UUID],
    scheduled_at,
    duration_mins: int,
    exclude_interview_id: Optional[uuid.UUID] = None,
) -> list[str]:
    """Return names of panelists who already have an overlapping scheduled interview."""
    from app.models.user import User

    if not panelist_ids:
        return []

    new_end = scheduled_at + timedelta(minutes=duration_mins or 60)
    stmt = (
        select(User.full_name)
        .join(InterviewPanelist, InterviewPanelist.user_id == User.id)
        .join(Interview, Interview.id == InterviewPanelist.interview_id)
        .where(
            InterviewPanelist.user_id.in_(panelist_ids),
            Interview.status.in_(["scheduled", "rescheduled"]),
            Interview.scheduled_at < new_end,
            Interview.scheduled_at + func.make_interval(
                0, 0, 0, 0, 0, func.coalesce(Interview.duration_mins, 60)
            ) > scheduled_at,
        )
    )
    if exclude_interview_id:
        stmt = stmt.where(Interview.id != exclude_interview_id)

    rows = (await db.execute(stmt)).all()
    return [row[0] for row in rows]


async def _panelist_conflict_ids(
    db: AsyncSession,
    panelist_ids: list[uuid.UUID],
    scheduled_at,
    duration_mins: int,
    exclude_interview_id: Optional[uuid.UUID] = None,
) -> list[uuid.UUID]:
    """Same overlap check as _check_panelist_conflicts but returns user_ids —
    used by check_panelist_availability to flag which specific panelists conflict."""
    if not panelist_ids:
        return []

    new_end = scheduled_at + timedelta(minutes=duration_mins or 60)
    stmt = (
        select(InterviewPanelist.user_id)
        .join(Interview, Interview.id == InterviewPanelist.interview_id)
        .where(
            InterviewPanelist.user_id.in_(panelist_ids),
            Interview.status.in_(["scheduled", "rescheduled"]),
            Interview.scheduled_at < new_end,
            Interview.scheduled_at + func.make_interval(
                0, 0, 0, 0, 0, func.coalesce(Interview.duration_mins, 60)
            ) > scheduled_at,
        )
    )
    if exclude_interview_id:
        stmt = stmt.where(Interview.id != exclude_interview_id)

    rows = (await db.execute(stmt)).all()
    return [row[0] for row in rows]


_AVAILABILITY_LABELS = {
    "busy_internal": "Already interviewing another candidate at this time",
    "busy": "Busy on their Outlook calendar",
    "tentative": "Tentatively booked on their Outlook calendar",
    "oof": "Out of office",
    "free": "Available",
    "unknown": "Unable to check (Teams calendar integration not connected)",
}


async def check_panelist_availability(
    db: AsyncSession,
    panelist_ids: list[uuid.UUID],
    scheduled_at,
    duration_mins: int,
    exclude_interview_id: Optional[uuid.UUID] = None,
) -> list[dict]:
    """Per-panelist availability for the proposed slot — checks our own DB for
    double-booking against other interviews first (that's a hard conflict we know
    about for certain), then falls back to their real Outlook free/busy via Graph
    for anything we can't see (client calls, internal meetings, etc). Informational
    only — HR decides whether to proceed, this never blocks scheduling itself."""
    from app.models.user import User
    from app.services import ms_graph_service

    if not panelist_ids:
        return []

    users_by_id = {
        u.id: u for u in (await db.execute(
            select(User).where(User.id.in_(panelist_ids))
        )).scalars().all()
    }

    internal_conflict_ids = set(
        await _panelist_conflict_ids(db, panelist_ids, scheduled_at, duration_mins, exclude_interview_id)
    )

    emails = [u.email for u in users_by_id.values()]
    graph_status: dict = {}
    if emails:
        try:
            end = scheduled_at + timedelta(minutes=duration_mins or 60)
            graph_status = await ms_graph_service.get_free_busy(emails[0], emails, scheduled_at, end)
        except Exception:
            graph_status = {}

    results = []
    for pid in panelist_ids:
        user = users_by_id.get(pid)
        if not user:
            continue
        status = "busy_internal" if pid in internal_conflict_ids else graph_status.get(user.email, "unknown")
        results.append({
            "user_id": pid,
            "full_name": user.full_name,
            "status": status,
            "label": _AVAILABILITY_LABELS.get(status, status),
        })
    return results


async def get_panelist_day_schedule(
    db: AsyncSession,
    panelist_ids: list[uuid.UUID],
    day_start,
    day_end,
) -> list[dict]:
    """Busy blocks for each panelist within [day_start, day_end) — for rendering a
    day timeline HR can eyeball before picking a time, rather than checking one slot
    at a time. Merges our own scheduled interviews (labeled "interview") with real
    Outlook busy/tentative/oof blocks from Graph."""
    from app.models.user import User
    from app.services import ms_graph_service

    if not panelist_ids:
        return []

    users_by_id = {
        u.id: u for u in (await db.execute(
            select(User).where(User.id.in_(panelist_ids))
        )).scalars().all()
    }

    internal_rows = (await db.execute(
        select(Interview, InterviewPanelist.user_id)
        .join(InterviewPanelist, InterviewPanelist.interview_id == Interview.id)
        .where(
            InterviewPanelist.user_id.in_(panelist_ids),
            Interview.status.in_(["scheduled", "rescheduled"]),
            Interview.scheduled_at < day_end,
            Interview.scheduled_at + func.make_interval(
                0, 0, 0, 0, 0, func.coalesce(Interview.duration_mins, 60)
            ) > day_start,
        )
    )).all()

    internal_blocks: dict = {}
    for interview, uid in internal_rows:
        end = interview.scheduled_at + timedelta(minutes=interview.duration_mins or 60)
        internal_blocks.setdefault(uid, []).append(
            {"start": interview.scheduled_at, "end": end, "status": "interview"}
        )

    emails = [u.email for u in users_by_id.values()]
    graph_blocks: dict = {}
    if emails:
        try:
            graph_blocks = await ms_graph_service.get_busy_blocks(emails[0], emails, day_start, day_end)
        except Exception:
            graph_blocks = {}

    results = []
    for pid in panelist_ids:
        user = users_by_id.get(pid)
        if not user:
            continue
        blocks = list(internal_blocks.get(pid, [])) + list(graph_blocks.get(user.email, []))
        blocks.sort(key=lambda b: b["start"])
        results.append({"user_id": pid, "full_name": user.full_name, "busy_blocks": blocks})
    return results


def _feedback_to_dict(f: InterviewFeedback) -> dict:
    from app.services.storage_service import refresh_url

    return {
        "id": f.id,
        "interview_id": f.interview_id,
        "submitted_by": f.submitted_by,
        "overall_rating": f.overall_rating,
        "recommendation": f.recommendation,
        "technical_score": f.technical_score,
        "communication_score": f.communication_score,
        "cultural_fit_score": f.cultural_fit_score,
        "problem_solving_score": f.problem_solving_score,
        "strengths": f.strengths,
        "weaknesses": f.weaknesses,
        "notes": f.notes,
        # Re-signed on every read, same reason as resume_url/file_url elsewhere —
        # the SAS token baked in at upload time only lasts 7 days.
        "attachment_url": refresh_url(f.attachment_url) if f.attachment_url else None,
        "attachment_name": f.attachment_name,
        "is_shared_with_candidate": f.is_shared_with_candidate,
        "created_at": f.created_at,
    }


def _panelist_to_dict(p: InterviewPanelist) -> dict:
    return {"interview_id": p.interview_id, "user_id": p.user_id, "role": p.role}


def _self_feedback_to_dict(sf: CandidateInterviewSelfFeedback) -> dict:
    return {
        "id": sf.id,
        "interview_id": sf.interview_id,
        "candidate_id": sf.candidate_id,
        "overall_score": sf.overall_score,
        "communication_score": sf.communication_score,
        "technical_confidence": sf.technical_confidence,
        "was_prepared": sf.was_prepared,
        "would_recommend": sf.would_recommend,
        "difficulty": sf.difficulty,
        "experience_rating": sf.experience_rating,
        "comments": sf.comments,
        "created_at": sf.created_at,
    }


def _interview_to_response(
    interview: Interview,
    panelists: list[InterviewPanelist],
    feedback: list[InterviewFeedback],
    candidate_name: Optional[str] = None,
    candidate_email: Optional[str] = None,
    job_id: Optional[uuid.UUID] = None,
    self_feedback: Optional[CandidateInterviewSelfFeedback] = None,
    previous_rounds_feedback: Optional[list] = None,
) -> InterviewResponse:
    d = {
        "id": interview.id,
        "application_id": interview.application_id,
        "round_number": interview.round_number,
        "title": interview.title,
        "interview_type": interview.interview_type,
        "scheduled_at": interview.scheduled_at,
        "duration_mins": interview.duration_mins,
        "meeting_link": interview.meeting_link,
        "location": interview.location,
        "status": interview.status,
        "notes": interview.notes,
        "created_by": interview.created_by,
        "created_at": interview.created_at,
        "updated_at": interview.updated_at,
        "panelists": [_panelist_to_dict(p) for p in panelists],
        "feedback": [_feedback_to_dict(f) for f in feedback],
        "candidate_name": candidate_name,
        "candidate_email": candidate_email,
        "job_id": job_id,
        "candidate_self_feedback": _self_feedback_to_dict(self_feedback) if self_feedback else None,
        "previous_rounds_feedback": previous_rounds_feedback or [],
    }
    return InterviewResponse.model_validate(d)


async def create_interview(
    db: AsyncSession,
    data: InterviewCreate,
    created_by: Optional[uuid.UUID] = None,
) -> InterviewResponse:
    if data.panelists:
        conflicts = await _check_panelist_conflicts(
            db, [p.user_id for p in data.panelists], data.scheduled_at, data.duration_mins
        )
        if conflicts:
            names = ", ".join(conflicts)
            raise HTTPException(409, f"Scheduling conflict: {names} already has an interview at this time slot")

    interview = Interview(
        application_id=data.application_id,
        round_number=data.round_number,
        title=data.title,
        interview_type=data.interview_type,
        scheduled_at=data.scheduled_at,
        duration_mins=data.duration_mins,
        meeting_link=data.meeting_link,
        location=data.location,
        notes=data.notes,
        created_by=created_by,
    )
    db.add(interview)
    await db.flush()

    panelists = []
    for p in data.panelists:
        panelist = InterviewPanelist(
            interview_id=interview.id, user_id=p.user_id, role=p.role
        )
        db.add(panelist)
        panelists.append(panelist)

    try:
        from app.models.notification import Notification
        from app.models.application import Application
        from app.models.user import User

        app = await db.get(Application, data.application_id)
        if app:
            candidate = await db.get(User, app.applicant_id)
            scheduled_str = data.scheduled_at.strftime("%A, %d %B %Y at %I:%M %p UTC") if data.scheduled_at else "TBD"

            if candidate:
                db.add(Notification(
                    user_id=candidate.id,
                    type="interview_scheduled",
                    title="Interview scheduled",
                    body=f"Your interview has been scheduled for {scheduled_str}.",
                    link="/portal/applications",
                ))

            for p in panelists:
                interviewer = await db.get(User, p.user_id)
                if interviewer:
                    db.add(Notification(
                        user_id=interviewer.id,
                        type="interview_assigned",
                        title="You've been assigned to an interview",
                        body=f"You are scheduled to interview {candidate.full_name if candidate else 'a candidate'} on {scheduled_str}.",
                        link="/hr/interviews",
                    ))
    except Exception:
        pass

    await db.commit()
    await db.refresh(interview)

    # Emails (including real ACS sends, which can take several seconds each) run
    # out-of-request via Celery — sending them inline here was why scheduling an
    # interview with panelists could take 10-20+ seconds before the API responded.
    # If HR didn't supply their own meeting_link, auto-create a Teams meeting
    # (also async — a Graph token fetch + event create is the same class of slow
    # external call). That task fires the scheduled-notification email itself once
    # it's done (or immediately, if Graph isn't configured), so only one path runs.
    try:
        if not interview.meeting_link and panelists:
            from app.tasks.calendar_tasks import create_teams_meeting_task
            create_teams_meeting_task.delay(str(interview.id))
        else:
            from app.tasks.email_tasks import send_interview_scheduled_notifications
            send_interview_scheduled_notifications.delay(str(interview.id))
    except Exception:
        pass

    return _interview_to_response(interview, panelists, [])


async def list_my_interviews(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    status: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    from app.models.application import Application
    from app.models.user import User

    base = (
        select(Interview, User.full_name, User.email, Application.job_id)
        .join(Application, Application.id == Interview.application_id)
        .join(User, User.id == Application.applicant_id)
        .join(InterviewPanelist, and_(
            InterviewPanelist.interview_id == Interview.id,
            InterviewPanelist.user_id == user_id,
        ))
    )

    filters = []
    if status:
        if status == 'scheduled':
            filters.append(Interview.status.in_(['scheduled', 'rescheduled']))
        else:
            filters.append(Interview.status == status)
    if date_from:
        filters.append(Interview.scheduled_at >= date_from)
    if date_to:
        filters.append(Interview.scheduled_at < date_to)
    if filters:
        base = base.where(and_(*filters))

    count_stmt = (
        select(func.count()).select_from(Interview)
        .join(Application, Application.id == Interview.application_id)
        .join(InterviewPanelist, and_(
            InterviewPanelist.interview_id == Interview.id,
            InterviewPanelist.user_id == user_id,
        ))
    )
    if filters:
        count_stmt = count_stmt.where(and_(*filters))
    total = (await db.execute(count_stmt)).scalar_one()

    offset = (page - 1) * limit
    rows = (await db.execute(
        base.order_by(Interview.scheduled_at.asc()).offset(offset).limit(limit)
    )).all()

    if not rows:
        return {"items": [], "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}

    interview_ids = [row[0].id for row in rows]
    all_panelists = (await db.execute(
        select(InterviewPanelist).where(InterviewPanelist.interview_id.in_(interview_ids))
    )).scalars().all()
    all_feedback = (await db.execute(
        select(InterviewFeedback).where(InterviewFeedback.interview_id.in_(interview_ids))
    )).scalars().all()

    panelists_by = {}
    for p in all_panelists:
        panelists_by.setdefault(p.interview_id, []).append(p)
    feedback_by = {}
    for f in all_feedback:
        feedback_by.setdefault(f.interview_id, []).append(f)

    prev_rounds_by = await _batch_previous_rounds(db, rows)

    items = []
    for interview, full_name, email, job_id in rows:
        items.append(_interview_to_response(
            interview,
            panelists_by.get(interview.id, []),
            feedback_by.get(interview.id, []),
            candidate_name=full_name,
            candidate_email=email,
            job_id=job_id,
            previous_rounds_feedback=prev_rounds_by.get(interview.id, []),
        ))

    return {"items": items, "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


async def list_interviews(
    db: AsyncSession,
    *,
    application_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    from app.models.application import Application
    from app.models.user import User

    base = (
        select(Interview, User.full_name, User.email, Application.job_id)
        .join(Application, Application.id == Interview.application_id)
        .join(User, User.id == Application.applicant_id)
    )

    filters = []
    if application_id:
        filters.append(Interview.application_id == application_id)
    if status:
        if status == 'scheduled':
            filters.append(Interview.status.in_(['scheduled', 'rescheduled']))
        else:
            filters.append(Interview.status == status)
    if date_from:
        filters.append(Interview.scheduled_at >= date_from)
    if date_to:
        filters.append(Interview.scheduled_at < date_to)

    if filters:
        base = base.where(and_(*filters))

    count_stmt = (
        select(func.count()).select_from(Interview)
        .join(Application, Application.id == Interview.application_id)
    )
    if filters:
        count_stmt = count_stmt.where(and_(*filters))
    total = (await db.execute(count_stmt)).scalar_one()

    offset = (page - 1) * limit
    rows = (await db.execute(
        base.order_by(Interview.scheduled_at.asc()).offset(offset).limit(limit)
    )).all()

    if not rows:
        return {"items": [], "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}

    interview_ids = [row[0].id for row in rows]

    # Batch-load panelists, feedback, and candidate self-feedback
    all_panelists = (await db.execute(
        select(InterviewPanelist).where(InterviewPanelist.interview_id.in_(interview_ids))
    )).scalars().all()
    all_feedback = (await db.execute(
        select(InterviewFeedback).where(InterviewFeedback.interview_id.in_(interview_ids))
    )).scalars().all()
    all_self_feedback = (await db.execute(
        select(CandidateInterviewSelfFeedback).where(CandidateInterviewSelfFeedback.interview_id.in_(interview_ids))
    )).scalars().all()

    panelists_by = {}
    for p in all_panelists:
        panelists_by.setdefault(p.interview_id, []).append(p)
    feedback_by = {}
    for f in all_feedback:
        feedback_by.setdefault(f.interview_id, []).append(f)
    self_feedback_by = {sf.interview_id: sf for sf in all_self_feedback}

    prev_rounds_by = await _batch_previous_rounds(db, rows)

    items = []
    for interview, full_name, email, job_id in rows:
        items.append(_interview_to_response(
            interview,
            panelists_by.get(interview.id, []),
            feedback_by.get(interview.id, []),
            candidate_name=full_name,
            candidate_email=email,
            job_id=job_id,
            self_feedback=self_feedback_by.get(interview.id),
            previous_rounds_feedback=prev_rounds_by.get(interview.id, []),
        ))

    return {"items": items, "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


async def get_interview(db: AsyncSession, interview_id: uuid.UUID) -> InterviewResponse:
    from app.models.application import Application
    from app.models.user import User

    row = (await db.execute(
        select(Interview, User.full_name, User.email, Application.job_id)
        .join(Application, Application.id == Interview.application_id)
        .join(User, User.id == Application.applicant_id)
        .where(Interview.id == interview_id)
    )).first()

    if not row:
        raise HTTPException(404, "Interview not found")

    interview, full_name, email, job_id = row

    panelists = (await db.execute(
        select(InterviewPanelist).where(InterviewPanelist.interview_id == interview_id)
    )).scalars().all()
    feedback = (await db.execute(
        select(InterviewFeedback).where(InterviewFeedback.interview_id == interview_id)
    )).scalars().all()

    prev_rounds = await _get_previous_rounds(db, interview.application_id, interview.round_number)
    return _interview_to_response(
        interview, list(panelists), list(feedback), full_name, email, job_id,
        previous_rounds_feedback=prev_rounds,
    )


async def update_interview(
    db: AsyncSession,
    interview_id: uuid.UUID,
    data: InterviewUpdate,
) -> InterviewResponse:
    interview = await db.get(Interview, interview_id)
    if not interview:
        raise HTTPException(404, "Interview not found")

    update_data = data.model_dump(exclude_unset=True)
    old_scheduled_at = interview.scheduled_at

    # Check panelist conflicts when time changes
    new_scheduled_at = update_data.get("scheduled_at", interview.scheduled_at)
    new_duration = update_data.get("duration_mins", interview.duration_mins)
    if "scheduled_at" in update_data and update_data["scheduled_at"] != old_scheduled_at:
        panelist_ids = [p.user_id for p in (await db.execute(
            select(InterviewPanelist).where(InterviewPanelist.interview_id == interview_id)
        )).scalars().all()]
        conflicts = await _check_panelist_conflicts(
            db, panelist_ids, new_scheduled_at, new_duration, exclude_interview_id=interview_id
        )
        if conflicts:
            names = ", ".join(conflicts)
            raise HTTPException(409, f"Scheduling conflict: {names} already has an interview at this time slot")

    for field, val in update_data.items():
        setattr(interview, field, val)

    await db.commit()
    await db.refresh(interview)

    is_rescheduled = (
        update_data.get("status") == "rescheduled"
        or ("scheduled_at" in update_data and update_data["scheduled_at"] != old_scheduled_at)
    )

    if is_rescheduled:
        try:
            from app.models.notification import Notification
            from app.models.application import Application
            from app.models.user import User

            app_obj = await db.get(Application, interview.application_id)
            if app_obj:
                candidate = await db.get(User, app_obj.applicant_id)
                scheduled_str = (
                    interview.scheduled_at.strftime("%A, %d %B %Y at %I:%M %p UTC")
                    if interview.scheduled_at else "TBD"
                )

                if candidate:
                    db.add(Notification(
                        user_id=candidate.id,
                        type="interview_rescheduled",
                        title="Interview rescheduled",
                        body=f"Your interview has been rescheduled to {scheduled_str}.",
                        link="/portal/applications",
                    ))

                panelists_res = (await db.execute(
                    select(InterviewPanelist).where(InterviewPanelist.interview_id == interview_id)
                )).scalars().all()

                for panel in panelists_res:
                    interviewer_user = await db.get(User, panel.user_id)
                    if interviewer_user:
                        db.add(Notification(
                            user_id=interviewer_user.id,
                            type="interview_rescheduled",
                            title="Interview rescheduled",
                            body=f"An interview you are paneling has been rescheduled to {scheduled_str}.",
                            link="/hr/interviews",
                        ))

                await db.commit()
        except Exception:
            pass

        try:
            if interview.ms_graph_event_id:
                from app.tasks.calendar_tasks import update_teams_meeting_task
                update_teams_meeting_task.delay(str(interview_id))
            else:
                from app.tasks.email_tasks import send_interview_rescheduled_notifications
                send_interview_rescheduled_notifications.delay(str(interview_id))
        except Exception:
            pass

    return await get_interview(db, interview_id)


async def cancel_interview(db: AsyncSession, interview_id: uuid.UUID) -> None:
    interview = await db.get(Interview, interview_id)
    if not interview:
        raise HTTPException(404, "Interview not found")

    scheduled_str = (
        interview.scheduled_at.strftime("%A, %d %B %Y at %I:%M %p UTC")
        if interview.scheduled_at else "TBD"
    )
    interview.status = "cancelled"
    await db.commit()

    # If this interview came from a published interviewer slot, cancelling it
    # returns that capacity to the pool rather than losing it permanently.
    from app.models.interview_slot import InterviewSlot
    slot = (await db.execute(
        select(InterviewSlot).where(InterviewSlot.interview_id == interview_id)
    )).scalar_one_or_none()
    if slot:
        slot.status = "open"
        slot.interview_id = None
        slot.booked_by_agency_id = None
        slot.booked_by_user_id = None
        await db.commit()

    try:
        from app.models.notification import Notification
        from app.models.application import Application
        from app.models.user import User

        app_obj = await db.get(Application, interview.application_id)
        if app_obj:
            candidate = await db.get(User, app_obj.applicant_id)

            if candidate:
                db.add(Notification(
                    user_id=candidate.id,
                    type="interview_cancelled",
                    title="Interview cancelled",
                    body=f"Your interview scheduled for {scheduled_str} has been cancelled.",
                    link="/portal/applications",
                ))

            panelists_res = (await db.execute(
                select(InterviewPanelist).where(InterviewPanelist.interview_id == interview_id)
            )).scalars().all()

            for panel in panelists_res:
                interviewer_user = await db.get(User, panel.user_id)
                if interviewer_user:
                    db.add(Notification(
                        user_id=interviewer_user.id,
                        type="interview_cancelled",
                        title="Interview cancelled",
                        body=f"An interview you were scheduled to conduct ({scheduled_str}) has been cancelled.",
                        link="/hr/interviews",
                    ))

            await db.commit()
    except Exception:
        pass

    try:
        if interview.ms_graph_event_id:
            from app.tasks.calendar_tasks import delete_teams_meeting_task
            delete_teams_meeting_task.delay(str(interview_id))
        else:
            from app.tasks.email_tasks import send_interview_cancelled_notifications
            send_interview_cancelled_notifications.delay(str(interview_id))
    except Exception:
        pass


async def send_feedback_request_emails(db: AsyncSession, interview: Interview) -> int:
    """Email each panelist a tokenized link to submit feedback without logging in.
    Called when an interview transitions to 'completed'. Returns emails sent."""
    import secrets
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email
    from app.config import settings

    app = await db.get(Application, interview.application_id)
    if not app:
        return 0
    job = await db.get(Job, app.job_id)
    candidate = await db.get(User, app.applicant_id)

    panelists = (await db.execute(
        select(InterviewPanelist).where(InterviewPanelist.interview_id == interview.id)
    )).scalars().all()

    submitted_by_ids = {
        row.submitted_by for row in (await db.execute(
            select(InterviewFeedback.submitted_by).where(
                InterviewFeedback.interview_id == interview.id
            )
        )).all()
    }

    sent = 0
    for panelist in panelists:
        if panelist.user_id in submitted_by_ids:
            continue
        interviewer = await db.get(User, panelist.user_id)
        if not interviewer:
            continue
        if not panelist.feedback_token:  # legacy rows created before tokens existed
            panelist.feedback_token = secrets.token_urlsafe(32)

        await send_email(
            to_email=interviewer.email,
            subject=f"Submit your interview feedback – {job.title if job else 'Interview'}",
            template_name="feedback_request",
            context={
                "full_name": interviewer.full_name,
                "candidate_name": candidate.full_name if candidate else "the candidate",
                "job_title": job.title if job else "the position",
                "interview_title": interview.title or f"Round {interview.round_number}",
                "feedback_url": f"{settings.FRONTEND_URL}/interviews/feedback/{panelist.feedback_token}",
            },
        )
        sent += 1

    if sent:
        await db.commit()
    return sent


async def complete_interview(db: AsyncSession, interview_id: uuid.UUID, notes: Optional[str] = None) -> InterviewResponse:
    interview = await db.get(Interview, interview_id)
    if not interview:
        raise HTTPException(404, "Interview not found")
    if interview.status in ("cancelled", "completed"):
        raise HTTPException(400, "Cannot complete a cancelled or already completed interview")
    interview.status = "completed"
    if notes:
        interview.notes = notes
    await db.commit()

    # Feedback-request emails (one real ACS send per panelist) run out-of-request
    # via Celery — this used to await send_feedback_request_emails() inline here,
    # the same class of bug fixed for interview/assessment scheduling.
    try:
        from app.tasks.email_tasks import send_feedback_request_emails_task
        send_feedback_request_emails_task.delay(str(interview_id))
    except Exception:
        pass

    return await get_interview(db, interview_id)


async def auto_complete_past_interviews(db: AsyncSession) -> int:
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import update, func as sa_func

    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Interview).where(
            Interview.status.in_(["scheduled", "rescheduled"]),
            Interview.scheduled_at + func.make_interval(
                0, 0, 0, 0, 0, func.coalesce(Interview.duration_mins, 60)
            ) < now,
        )
    )
    interviews = result.scalars().all()

    count = 0
    completed: list[Interview] = []
    for interview in interviews:
        duration = interview.duration_mins or 60
        end_time = interview.scheduled_at + timedelta(minutes=duration)
        if end_time < now:
            interview.status = "completed"
            completed.append(interview)
            count += 1

    if count:
        await db.commit()

    for interview in completed:
        try:
            await send_feedback_request_emails(db, interview)
        except Exception:
            pass

    return count


async def _get_panelist_by_token(db: AsyncSession, token: str) -> tuple[InterviewPanelist, Interview]:
    panelist = (await db.execute(
        select(InterviewPanelist).where(InterviewPanelist.feedback_token == token)
    )).scalar_one_or_none()
    if not panelist:
        raise HTTPException(404, "Invalid or expired feedback link")
    interview = await db.get(Interview, panelist.interview_id)
    if not interview or interview.status == "cancelled":
        raise HTTPException(404, "Invalid or expired feedback link")
    return panelist, interview


async def get_feedback_context_by_token(db: AsyncSession, token: str) -> dict:
    """Context for the public (no-login) feedback page, plus any existing feedback to prefill."""
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job

    panelist, interview = await _get_panelist_by_token(db, token)

    app = await db.get(Application, interview.application_id)
    job = await db.get(Job, app.job_id) if app else None
    candidate = await db.get(User, app.applicant_id) if app else None
    interviewer = await db.get(User, panelist.user_id)

    existing = (await db.execute(
        select(InterviewFeedback).where(
            InterviewFeedback.interview_id == interview.id,
            InterviewFeedback.submitted_by == panelist.user_id,
        )
    )).scalar_one_or_none()

    return {
        "interview_id": str(interview.id),
        "interview_title": interview.title or f"Round {interview.round_number}",
        "round_number": interview.round_number,
        "interview_type": interview.interview_type,
        "scheduled_at": interview.scheduled_at,
        "status": interview.status,
        "candidate_name": candidate.full_name if candidate else None,
        "job_title": job.title if job else None,
        "interviewer_name": interviewer.full_name if interviewer else None,
        "existing_feedback": _feedback_to_dict(existing) if existing else None,
    }


async def submit_feedback_by_token(
    db: AsyncSession,
    token: str,
    data: InterviewFeedbackCreate,
) -> InterviewFeedback:
    panelist, interview = await _get_panelist_by_token(db, token)
    return await submit_feedback(db, interview.id, data, submitted_by=panelist.user_id)


async def submit_feedback(
    db: AsyncSession,
    interview_id: uuid.UUID,
    data: InterviewFeedbackCreate,
    submitted_by: uuid.UUID,
) -> InterviewFeedback:
    if not await db.get(Interview, interview_id):
        raise HTTPException(404, "Interview not found")

    existing = (await db.execute(
        select(InterviewFeedback).where(
            InterviewFeedback.interview_id == interview_id,
            InterviewFeedback.submitted_by == submitted_by,
        )
    )).scalar_one_or_none()

    if existing:
        for field, val in data.model_dump(exclude_unset=True).items():
            setattr(existing, field, val)
        await db.commit()
        await db.refresh(existing)
        return existing

    feedback = InterviewFeedback(
        interview_id=interview_id,
        submitted_by=submitted_by,
        **data.model_dump(),
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)
    return feedback


async def upload_feedback_attachment(db: AsyncSession, interview_id: uuid.UUID, file) -> dict:
    """Store an optional supporting file for interview feedback (e.g. a written
    test, marked-up code, a scorecard) and hand back its URL — uploaded first,
    same "upload then reference the URL" pattern as resume_url, so the feedback
    submit endpoints stay plain JSON."""
    from app.services import storage_service

    if not await db.get(Interview, interview_id):
        raise HTTPException(404, "Interview not found")

    url = await storage_service.upload_document(file, folder=f"feedback/{interview_id}", document_type="attachment")
    return {"url": url, "name": getattr(file, "filename", None)}


async def upload_feedback_attachment_by_token(db: AsyncSession, token: str, file) -> dict:
    """Same as upload_feedback_attachment, but for the public no-login feedback
    page — authorized by knowledge of the panelist's feedback_token instead of
    a logged-in user, matching how the rest of that flow is scoped."""
    from app.services import storage_service

    _panelist, interview = await _get_panelist_by_token(db, token)
    url = await storage_service.upload_document(file, folder=f"feedback/{interview.id}", document_type="attachment")
    return {"url": url, "name": getattr(file, "filename", None)}


async def get_feedback(
    db: AsyncSession, interview_id: uuid.UUID
) -> list[InterviewFeedback]:
    rows = (await db.execute(
        select(InterviewFeedback).where(InterviewFeedback.interview_id == interview_id)
    )).scalars().all()
    return list(rows)


async def submit_self_feedback(
    db: AsyncSession,
    interview_id: uuid.UUID,
    data: CandidateSelfFeedbackCreate,
    candidate_id: uuid.UUID,
) -> CandidateInterviewSelfFeedback:
    interview = await db.get(Interview, interview_id)
    if not interview:
        raise HTTPException(404, "Interview not found")

    from app.models.application import Application
    app = await db.get(Application, interview.application_id)
    if not app or app.applicant_id != candidate_id:
        raise HTTPException(403, "Not your interview")

    existing = (await db.execute(
        select(CandidateInterviewSelfFeedback).where(
            CandidateInterviewSelfFeedback.interview_id == interview_id
        )
    )).scalar_one_or_none()

    if existing:
        for field, val in data.model_dump(exclude_unset=True).items():
            setattr(existing, field, val)
        await db.commit()
        await db.refresh(existing)
        return existing

    row = CandidateInterviewSelfFeedback(
        interview_id=interview_id,
        candidate_id=candidate_id,
        **data.model_dump(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def get_self_feedback(
    db: AsyncSession,
    interview_id: uuid.UUID,
    candidate_id: uuid.UUID,
) -> CandidateInterviewSelfFeedback | None:
    interview = await db.get(Interview, interview_id)
    if not interview:
        raise HTTPException(404, "Interview not found")

    from app.models.application import Application
    app = await db.get(Application, interview.application_id)
    if not app or app.applicant_id != candidate_id:
        raise HTTPException(403, "Not your interview")

    return (await db.execute(
        select(CandidateInterviewSelfFeedback).where(
            CandidateInterviewSelfFeedback.interview_id == interview_id
        )
    )).scalar_one_or_none()


async def list_candidate_interviews(
    db: AsyncSession,
    application_id: Optional[uuid.UUID],
    candidate_id: uuid.UUID,
    interview_id: Optional[uuid.UUID] = None,
) -> list[dict]:
    from app.models.application import Application

    if application_id is not None:
        app = await db.get(Application, application_id)
        if not app or app.applicant_id != candidate_id:
            raise HTTPException(403, "Not your application")

    if interview_id is not None:
        # Fetch a single interview and verify ownership
        iv = await db.get(Interview, interview_id)
        if not iv:
            return []
        app = await db.get(Application, iv.application_id)
        if not app or app.applicant_id != candidate_id:
            return []
        rows = [iv]
    else:
        rows = (await db.execute(
            select(Interview).where(
                Interview.application_id == application_id
            ).order_by(Interview.scheduled_at.asc())
        )).scalars().all()

    if not rows:
        return []

    interview_ids = [r.id for r in rows]
    self_feedbacks = (await db.execute(
        select(CandidateInterviewSelfFeedback).where(
            CandidateInterviewSelfFeedback.interview_id.in_(interview_ids)
        )
    )).scalars().all()
    submitted_ids = {sf.interview_id for sf in self_feedbacks}

    return [
        {
            "id": r.id,
            "application_id": r.application_id,
            "round_number": r.round_number,
            "title": r.title,
            "interview_type": r.interview_type,
            "scheduled_at": r.scheduled_at,
            "duration_mins": r.duration_mins,
            "status": r.status,
            "self_feedback_submitted": r.id in submitted_ids,
        }
        for r in rows
    ]
