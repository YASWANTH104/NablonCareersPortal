import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class DocumentFileResponse(BaseModel):
    id: uuid.UUID
    application_id: uuid.UUID
    request_id: uuid.UUID
    document_type: str
    label: str
    file_url: str
    file_name: str
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class DocumentRequestResponse(BaseModel):
    id: uuid.UUID
    application_id: uuid.UUID
    token: str
    status: str
    email_sent_at: Optional[datetime]
    expires_at: datetime
    created_at: datetime
    documents: list[DocumentFileResponse] = []
    required_types: list[dict] = []

    model_config = {"from_attributes": True}


class PublicDocumentRequestResponse(BaseModel):
    id: uuid.UUID
    status: str
    expires_at: datetime
    required_types: list[dict]
    submitted_types: list[str]
    candidate_name: str
    job_title: str
