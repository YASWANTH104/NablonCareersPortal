import uuid
import secrets
from datetime import datetime, timezone
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.offer import OfferLetter, OfferTemplate
from app.schemas.offer import (
    OfferTemplateCreate, OfferTemplateUpdate, OfferTemplateResponse,
    OfferLetterCreate, OfferLetterUpdate, OfferLetterResponse,
    OfferLetterListResponse, CandidateOfferResponse,
)


def _offer_to_dict(offer: OfferLetter) -> dict:
    return {
        "id": offer.id,
        "application_id": offer.application_id,
        "designation": offer.designation,
        "department_id": offer.department_id,
        "joining_date": offer.joining_date,
        "salary_ctc": float(offer.salary_ctc) if offer.salary_ctc is not None else None,
        "salary_currency": offer.salary_currency,
        "probation_months": offer.probation_months,
        "work_location": offer.work_location,
        "template_id": offer.template_id,
        "status": offer.status,
        "sent_at": offer.sent_at,
        "accepted_at": offer.accepted_at,
        "expires_at": offer.expires_at,
        "candidate_signature": offer.candidate_signature,
        "signed_at": offer.signed_at,
        "created_by": offer.created_by,
        "created_at": offer.created_at,
        "updated_at": offer.updated_at,
    }


def _render_template(body_html: str, variables: dict) -> str:
    result = body_html
    for key, value in variables.items():
        result = result.replace(f"{{{{{key}}}}}", str(value) if value else "")
    return result


