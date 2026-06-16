import uuid
from typing import Optional
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


def _feedback_to_dict(f: InterviewFeedback) -> dict:
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
    }
    return InterviewResponse.model_validate(d)


async def create_interview(
    db: AsyncSession,
    data: InterviewCreate,
    created_by: uuid.UUID,
) -> InterviewResponse:
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
        from app.models.job import Job
        from app.services.email_service import send_email

        app = await db.get(Application, data.application_id)
        if app:
            candidate = await db.get(User, app.applicant_id)
            job = await db.get(Job, app.job_id)
            scheduled_str = data.scheduled_at.strftime("%A, %d %B %Y at %I:%M %p UTC") if data.scheduled_at else "TBD"
            job_title = job.title if job else "the position"
            email_ctx = {
                "job_title": job_title,
                "round_number": data.round_number,
                "title": data.title or f"Round {data.round_number}",
                "interview_type": data.interview_type,
                "scheduled_at": scheduled_str,
                "duration_mins": data.duration_mins,
                "meeting_link": data.meeting_link or "",
                "location": data.location or "",
            }

            if candidate:
                db.add(Notification(
                    user_id=candidate.id,
                    type="interview_scheduled",
                    title="Interview scheduled",
                    body=f"Your interview has been scheduled for {scheduled_str}.",
                    link="/portal/applications",
                ))
                await send_email(
                    to_email=candidate.email,
                    subject=f"Interview Scheduled – {job_title}",
                    template_name="interview_scheduled",
                    context={"full_name": candidate.full_name, "role": "candidate", **email_ctx},
                )

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
                    await send_email(
                        to_email=interviewer.email,
                        subject=f"Interview Assigned – {job_title}",
                        template_name="interview_scheduled",
                        context={
                            "full_name": interviewer.full_name,
                            "role": "interviewer",
                            "candidate_name": candidate.full_name if candidate else "",
                            **email_ctx,
                        },
                    )
    except Exception:
        pass

    await db.commit()
    await db.refresh(interview)

    return _interview_to_response(interview, panelists, [])


async def list_my_interviews(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    status: Optional[str] = None,
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

    items = []
    for interview, full_name, email, job_id in rows:
        items.append(_interview_to_response(
            interview,
            panelists_by.get(interview.id, []),
            feedback_by.get(interview.id, []),
            candidate_name=full_name,
            candidate_email=email,
            job_id=job_id,
        ))

    return {"items": items, "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


async def list_interviews(
    db: AsyncSession,
    *,
    application_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
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

    return _interview_to_response(interview, list(panelists), list(feedback), full_name, email, job_id)


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
            from app.models.job import Job
            from app.services.email_service import send_email

            app_obj = await db.get(Application, interview.application_id)
            if app_obj:
                candidate = await db.get(User, app_obj.applicant_id)
                job = await db.get(Job, app_obj.job_id)
                scheduled_str = (
                    interview.scheduled_at.strftime("%A, %d %B %Y at %I:%M %p UTC")
                    if interview.scheduled_at else "TBD"
                )
                email_ctx = {
                    "job_title": job.title if job else "the position",
                    "round_number": interview.round_number,
                    "title": interview.title or f"Round {interview.round_number}",
                    "interview_type": interview.interview_type,
                    "scheduled_at": scheduled_str,
                    "duration_mins": interview.duration_mins,
                    "meeting_link": interview.meeting_link or "",
                    "location": interview.location or "",
                }

                if candidate:
                    db.add(Notification(
                        user_id=candidate.id,
                        type="interview_rescheduled",
                        title="Interview rescheduled",
                        body=f"Your interview has been rescheduled to {scheduled_str}.",
                        link="/portal/applications",
                    ))
                    await send_email(
                        to_email=candidate.email,
                        subject=f"Interview Rescheduled – {job.title if job else 'Nablon AI'}",
                        template_name="interview_rescheduled",
                        context={"full_name": candidate.full_name, "role": "candidate", **email_ctx},
                    )

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
                        await send_email(
                            to_email=interviewer_user.email,
                            subject=f"Interview Rescheduled – {job.title if job else 'Nablon AI'}",
                            template_name="interview_rescheduled",
                            context={
                                "full_name": interviewer_user.full_name,
                                "role": "interviewer",
                                "candidate_name": candidate.full_name if candidate else "",
                                **email_ctx,
                            },
                        )

                await db.commit()
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

    try:
        from app.models.notification import Notification
        from app.models.application import Application
        from app.models.user import User
        from app.models.job import Job
        from app.services.email_service import send_email

        app_obj = await db.get(Application, interview.application_id)
        if app_obj:
            candidate = await db.get(User, app_obj.applicant_id)
            job = await db.get(Job, app_obj.job_id)
            email_ctx = {
                "job_title": job.title if job else "the position",
                "round_number": interview.round_number,
                "title": interview.title or f"Round {interview.round_number}",
                "interview_type": interview.interview_type,
                "scheduled_at": scheduled_str,
            }

            if candidate:
                db.add(Notification(
                    user_id=candidate.id,
                    type="interview_cancelled",
                    title="Interview cancelled",
                    body=f"Your interview scheduled for {scheduled_str} has been cancelled.",
                    link="/portal/applications",
                ))
                await send_email(
                    to_email=candidate.email,
                    subject=f"Interview Cancelled – {job.title if job else 'Nablon AI'}",
                    template_name="interview_cancelled",
                    context={"full_name": candidate.full_name, "role": "candidate", **email_ctx},
                )

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
                    await send_email(
                        to_email=interviewer_user.email,
                        subject=f"Interview Cancelled – {job.title if job else 'Nablon AI'}",
                        template_name="interview_cancelled",
                        context={"full_name": interviewer_user.full_name, "role": "interviewer", **email_ctx},
                    )

            await db.commit()
    except Exception:
        pass


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
    return await get_interview(db, interview_id)


async def auto_complete_past_interviews(db: AsyncSession) -> int:
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import update

    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Interview).where(
            Interview.status == "scheduled",
            Interview.scheduled_at + func.make_interval(0, 0, 0, 0, 0, Interview.duration_mins) < now,
        )
    )
    interviews = result.scalars().all()

    count = 0
    for interview in interviews:
        end_time = interview.scheduled_at + timedelta(minutes=interview.duration_mins)
        if end_time < now:
            interview.status = "completed"
            count += 1

    if count:
        await db.commit()
    return count


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
