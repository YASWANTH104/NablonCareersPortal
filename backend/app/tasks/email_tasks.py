from app.tasks.celery_app import celery_app
import asyncio
import uuid
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _task_session():
    """Fresh engine + session for each Celery task — avoids asyncpg fork-conflict."""
    from app.config import settings
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    eng = create_async_engine(settings.DATABASE_URL, pool_size=2, max_overflow=0)
    Session = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
    try:
        async with Session() as session:
            yield session
    finally:
        await eng.dispose()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_verification_email_task(self, to_email: str, full_name: str, token: str):
    try:
        asyncio.run(_send_verification_email_async(to_email, full_name, token))
    except Exception as exc:
        logger.error(f"Verification email failed: to={to_email}: {exc}")
        raise self.retry(exc=exc)


async def _send_verification_email_async(to_email: str, full_name: str, token: str):
    from app.services.email_service import send_verification_email
    await send_verification_email(to_email, full_name, token)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_password_reset_email_task(self, to_email: str, full_name: str, token: str):
    try:
        asyncio.run(_send_password_reset_email_async(to_email, full_name, token))
    except Exception as exc:
        logger.error(f"Password reset email failed: to={to_email}: {exc}")
        raise self.retry(exc=exc)


async def _send_password_reset_email_async(to_email: str, full_name: str, token: str):
    from app.services.email_service import send_password_reset_email
    await send_password_reset_email(to_email, full_name, token)


