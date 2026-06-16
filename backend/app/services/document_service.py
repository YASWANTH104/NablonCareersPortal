import uuid
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.document import DocumentRequest, ApplicationDocument, REQUIRED_DOCUMENT_TYPES
from app.schemas.document import DocumentRequestResponse, PublicDocumentRequestResponse


def _request_to_dict(req: DocumentRequest) -> dict:
    submitted = {d.document_type for d in req.documents}
    return {
        "id": req.id,
        "application_id": req.application_id,
        "token": req.token,
        "status": req.status,
        "email_sent_at": req.email_sent_at,
        "expires_at": req.expires_at,
        "created_at": req.created_at,
        "documents": [
            {
                "id": d.id,
                "application_id": d.application_id,
                "request_id": d.request_id,
                "document_type": d.document_type,
                "label": d.label,
                "file_url": d.file_url,
                "file_name": d.file_name,
                "uploaded_at": d.uploaded_at,
            }
            for d in req.documents
        ],
        "required_types": REQUIRED_DOCUMENT_TYPES,
    }


async def get_or_create_request(db: AsyncSession, application_id: uuid.UUID) -> DocumentRequest:
    existing = (await db.execute(
        select(DocumentRequest).where(DocumentRequest.application_id == application_id)
    )).scalar_one_or_none()

    if existing:
        return existing

    req = DocumentRequest(
        application_id=application_id,
        token=secrets.token_urlsafe(32),
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


async def get_request_for_application(
    db: AsyncSession, application_id: uuid.UUID
) -> Optional[DocumentRequestResponse]:
    req = (await db.execute(
        select(DocumentRequest)
        .options(selectinload(DocumentRequest.documents))
        .where(DocumentRequest.application_id == application_id)
    )).scalar_one_or_none()

    if not req:
        return None

    d = _request_to_dict(req)
    return DocumentRequestResponse.model_validate(d)


async def get_request_by_token(
    db: AsyncSession, token: str
) -> tuple[DocumentRequest, list[ApplicationDocument]]:
    req = (await db.execute(
        select(DocumentRequest)
        .options(selectinload(DocumentRequest.documents))
        .where(DocumentRequest.token == token)
    )).scalar_one_or_none()

    if not req:
        raise HTTPException(404, "Invalid or expired link")

    now = datetime.now(timezone.utc)
    if req.expires_at.replace(tzinfo=timezone.utc) < now:
        raise HTTPException(400, "This document request has expired")

    docs = (await db.execute(
        select(ApplicationDocument).where(ApplicationDocument.request_id == req.id)
    )).scalars().all()

    return req, list(docs)


async def get_public_status(db: AsyncSession, token: str) -> PublicDocumentRequestResponse:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job

    req, docs = await get_request_by_token(db, token)

    row = (await db.execute(
        select(User.full_name, Job.title)
        .select_from(Application)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .where(Application.id == req.application_id)
    )).first()

    candidate_name = row[0] if row else "Candidate"
    job_title = row[1] if row else ""
    submitted_types = [d.document_type for d in docs]

    return PublicDocumentRequestResponse(
        id=req.id,
        status=req.status,
        expires_at=req.expires_at,
        required_types=REQUIRED_DOCUMENT_TYPES,
        submitted_types=submitted_types,
        candidate_name=candidate_name,
        job_title=job_title,
    )


async def save_uploaded_document(
    db: AsyncSession,
    token: str,
    document_type: str,
    file_url: str,
    file_name: str,
) -> ApplicationDocument:
    valid_types = {d["type"] for d in REQUIRED_DOCUMENT_TYPES}
    if document_type not in valid_types:
        raise HTTPException(400, f"Invalid document type: {document_type}")

    req, docs = await get_request_by_token(db, token)

    label_map = {d["type"]: d["label"] for d in REQUIRED_DOCUMENT_TYPES}

    # Replace existing upload of same type
    existing = next((d for d in docs if d.document_type == document_type), None)
    if existing:
        existing.file_url = file_url
        existing.file_name = file_name
        existing.uploaded_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(existing)
        doc = existing
    else:
        doc = ApplicationDocument(
            application_id=req.application_id,
            request_id=req.id,
            document_type=document_type,
            label=label_map[document_type],
            file_url=file_url,
            file_name=file_name,
        )
        db.add(doc)
        await db.commit()
        await db.refresh(doc)
        docs = [*docs, doc]

    # Check completion
    submitted_types = {d.document_type for d in docs}
    required_types = {d["type"] for d in REQUIRED_DOCUMENT_TYPES}
    if required_types.issubset(submitted_types):
        req.status = "complete"
        await db.commit()

    return doc


async def get_applicant_document_status(
    db: AsyncSession,
    application_id: uuid.UUID,
    applicant_id: uuid.UUID,
) -> PublicDocumentRequestResponse:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job

    app_row = (await db.execute(
        select(Application).where(
            Application.id == application_id,
            Application.applicant_id == applicant_id,
        )
    )).scalar_one_or_none()
    if not app_row:
        raise HTTPException(404, "Application not found")

    name_row = (await db.execute(
        select(User.full_name, Job.title)
        .select_from(Application)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .where(Application.id == application_id)
    )).first()
    candidate_name = name_row[0] if name_row else "Candidate"
    job_title = name_row[1] if name_row else ""

    req = (await db.execute(
        select(DocumentRequest).where(DocumentRequest.application_id == application_id)
    )).scalar_one_or_none()

    if not req:
        return PublicDocumentRequestResponse(
            id=application_id,
            status="pending",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            required_types=REQUIRED_DOCUMENT_TYPES,
            submitted_types=[],
            candidate_name=candidate_name,
            job_title=job_title,
        )

    docs = (await db.execute(
        select(ApplicationDocument).where(ApplicationDocument.request_id == req.id)
    )).scalars().all()

    return PublicDocumentRequestResponse(
        id=req.id,
        status=req.status,
        expires_at=req.expires_at,
        required_types=REQUIRED_DOCUMENT_TYPES,
        submitted_types=[d.document_type for d in docs],
        candidate_name=candidate_name,
        job_title=job_title,
    )


async def upload_document_for_applicant(
    db: AsyncSession,
    application_id: uuid.UUID,
    applicant_id: uuid.UUID,
    document_type: str,
    file_url: str,
    file_name: str,
) -> ApplicationDocument:
    from app.models.application import Application

    app_row = (await db.execute(
        select(Application).where(
            Application.id == application_id,
            Application.applicant_id == applicant_id,
        )
    )).scalar_one_or_none()
    if not app_row:
        raise HTTPException(404, "Application not found")

    valid_types = {d["type"] for d in REQUIRED_DOCUMENT_TYPES}
    if document_type not in valid_types:
        raise HTTPException(400, f"Invalid document type: {document_type}")

    req = await get_or_create_request(db, application_id)

    now = datetime.now(timezone.utc)
    if req.expires_at.replace(tzinfo=timezone.utc) < now:
        raise HTTPException(400, "Document submission period has expired")

    docs = (await db.execute(
        select(ApplicationDocument).where(ApplicationDocument.request_id == req.id)
    )).scalars().all()
    docs = list(docs)

    label_map = {d["type"]: d["label"] for d in REQUIRED_DOCUMENT_TYPES}

    existing = next((d for d in docs if d.document_type == document_type), None)
    if existing:
        existing.file_url = file_url
        existing.file_name = file_name
        existing.uploaded_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(existing)
        doc = existing
    else:
        doc = ApplicationDocument(
            application_id=req.application_id,
            request_id=req.id,
            document_type=document_type,
            label=label_map[document_type],
            file_url=file_url,
            file_name=file_name,
        )
        db.add(doc)
        await db.commit()
        await db.refresh(doc)
        docs = [*docs, doc]

    submitted_types = {d.document_type for d in docs}
    required_types = {d["type"] for d in REQUIRED_DOCUMENT_TYPES}
    if required_types.issubset(submitted_types):
        req.status = "complete"
        await db.commit()

    return doc


async def is_documents_complete(db: AsyncSession, application_id: uuid.UUID) -> bool:
    req = (await db.execute(
        select(DocumentRequest).where(DocumentRequest.application_id == application_id)
    )).scalar_one_or_none()

    if not req:
        return False

    return req.status == "complete"


async def send_document_request_email(db: AsyncSession, application_id: uuid.UUID) -> DocumentRequest:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job
    from app.services.email_service import send_email
    from app.config import settings

    req = await get_or_create_request(db, application_id)

    row = (await db.execute(
        select(User.full_name, User.email, Job.title)
        .select_from(Application)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .where(Application.id == application_id)
    )).first()

    if not row:
        raise HTTPException(404, "Application not found")

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
    return req