def _build_variables(offer: OfferLetter, candidate_name: str, dept_name: Optional[str]) -> dict:
    return {
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


# ── Templates ────────────────────────────────────────────────────────────────

async def list_templates(db: AsyncSession) -> list[OfferTemplateResponse]:
    rows = (await db.execute(
        select(OfferTemplate).order_by(OfferTemplate.is_default.desc(), OfferTemplate.name)
    )).scalars().all()
    return [OfferTemplateResponse.model_validate(t) for t in rows]


async def create_template(
    db: AsyncSession,
    data: OfferTemplateCreate,
    created_by: uuid.UUID,
) -> OfferTemplateResponse:
    if data.is_default:
        # Unset all other defaults
        all_defaults = (await db.execute(
            select(OfferTemplate).where(OfferTemplate.is_default == True)
        )).scalars().all()
        for t in all_defaults:
            t.is_default = False

    template = OfferTemplate(created_by=created_by, **data.model_dump())
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return OfferTemplateResponse.model_validate(template)


async def update_template(
    db: AsyncSession,
    template_id: uuid.UUID,
    data: OfferTemplateUpdate,
) -> OfferTemplateResponse:
    template = await db.get(OfferTemplate, template_id)
    if not template:
        raise HTTPException(404, "Template not found")

    if data.is_default:
        all_defaults = (await db.execute(
            select(OfferTemplate).where(
                OfferTemplate.is_default == True,
                OfferTemplate.id != template_id,
            )
        )).scalars().all()
        for t in all_defaults:
            t.is_default = False

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(template, field, value)

    await db.commit()
    await db.refresh(template)
    return OfferTemplateResponse.model_validate(template)


async def delete_template(db: AsyncSession, template_id: uuid.UUID) -> None:
    template = await db.get(OfferTemplate, template_id)
    if not template:
        raise HTTPException(404, "Template not found")
    await db.delete(template)
    await db.commit()


# ── Offer Letters ─────────────────────────────────────────────────────────────

async def create_offer(
    db: AsyncSession,
    data: OfferLetterCreate,
    created_by: uuid.UUID,
) -> OfferLetterResponse:
    # One offer per application (UNIQUE constraint)
    existing = (await db.execute(
        select(OfferLetter).where(OfferLetter.application_id == data.application_id)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "An offer already exists for this application")

    offer = OfferLetter(created_by=created_by, **data.model_dump())
    db.add(offer)
    await db.commit()
    await db.refresh(offer)

    return await get_offer(db, offer.id)


async def list_offers(
    db: AsyncSession,
    *,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> OfferLetterListResponse:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job, Department

    base = (
        select(OfferLetter, User.full_name, User.email, Job.title, Department.name)
        .join(Application, Application.id == OfferLetter.application_id)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .outerjoin(Department, Department.id == OfferLetter.department_id)
    )

    count_base = (
        select(func.count())
        .select_from(OfferLetter)
        .join(Application, Application.id == OfferLetter.application_id)
    )

    if status:
        base = base.where(OfferLetter.status == status)
        count_base = count_base.where(OfferLetter.status == status)

    total = (await db.execute(count_base)).scalar_one()
    offset = (page - 1) * limit
    rows = (await db.execute(
        base.order_by(OfferLetter.created_at.desc()).offset(offset).limit(limit)
    )).all()

    items = []
    for offer, candidate_name, candidate_email, job_title, dept_name in rows:
        d = _offer_to_dict(offer)
        d["candidate_name"] = candidate_name
        d["candidate_email"] = candidate_email
        d["job_title"] = job_title
        d["department_name"] = dept_name
        items.append(OfferLetterResponse.model_validate(d))

    return OfferLetterListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=max(1, -(-total // limit)),
    )


async def get_offer(db: AsyncSession, offer_id: uuid.UUID) -> OfferLetterResponse:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job, Department

    row = (await db.execute(
        select(OfferLetter, User.full_name, User.email, Job.title, Department.name)
        .join(Application, Application.id == OfferLetter.application_id)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .outerjoin(Department, Department.id == OfferLetter.department_id)
        .where(OfferLetter.id == offer_id)
    )).first()

    if not row:
        raise HTTPException(404, "Offer not found")

    offer, candidate_name, candidate_email, job_title, dept_name = row
    d = _offer_to_dict(offer)
    d["candidate_name"] = candidate_name
    d["candidate_email"] = candidate_email
    d["job_title"] = job_title
    d["department_name"] = dept_name
    return OfferLetterResponse.model_validate(d)


async def get_offer_by_application(db: AsyncSession, application_id: uuid.UUID) -> Optional[OfferLetterResponse]:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job, Department

    row = (await db.execute(
        select(OfferLetter, User.full_name, User.email, Job.title, Department.name)
        .join(Application, Application.id == OfferLetter.application_id)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .outerjoin(Department, Department.id == OfferLetter.department_id)
        .where(OfferLetter.application_id == application_id)
    )).first()

    if not row:
        return None

    offer, candidate_name, candidate_email, job_title, dept_name = row
    d = _offer_to_dict(offer)
    d["candidate_name"] = candidate_name
    d["candidate_email"] = candidate_email
    d["job_title"] = job_title
    d["department_name"] = dept_name
    return OfferLetterResponse.model_validate(d)


async def update_offer(
    db: AsyncSession,
    offer_id: uuid.UUID,
    data: OfferLetterUpdate,
) -> OfferLetterResponse:
    offer = await db.get(OfferLetter, offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    if offer.status != "draft":
        raise HTTPException(400, f"Only draft offers can be edited (current status: {offer.status})")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(offer, field, value)

    offer.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_offer(db, offer_id)


async def send_offer(db: AsyncSession, offer_id: uuid.UUID) -> OfferLetterResponse:
    offer = await db.get(OfferLetter, offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    if offer.status != "draft":
        raise HTTPException(400, f"Only draft offers can be sent (current status: {offer.status})")

    from app.services.document_service import is_documents_complete
    if not await is_documents_complete(db, offer.application_id):
        raise HTTPException(
            400,
            "Cannot send offer letter — candidate has not submitted all required documents yet."
        )

    offer.candidate_token = secrets.token_urlsafe(32)
    offer.status = "sent"
    offer.sent_at = datetime.now(timezone.utc)
    offer.updated_at = datetime.now(timezone.utc)
    await db.commit()

    try:
        from app.tasks.email_tasks import send_offer_email
        send_offer_email.delay(str(offer_id))
    except Exception:
        pass

    return await get_offer(db, offer_id)


async def preview_offer(db: AsyncSession, offer_id: uuid.UUID) -> str:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Department

    row = (await db.execute(
        select(OfferLetter, OfferTemplate, User.full_name, Department.name)
        .join(Application, Application.id == OfferLetter.application_id)
        .join(User, User.id == Application.applicant_id)
        .outerjoin(OfferTemplate, OfferTemplate.id == OfferLetter.template_id)
        .outerjoin(Department, Department.id == OfferLetter.department_id)
        .where(OfferLetter.id == offer_id)
    )).first()

    if not row:
        raise HTTPException(404, "Offer not found")

    offer, template, candidate_name, dept_name = row
    if not template:
        return "<p style='color:#999;font-style:italic'>No template selected.</p>"

    variables = _build_variables(offer, candidate_name or "", dept_name)
    return _render_template(template.body_html, variables)


async def revoke_offer(db: AsyncSession, offer_id: uuid.UUID) -> OfferLetterResponse:
    offer = await db.get(OfferLetter, offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    if offer.status != "sent":
        raise HTTPException(400, f"Only sent offers can be revoked (current status: {offer.status})")

    offer.status = "revoked"
    offer.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_offer(db, offer_id)


def _build_offer_full_html(offer, template, candidate_name: str, dept_name: Optional[str]) -> str:
    body_html = "<p>No template content available.</p>"
    if template and template.body_html:
        variables = _build_variables(offer, candidate_name or "", dept_name)
        body_html = _render_template(template.body_html, variables)

    signature_block = ""
    if offer.candidate_signature:
        signed_label = (
            offer.signed_at.strftime("%d %B %Y") if offer.signed_at else "Signed"
        )
        signature_block = f"""
<div style="margin-top:48px;border-top:1px solid #e5e7eb;padding-top:24px;">
  <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">Candidate Signature</p>
  <img src="{offer.candidate_signature}"
       style="max-height:80px;border:1px solid #e5e7eb;border-radius:6px;padding:6px;background:#fff;" />
  <p style="font-size:11px;color:#9ca3af;margin-top:4px;">Signed on {signed_label}</p>
</div>"""

    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<style>"
        "body{font-family:Arial,sans-serif;font-size:14px;line-height:1.6;"
        "color:#111827;margin:0;padding:40px;max-width:860px;}"
        "h1,h2,h3{color:#111827;}"
        "table{width:100%;border-collapse:collapse;}"
        "td,th{padding:8px;border:1px solid #e5e7eb;}"
        "</style></head>"
        f"<body>{body_html}{signature_block}</body></html>"
    )


async def _fetch_offer_render_row(db: AsyncSession, offer_id: uuid.UUID):
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Department
    row = (await db.execute(
        select(OfferLetter, OfferTemplate, User.full_name, Department.name)
        .join(Application, Application.id == OfferLetter.application_id)
        .join(User, User.id == Application.applicant_id)
        .outerjoin(OfferTemplate, OfferTemplate.id == OfferLetter.template_id)
        .outerjoin(Department, Department.id == OfferLetter.department_id)
        .where(OfferLetter.id == offer_id)
    )).first()
    if not row:
        raise HTTPException(404, "Offer not found")
    return row


async def build_offer_html(db: AsyncSession, offer_id: uuid.UUID) -> str:
    offer, template, candidate_name, dept_name = await _fetch_offer_render_row(db, offer_id)
    return _build_offer_full_html(offer, template, candidate_name, dept_name)


async def build_offer_pdf(db: AsyncSession, offer_id: uuid.UUID) -> bytes:
    from weasyprint import HTML as WeasyprintHTML
    offer, template, candidate_name, dept_name = await _fetch_offer_render_row(db, offer_id)
    full_html = _build_offer_full_html(offer, template, candidate_name, dept_name)
    return WeasyprintHTML(string=full_html).write_pdf()


async def get_offer_for_applicant(
    db: AsyncSession,
    application_id: uuid.UUID,
    applicant_id: uuid.UUID,
) -> Optional[CandidateOfferResponse]:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job, Department

    app_row = (await db.execute(
        select(Application).where(
            Application.id == application_id,
            Application.applicant_id == applicant_id,
        )
    )).scalar_one_or_none()
    if not app_row:
        raise HTTPException(404, "Application not found")

    offer = (await db.execute(
        select(OfferLetter).where(OfferLetter.application_id == application_id)
    )).scalar_one_or_none()

    if not offer or offer.status not in ("sent", "accepted", "rejected", "expired", "revoked"):
        return None

    row = (await db.execute(
        select(Job.title, Department.name)
        .select_from(Application)
        .join(Job, Job.id == Application.job_id)
        .outerjoin(Department, Department.id == offer.department_id)
        .where(Application.id == application_id)
    )).first()

    body_html = None
    if offer.template_id:
        template = await db.get(OfferTemplate, offer.template_id)
        if template:
            user_name = (await db.execute(
                select(User.full_name).where(User.id == applicant_id)
            )).scalar_one_or_none() or "Candidate"
            variables = _build_variables(offer, user_name, row[1] if row else None)
            body_html = _render_template(template.body_html, variables)

    return CandidateOfferResponse(
        id=offer.id,
        application_id=offer.application_id,
        designation=offer.designation,
        department_name=row[1] if row else None,
        joining_date=offer.joining_date,
        salary_ctc=float(offer.salary_ctc) if offer.salary_ctc else None,
        salary_currency=offer.salary_currency,
        probation_months=offer.probation_months,
        work_location=offer.work_location,
        status=offer.status,
        sent_at=offer.sent_at,
        accepted_at=offer.accepted_at,
        expires_at=offer.expires_at,
        candidate_signature=offer.candidate_signature,
        signed_at=offer.signed_at,
        body_html=body_html,
        job_title=row[0] if row else None,
    )


async def respond_offer_for_applicant(
    db: AsyncSession,
    application_id: uuid.UUID,
    applicant_id: uuid.UUID,
    decision: str,
    candidate_signature: Optional[str] = None,
) -> CandidateOfferResponse:
    from app.models.application import Application

    app_row = (await db.execute(
        select(Application).where(
            Application.id == application_id,
            Application.applicant_id == applicant_id,
        )
    )).scalar_one_or_none()
    if not app_row:
        raise HTTPException(404, "Application not found")

    offer = (await db.execute(
        select(OfferLetter).where(OfferLetter.application_id == application_id)
    )).scalar_one_or_none()

    if not offer:
        raise HTTPException(404, "No offer found for this application")
    if offer.status != "sent":
        raise HTTPException(400, f"This offer is already {offer.status}")
    if decision not in ("accepted", "rejected"):
        raise HTTPException(422, "Decision must be 'accepted' or 'rejected'")

    if offer.expires_at and offer.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        offer.status = "expired"
        await db.commit()
        raise HTTPException(400, "This offer has expired")

    if decision == "accepted" and not candidate_signature:
        raise HTTPException(422, "A digital signature is required to accept the offer")

    offer.status = decision
    offer.accepted_at = datetime.now(timezone.utc)
    if decision == "accepted":
        offer.candidate_signature = candidate_signature
        offer.signed_at = datetime.now(timezone.utc)
    offer.updated_at = datetime.now(timezone.utc)
    await db.commit()

    return await get_offer_for_applicant(db, application_id, applicant_id)


async def respond_offer(
    db: AsyncSession,
    token: str,
    decision: str,
    candidate_signature: Optional[str] = None,
) -> OfferLetterResponse:
    offer = (await db.execute(
        select(OfferLetter).where(OfferLetter.candidate_token == token)
    )).scalar_one_or_none()

    if not offer:
        raise HTTPException(404, "Invalid or expired link")
    if offer.status != "sent":
        raise HTTPException(400, f"This offer is already {offer.status}")
    if decision not in ("accepted", "rejected"):
        raise HTTPException(422, "Decision must be 'accepted' or 'rejected'")

    if offer.expires_at and offer.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        offer.status = "expired"
        await db.commit()
        raise HTTPException(400, "This offer has expired")

    if decision == "accepted" and not candidate_signature:
        raise HTTPException(422, "A digital signature is required to accept the offer")

    offer.status = decision
    offer.accepted_at = datetime.now(timezone.utc)
    if decision == "accepted":
        offer.candidate_signature = candidate_signature
        offer.signed_at = datetime.now(timezone.utc)
    offer.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_offer(db, offer.id)
