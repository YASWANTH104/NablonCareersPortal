import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles, Role
from app.schemas.document import DocumentRequestResponse, PublicDocumentRequestResponse, DocumentFileResponse
from app.services import document_service, storage_service

router = APIRouter(tags=["documents"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


# ── HR routes ─────────────────────────────────────────────────────────────────

@router.get("/applications/{application_id}/documents", response_model=DocumentRequestResponse | None)
async def get_documents(
    application_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await document_service.get_request_for_application(db, application_id)


@router.post("/applications/{application_id}/documents/request", response_model=DocumentRequestResponse)
async def send_document_request(
    application_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    req = await document_service.send_document_request_email(db, application_id)
    result = await document_service.get_request_for_application(db, application_id)
    return result


# ── Public candidate routes ───────────────────────────────────────────────────

@router.get("/doc-requests/{token}", response_model=PublicDocumentRequestResponse)
async def get_document_request_status(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    return await document_service.get_public_status(db, token)


@router.post("/doc-requests/{token}/upload", response_model=DocumentFileResponse)
async def upload_document(
    token: str,
    document_type: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    file_url = await storage_service.upload_document(file, token, document_type)
    doc = await document_service.save_uploaded_document(
        db, token, document_type, file_url, file.filename or document_type
    )
    return DocumentFileResponse(
        id=doc.id,
        application_id=doc.application_id,
        request_id=doc.request_id,
        document_type=doc.document_type,
        label=doc.label,
        file_url=doc.file_url,
        file_name=doc.file_name,
        uploaded_at=doc.uploaded_at,
    )


# ── Applicant portal routes (authenticated) ───────────────────────────────────

@router.get("/applications/mine/{application_id}/documents", response_model=PublicDocumentRequestResponse)
async def get_my_documents(
    application_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await document_service.get_applicant_document_status(db, application_id, current_user.id)


@router.post("/applications/mine/{application_id}/documents/upload", response_model=DocumentFileResponse)
async def upload_my_document(
    application_id: uuid.UUID,
    document_type: str = Form(...),
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    file_url = await storage_service.upload_document(file, str(application_id), document_type)
    doc = await document_service.upload_document_for_applicant(
        db, application_id, current_user.id, document_type, file_url, file.filename or document_type
    )
    return DocumentFileResponse(
        id=doc.id,
        application_id=doc.application_id,
        request_id=doc.request_id,
        document_type=doc.document_type,
        label=doc.label,
        file_url=doc.file_url,
        file_name=doc.file_name,
        uploaded_at=doc.uploaded_at,
    )