_ROLE_LABELS = {
    "super_admin": "Super Admin",
    "admin": "Admin",
    "hr_manager": "HR Manager",
    "interviewer": "Interviewer",
    "employee": "Employee",
    "applicant": "Applicant",
}


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_team_invite_email(self, user_id: str):
    """Sent when an admin invites a new team member from Settings → Team. The
    account is created with a random, never-communicated password, so this
    links straight to /reset-password with a token generated at invite time
    (7-day expiry) — the only way the invited person can ever get in."""
    try:
        asyncio.run(_send_team_invite_email_async(user_id))
    except Exception as exc:
        logger.error(f"Team invite email failed: user={user_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_team_invite_email_async(user_id: str):
    from app.models.user import User
    from app.services.email_service import send_team_invite_email as _send

    async with _task_session() as db:
        user = await db.get(User, uuid.UUID(user_id))
        if not user or not user.password_reset_token:
            return  # nothing to build a set-password link from

        await _send(
            to_email=user.email,
            full_name=user.full_name,
            role_label=_ROLE_LABELS.get(user.role, user.role),
            token=user.password_reset_token,
        )
        logger.info(f"Team invite email sent: user={user_id}, to={user.email}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_stage_update_email(self, application_id: str, new_stage: str, from_stage: str = None):
    try:
        asyncio.run(_send_stage_update_email_async(application_id, new_stage, from_stage))
    except Exception as exc:
        logger.error(f"Stage update email failed: app={application_id}, stage={new_stage}: {exc}")
        raise self.retry(exc=exc)


async def _send_stage_update_email_async(application_id: str, new_stage: str, from_stage: str):
    if new_stage != "rejected":
        logger.info(f"Stage update email skipped (non-rejection): app={application_id}, stage={new_stage}")
        return

    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.models.interview import Interview, InterviewFeedback, CandidateInterviewSelfFeedback
    from app.services.email_service import send_email
    from app.services.ai_rejection_service import generate_rejection_content
    from app.config import settings
    from sqlalchemy import select

    app_uuid = uuid.UUID(application_id)

    _ROUND_LABELS = {
        "screening": "Screening",
        "assessment": "Assessment",
        "tr1": "Technical Round 1",
        "tr2": "Technical Round 2",
        "hr": "HR Interview",
    }

    async with _task_session() as db:
        row = (await db.execute(
            select(Application, User.full_name, User.email, Job.title.label("job_title"))
            .join(User, User.id == Application.applicant_id)
            .join(Job, Job.id == Application.job_id)
            .where(Application.id == app_uuid)
        )).first()

        if not row:
            logger.warning(f"Application {application_id} not found for rejection email")
            return

        app, full_name, candidate_email, job_title = row
        rejection_reason = app.rejection_reason if hasattr(app, "rejection_reason") else None

        # Collect all interviews + all feedback across every round
        all_interviews = (await db.execute(
            select(Interview)
            .where(Interview.application_id == app_uuid)
            .order_by(Interview.scheduled_at.asc())
        )).scalars().all()

        raw_feedbacks = []
        feedback_url = None
        last_interview = None

        for interview in all_interviews:
            feedback_rows = (await db.execute(
                select(InterviewFeedback)
                .where(InterviewFeedback.interview_id == interview.id)
                .order_by(InterviewFeedback.created_at.asc())
            )).scalars().all()

            for fb in feedback_rows:
                raw_feedbacks.append({
                    "round_label": interview.title or _ROUND_LABELS.get(from_stage, f"Round {interview.round_number}"),
                    "overall_rating": fb.overall_rating,
                    "technical_score": fb.technical_score,
                    "communication_score": fb.communication_score,
                    "cultural_fit_score": fb.cultural_fit_score,
                    "problem_solving_score": fb.problem_solving_score,
                    "strengths": fb.strengths,
                    "weaknesses": fb.weaknesses,
                    "notes": fb.notes,
                    "recommendation": fb.recommendation,
                })
            last_interview = interview

        # Self-feedback URL — only if last interview and candidate hasn't submitted yet
        if last_interview:
            already_submitted = (await db.execute(
                select(CandidateInterviewSelfFeedback)
                .where(CandidateInterviewSelfFeedback.interview_id == last_interview.id)
            )).scalar_one_or_none()
            if not already_submitted:
                feedback_url = f"{settings.FRONTEND_URL}/portal/applications?feedback={last_interview.id}"

        # Generate AI-personalised content if feedbacks exist
        ai_content = None
        if raw_feedbacks:
            ai_content = await generate_rejection_content(
                candidate_name=full_name,
                job_title=job_title,
                from_stage=from_stage or "applied",
                feedbacks=raw_feedbacks,
            )

        _STAGE_SUBJECTS = {
            "applied":    "An update on your Nablon AI application",
            "screening":  "An update following your Nablon AI screening",
            "assessment": "An update on your Nablon AI assessment",
            "tr1":        "An update following your Technical Round 1 interview at Nablon AI",
            "tr2":        "An update following your Technical Round 2 interview at Nablon AI",
            "hr":         "An update following your HR interview at Nablon AI",
            "offer":      "An update regarding your Nablon AI offer",
        }
        subject = _STAGE_SUBJECTS.get(from_stage or "applied", f"An update on your application for {job_title}")

        await send_email(
            to_email=candidate_email,
            subject=subject,
            template_name="rejection_email",
            context={
                "full_name": full_name,
                "job_title": job_title,
                "from_stage": from_stage or "applied",
                "rejection_reason": rejection_reason,
                "ai_content": ai_content,
                "feedback_url": feedback_url,
                "portal_url": f"{settings.FRONTEND_URL}/portal/applications",
            },
        )

        logger.info(
            f"Rejection email sent: app={application_id}, from_stage={from_stage}, "
            f"to={candidate_email}, ai={'yes' if ai_content and ai_content.get('is_ai_generated') else 'no'}"
        )


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_application_received_email(self, application_id: str):
    try:
        asyncio.run(_send_application_received_async(application_id))
    except Exception as exc:
        logger.error(f"Application received email failed: app={application_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_application_received_async(application_id: str):
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email
    from app.config import settings
    from sqlalchemy import select

    app_uuid = uuid.UUID(application_id)

    async with _task_session() as db:
        row = (await db.execute(
            select(Application, User.full_name, User.email, Job.title.label("job_title"))
            .join(User, User.id == Application.applicant_id)
            .join(Job, Job.id == Application.job_id)
            .where(Application.id == app_uuid)
        )).first()

        if not row:
            return

        app, full_name, candidate_email, job_title = row

        await send_email(
            to_email=candidate_email,
            subject=f"We received your application – {job_title} at Nablon AI",
            template_name="application_received",
            context={
                "full_name": full_name,
                "job_title": job_title,
                "portal_url": f"{settings.FRONTEND_URL}/portal/applications",
            },
        )

        logger.info(f"Application received email sent: app={application_id}, to={candidate_email}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_sourced_application_welcome_email(self, application_id: str):
    """Sent instead of send_application_received_email when an agency or HR/TA
    submission creates a brand-new candidate account. The candidate has no
    password yet, so this links straight to /reset-password with a token
    generated at account-creation time (7-day expiry) rather than the generic
    'View My Applications' CTA, which would otherwise dead-end at a login
    screen they can't get past."""
    try:
        asyncio.run(_send_sourced_application_welcome_async(application_id))
    except Exception as exc:
        logger.error(f"Sourced application welcome email failed: app={application_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_sourced_application_welcome_async(application_id: str):
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email
    from app.config import settings
    from sqlalchemy import select

    app_uuid = uuid.UUID(application_id)

    async with _task_session() as db:
        row = (await db.execute(
            select(Application, User, Job.title.label("job_title"))
            .join(User, User.id == Application.applicant_id)
            .join(Job, Job.id == Application.job_id)
            .where(Application.id == app_uuid)
        )).first()

        if not row:
            return

        app, user, job_title = row
        if not user.password_reset_token:
            return  # nothing to build a set-password link from

        source_label = "one of our hiring partners" if app.source == "agency" else "our talent acquisition team"

        await send_email(
            to_email=user.email,
            subject=f"Your application for {job_title} at Nablon AI",
            template_name="sourced_application_welcome",
            context={
                "full_name": user.full_name,
                "job_title": job_title,
                "source_label": source_label,
                "reset_url": f"{settings.FRONTEND_URL}/reset-password?token={user.password_reset_token}",
            },
        )

        logger.info(f"Sourced application welcome email sent: app={application_id}, to={user.email}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_agency_stage_update_email(self, application_id: str, new_stage: str):
    try:
        asyncio.run(_send_agency_stage_update_email_async(application_id, new_stage))
    except Exception as exc:
        logger.error(f"Agency stage update email failed: app={application_id}, stage={new_stage}: {exc}")
        raise self.retry(exc=exc)


async def _send_agency_stage_update_email_async(application_id: str, new_stage: str):
    from app.models.application import Application
    from app.models.agency import Agency
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email
    from app.config import settings
    from sqlalchemy import select

    app_uuid = uuid.UUID(application_id)

    async with _task_session() as db:
        row = (await db.execute(
            select(Application, User.full_name, Job.title.label("job_title"))
            .join(User, User.id == Application.applicant_id)
            .join(Job, Job.id == Application.job_id)
            .where(Application.id == app_uuid)
        )).first()

        if not row:
            return

        app, candidate_name, job_title = row

        if not app.agency_id:
            return

        agency = await db.get(Agency, app.agency_id)
        if not agency:
            return

        _STAGE_LABELS = {
            "screening": "Screening",
            "assessment": "Assessment",
            "tr1": "Technical Round 1",
            "tr2": "Technical Round 2",
            "hr": "HR Interview",
            "offer": "Offer Extended",
            "hired": "Hired",
            "rejected": "Not Proceeding",
        }
        stage_label = _STAGE_LABELS.get(new_stage, new_stage.replace("_", " ").title())
        portal_url = f"{settings.FRONTEND_URL}/agency/{agency.portal_token}"

        await send_email(
            to_email=agency.contact_email,
            subject=f"Candidate update: {candidate_name} — {job_title}",
            template_name="agency_stage_update",
            context={
                "agency_name": agency.name,
                "candidate_name": candidate_name,
                "job_title": job_title,
                "stage_label": stage_label,
                "portal_url": portal_url,
            },
        )

        logger.info(f"Agency stage update email sent: app={application_id}, stage={new_stage}, to={agency.contact_email}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_document_request_email_task(self, application_id: str):
    try:
        asyncio.run(_send_document_request_email_async(application_id))
    except Exception as exc:
        logger.error(f"Document request email failed: app={application_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_document_request_email_async(application_id: str):
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.models.document import DocumentRequest, REQUIRED_DOCUMENT_TYPES
    from app.services.email_service import send_email
    from app.config import settings
    from sqlalchemy import select
    from datetime import datetime, timezone

    app_uuid = uuid.UUID(application_id)

    async with _task_session() as db:
        req = (await db.execute(
            select(DocumentRequest).where(DocumentRequest.application_id == app_uuid)
        )).scalar_one_or_none()

        if not req:
            logger.warning(f"Document request not found for app={application_id}")
            return

        row = (await db.execute(
            select(User.full_name, User.email, Job.title)
            .select_from(Application)
            .join(User, User.id == Application.applicant_id)
            .join(Job, Job.id == Application.job_id)
            .where(Application.id == app_uuid)
        )).first()

        if not row:
            return

        full_name, candidate_email, job_title = row
        upload_url = f"{settings.FRONTEND_URL}/portal/applications"

        await send_email(
            to_email=candidate_email,
            subject=f"Action required: Submit documents for your {job_title} offer at Nablon AI",
            template_name="document_request",
            context={
                "full_name": full_name,
                "job_title": job_title,
                "upload_url": upload_url,
                "required_documents": REQUIRED_DOCUMENT_TYPES,
                "expires_days": 30,
            },
        )

        req.email_sent_at = datetime.now(timezone.utc)
        await db.commit()
        logger.info(f"Document request email sent: app={application_id}, to={candidate_email}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_referral_invite_email_task(self, referral_id: str):
    try:
        asyncio.run(_send_referral_invite_email_async(referral_id))
    except Exception as exc:
        logger.error(f"Referral invite email failed: referral={referral_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_referral_invite_email_async(referral_id: str):
    from sqlalchemy import select
    from app.models.referral import Referral
    from app.models.job import Job
    from app.models.user import User
    from app.services.email_service import send_email
    from app.config import settings

    r_uuid = uuid.UUID(referral_id)

    async with _task_session() as db:
        row = (await db.execute(
            select(
                Referral,
                Job.title.label("job_title"),
                Job.slug.label("job_slug"),
                User.full_name.label("referrer_name"),
            )
            .join(Job, Referral.job_id == Job.id)
            .join(User, Referral.referred_by == User.id)
            .where(Referral.id == r_uuid)
        )).first()
        if not row:
            return
        referral, job_title, job_slug, referrer_name = row

        await send_email(
            to_email=referral.candidate_email,
            subject=f"You've been referred for a role at Nablon AI – {job_title}",
            template_name="referral_invite",
            context={
                "candidate_name": referral.candidate_name,
                "referrer_name": referrer_name,
                "job_title": job_title,
                "apply_url": f"{settings.FRONTEND_URL}/jobs/{job_slug}/apply",
            },
        )

        logger.info(f"Referral invite email sent: referral={referral_id}, to={referral.candidate_email}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_feedback_request_emails_task(self, interview_id: str):
    try:
        asyncio.run(_send_feedback_request_emails_async(interview_id))
    except Exception as exc:
        logger.error(f"Feedback request emails failed: interview={interview_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_feedback_request_emails_async(interview_id: str):
    from app.models.interview import Interview
    from app.services.interview_service import send_feedback_request_emails

    async with _task_session() as db:
        interview = await db.get(Interview, uuid.UUID(interview_id))
        if not interview:
            return
        sent = await send_feedback_request_emails(db, interview)
        logger.info(f"Feedback request emails sent: interview={interview_id}, count={sent}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_assessment_scheduled_email(self, assessment_id: str):
    try:
        asyncio.run(_send_assessment_scheduled_async(assessment_id))
    except Exception as exc:
        logger.error(f"Assessment scheduled email failed: assessment={assessment_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_assessment_scheduled_async(assessment_id: str):
    from app.models.assessment import Assessment
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email

    a_uuid = uuid.UUID(assessment_id)

    async with _task_session() as db:
        assessment = await db.get(Assessment, a_uuid)
        if not assessment:
            return
        app = await db.get(Application, assessment.application_id)
        if not app:
            return
        candidate = await db.get(User, app.applicant_id)
        if not candidate:
            return
        job = await db.get(Job, app.job_id)

        job_title = job.title if job else "the position"
        deadline_str = (
            assessment.deadline.strftime("%B %d, %Y at %I:%M %p")
            if assessment.deadline else "TBD"
        )
        type_label = assessment.assessment_type.replace("_", " ").title()

        await send_email(
            to_email=candidate.email,
            subject=f"Assessment Assigned – {job_title}",
            template_name="assessment_scheduled",
            context={
                "full_name": candidate.full_name,
                "job_title": job_title,
                "assessment_title": assessment.title,
                "assessment_type": type_label,
                "deadline": deadline_str,
                "duration_mins": assessment.duration_mins,
                "platform_link": assessment.platform_link,
                "instructions": assessment.instructions,
            },
        )

        logger.info(f"Assessment scheduled email sent: assessment={assessment_id}, to={candidate.email}")


def _interview_scheduled_str(interview) -> str:
    return (
        interview.scheduled_at.strftime("%A, %d %B %Y at %I:%M %p UTC")
        if interview.scheduled_at else "TBD"
    )


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_interview_scheduled_notifications(self, interview_id: str):
    try:
        asyncio.run(_send_interview_scheduled_async(interview_id))
    except Exception as exc:
        logger.error(f"Interview scheduled email failed: interview={interview_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_interview_scheduled_async(interview_id: str):
    from sqlalchemy import select
    from app.models.interview import Interview, InterviewPanelist
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email

    iv_uuid = uuid.UUID(interview_id)

    async with _task_session() as db:
        interview = await db.get(Interview, iv_uuid)
        if not interview:
            return
        app = await db.get(Application, interview.application_id)
        if not app:
            return
        candidate = await db.get(User, app.applicant_id)
        job = await db.get(Job, app.job_id)

        job_title = job.title if job else "the position"
        email_ctx = {
            "job_title": job_title,
            "round_number": interview.round_number,
            "title": interview.title or f"Round {interview.round_number}",
            "interview_type": interview.interview_type,
            "scheduled_at": _interview_scheduled_str(interview),
            "duration_mins": interview.duration_mins,
            "meeting_link": interview.meeting_link or "",
            "location": interview.location or "",
        }

        if candidate:
            await send_email(
                to_email=candidate.email,
                subject=f"Interview Scheduled – {job_title}",
                template_name="interview_scheduled",
                context={"full_name": candidate.full_name, "role": "candidate", **email_ctx},
            )

        panelists = (await db.execute(
            select(InterviewPanelist).where(InterviewPanelist.interview_id == iv_uuid)
        )).scalars().all()
        for p in panelists:
            interviewer = await db.get(User, p.user_id)
            if interviewer:
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

        logger.info(f"Interview scheduled notifications sent: interview={interview_id}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_interview_rescheduled_notifications(self, interview_id: str):
    try:
        asyncio.run(_send_interview_rescheduled_async(interview_id))
    except Exception as exc:
        logger.error(f"Interview rescheduled email failed: interview={interview_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_interview_rescheduled_async(interview_id: str):
    from sqlalchemy import select
    from app.models.interview import Interview, InterviewPanelist
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email

    iv_uuid = uuid.UUID(interview_id)

    async with _task_session() as db:
        interview = await db.get(Interview, iv_uuid)
        if not interview:
            return
        app = await db.get(Application, interview.application_id)
        if not app:
            return
        candidate = await db.get(User, app.applicant_id)
        job = await db.get(Job, app.job_id)
        job_title = job.title if job else "Nablon AI"

        email_ctx = {
            "job_title": job.title if job else "the position",
            "round_number": interview.round_number,
            "title": interview.title or f"Round {interview.round_number}",
            "interview_type": interview.interview_type,
            "scheduled_at": _interview_scheduled_str(interview),
            "duration_mins": interview.duration_mins,
            "meeting_link": interview.meeting_link or "",
            "location": interview.location or "",
        }

        if candidate:
            await send_email(
                to_email=candidate.email,
                subject=f"Interview Rescheduled – {job_title}",
                template_name="interview_rescheduled",
                context={"full_name": candidate.full_name, "role": "candidate", **email_ctx},
            )

        panelists = (await db.execute(
            select(InterviewPanelist).where(InterviewPanelist.interview_id == iv_uuid)
        )).scalars().all()
        for p in panelists:
            interviewer = await db.get(User, p.user_id)
            if interviewer:
                await send_email(
                    to_email=interviewer.email,
                    subject=f"Interview Rescheduled – {job_title}",
                    template_name="interview_rescheduled",
                    context={
                        "full_name": interviewer.full_name,
                        "role": "interviewer",
                        "candidate_name": candidate.full_name if candidate else "",
                        **email_ctx,
                    },
                )

        logger.info(f"Interview rescheduled notifications sent: interview={interview_id}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_interview_cancelled_notifications(self, interview_id: str):
    try:
        asyncio.run(_send_interview_cancelled_async(interview_id))
    except Exception as exc:
        logger.error(f"Interview cancelled email failed: interview={interview_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_interview_cancelled_async(interview_id: str):
    from sqlalchemy import select
    from app.models.interview import Interview, InterviewPanelist
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email

    iv_uuid = uuid.UUID(interview_id)

    async with _task_session() as db:
        interview = await db.get(Interview, iv_uuid)
        if not interview:
            return
        app = await db.get(Application, interview.application_id)
        if not app:
            return
        candidate = await db.get(User, app.applicant_id)
        job = await db.get(Job, app.job_id)
        job_title = job.title if job else "Nablon AI"

        email_ctx = {
            "job_title": job.title if job else "the position",
            "round_number": interview.round_number,
            "title": interview.title or f"Round {interview.round_number}",
            "interview_type": interview.interview_type,
            "scheduled_at": _interview_scheduled_str(interview),
        }

        if candidate:
            await send_email(
                to_email=candidate.email,
                subject=f"Interview Cancelled – {job_title}",
                template_name="interview_cancelled",
                context={"full_name": candidate.full_name, "role": "candidate", **email_ctx},
            )

        panelists = (await db.execute(
            select(InterviewPanelist).where(InterviewPanelist.interview_id == iv_uuid)
        )).scalars().all()
        for p in panelists:
            interviewer = await db.get(User, p.user_id)
            if interviewer:
                await send_email(
                    to_email=interviewer.email,
                    subject=f"Interview Cancelled – {job_title}",
                    template_name="interview_cancelled",
                    context={"full_name": interviewer.full_name, "role": "interviewer", **email_ctx},
                )

        logger.info(f"Interview cancelled notifications sent: interview={interview_id}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_offer_email(self, offer_id: str):
    try:
        asyncio.run(_send_offer_email_async(offer_id))
    except Exception as exc:
        logger.error(f"Offer email failed: offer={offer_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_offer_email_async(offer_id: str):
    from app.models.offer import OfferLetter, OfferTemplate
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job, Department
    from app.services.email_service import send_email_with_attachment
    from app.config import settings
    from sqlalchemy import select
    import base64

    offer_uuid = uuid.UUID(offer_id)

    async with _task_session() as db:
        row = (await db.execute(
            select(OfferLetter, OfferTemplate, User.full_name, User.email,
                   Job.title.label("job_title"), Department.name.label("dept_name"))
            .join(Application, Application.id == OfferLetter.application_id)
            .join(User, User.id == Application.applicant_id)
            .join(Job, Job.id == Application.job_id)
            .outerjoin(OfferTemplate, OfferTemplate.id == OfferLetter.template_id)
            .outerjoin(Department, Department.id == OfferLetter.department_id)
            .where(OfferLetter.id == offer_uuid)
        )).first()

        if not row:
            logger.warning(f"Offer {offer_id} not found for email")
            return

        offer, template, candidate_name, candidate_email, job_title, dept_name = row

        pdf_bytes = None
        if template and template.body_html:
            try:
                from weasyprint import HTML as WeasyprintHTML
                variables = {
                    "candidate_name": candidate_name or "",
                    "designation": offer.designation or "",
                    "department": dept_name or "",
                    "salary_ctc": str(offer.salary_ctc) if offer.salary_ctc else "",
                    "salary_currency": offer.salary_currency or "",
                    "joining_date": str(offer.joining_date) if offer.joining_date else "",
                    "probation_months": str(offer.probation_months),
                    "work_location": offer.work_location or "",
                    "offer_expiry_date": str(offer.expires_at.date()) if offer.expires_at else "",
                    "company_name": "Nablon AI",
                }
                body_html = template.body_html
                for key, value in variables.items():
                    body_html = body_html.replace(f"{{{{{key}}}}}", value)

                full_html = (
                    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                    "<style>body{font-family:Arial,sans-serif;font-size:14px;"
                    "line-height:1.6;color:#111;margin:40px;}"
                    "@page{margin:40px;}</style></head>"
                    f"<body>{body_html}</body></html>"
                )
                pdf_bytes = WeasyprintHTML(string=full_html).write_pdf()
            except Exception as exc:
                logger.warning(f"PDF generation failed for offer {offer_id}, sending without: {exc}")

        attachments = []
        if pdf_bytes:
            attachments.append({
                "name": "offer_letter.pdf",
                "attachmentType": "pdf",
                "contentInBase64": base64.b64encode(pdf_bytes).decode("utf-8"),
            })

        portal_url = f"{settings.FRONTEND_URL}/portal/applications"
        await send_email_with_attachment(
            to_email=candidate_email,
            subject=f"Your Offer Letter – {offer.designation} at Nablon AI",
            template_name="offer_letter_email",
            context={
                "candidate_name": candidate_name or "",
                "designation": offer.designation or "",
                "department": dept_name or "",
                "salary_ctc": f"{float(offer.salary_ctc):,.0f}" if offer.salary_ctc else "",
                "salary_currency": offer.salary_currency or "INR",
                "joining_date": str(offer.joining_date) if offer.joining_date else "",
                "work_location": offer.work_location or "",
                "offer_expiry": str(offer.expires_at.date()) if offer.expires_at else "",
                "portal_url": portal_url,
            },
            attachments=attachments,
        )

        logger.info(
            f"Offer email sent: offer={offer_id}, to={candidate_email}, "
            f"pdf={'yes' if pdf_bytes else 'no'}"
        )


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_director_approval_email(self, offer_id: str):
    try:
        asyncio.run(_send_director_approval_email_async(offer_id))
    except Exception as exc:
        logger.error(f"Director approval email failed: offer={offer_id}: {exc}")
        raise self.retry(exc=exc)


async def _send_director_approval_email_async(offer_id: str):
    from app.models.offer import OfferLetter
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job, Department
    from app.services.email_service import send_email
    from app.config import settings
    from sqlalchemy import select

    offer_uuid = uuid.UUID(offer_id)

    async with _task_session() as db:
        row = (await db.execute(
            select(OfferLetter, User.full_name, Job.title.label("job_title"), Department.name.label("dept_name"))
            .join(Application, Application.id == OfferLetter.application_id)
            .join(User, User.id == Application.applicant_id)
            .join(Job, Job.id == Application.job_id)
            .outerjoin(Department, Department.id == OfferLetter.department_id)
            .where(OfferLetter.id == offer_uuid)
        )).first()

        if not row:
            logger.warning(f"Offer {offer_id} not found for director approval email")
            return

        offer, candidate_name, job_title, dept_name = row

        if not settings.DIRECTOR_EMAIL:
            logger.warning(f"DIRECTOR_EMAIL not configured — skipping director approval email for offer={offer_id}")
            return

        review_url = f"{settings.FRONTEND_URL}/offers/director-review/{offer.director_token}"

        await send_email(
            to_email=settings.DIRECTOR_EMAIL,
            subject=f"Offer approval needed: {candidate_name} — {job_title}",
            template_name="director_approval_request",
            context={
                "director_name": settings.DIRECTOR_NAME,
                "candidate_name": candidate_name or "",
                "designation": offer.designation or "",
                "department": dept_name or "",
                "salary_ctc": f"{float(offer.salary_ctc):,.0f}" if offer.salary_ctc else "",
                "salary_currency": offer.salary_currency or "INR",
                "joining_date": str(offer.joining_date) if offer.joining_date else "",
                "review_url": review_url,
            },
        )

        logger.info(f"Director approval email sent: offer={offer_id}, to={settings.DIRECTOR_EMAIL}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def notify_hr_offer_accepted(self, offer_id: str):
    try:
        asyncio.run(_notify_hr_offer_accepted_async(offer_id))
    except Exception as exc:
        logger.error(f"HR acceptance notification failed: offer={offer_id}: {exc}")
        raise self.retry(exc=exc)


async def _notify_hr_offer_accepted_async(offer_id: str):
    from app.models.offer import OfferLetter
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email
    from app.config import settings
    from sqlalchemy import select

    offer_uuid = uuid.UUID(offer_id)

    async with _task_session() as db:
        row = (await db.execute(
            select(OfferLetter, User.full_name, User.email, Job.title.label("job_title"))
            .join(Application, Application.id == OfferLetter.application_id)
            .join(User, User.id == Application.applicant_id)
            .join(Job, Job.id == Application.job_id)
            .where(OfferLetter.id == offer_uuid)
        )).first()

        if not row:
            logger.warning(f"Offer {offer_id} not found for HR acceptance notification")
            return

        offer, candidate_name, candidate_email, job_title = row
        signed_date = offer.signed_at.strftime("%d %B %Y") if offer.signed_at else "today"

        await send_email(
            to_email=settings.HR_NOTIFICATION_EMAIL,
            subject=f"Offer accepted: {candidate_name} — {job_title}",
            template_name="offer_accepted_notification",
            context={
                "candidate_name": candidate_name or "",
                "candidate_email": candidate_email or "",
                "job_title": job_title or "",
                "signed_date": signed_date,
                "portal_url": f"{settings.FRONTEND_URL}/hr/offers",
            },
        )

        logger.info(f"HR acceptance notification sent: offer={offer_id}, to={settings.HR_NOTIFICATION_EMAIL}")
