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
def send_interview_notification(self, interview_id: str):
    try:
        logger.info(f"Interview notification queued: {interview_id}")
    except Exception as exc:
        raise self.retry(exc=exc)


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
