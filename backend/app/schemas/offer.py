import uuid
from datetime import datetime, date
from pydantic import BaseModel
from typing import Optional


# ── Templates ────────────────────────────────────────────────────────────────

class OfferTemplateCreate(BaseModel):
    name: str
    body_html: str
    is_default: bool = False


class OfferTemplateUpdate(BaseModel):
    name: Optional[str] = None
    body_html: Optional[str] = None
    is_default: Optional[bool] = None


class OfferTemplateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    body_html: str
    is_default: bool
    created_by: Optional[uuid.UUID] = None
    created_at: datetime


# ── Offer Letters ─────────────────────────────────────────────────────────────

class OfferLetterCreate(BaseModel):
    application_id: uuid.UUID
    designation: str
    department_id: Optional[uuid.UUID] = None
    joining_date: Optional[date] = None
    salary_ctc: Optional[float] = None
    salary_currency: str = "INR"
    probation_months: int = 3
    work_location: Optional[str] = None
    template_id: Optional[uuid.UUID] = None
    expires_at: Optional[datetime] = None


class OfferLetterUpdate(BaseModel):
    designation: Optional[str] = None
    department_id: Optional[uuid.UUID] = None
    joining_date: Optional[date] = None
    salary_ctc: Optional[float] = None
    salary_currency: Optional[str] = None
    probation_months: Optional[int] = None
    work_location: Optional[str] = None
    template_id: Optional[uuid.UUID] = None
    expires_at: Optional[datetime] = None


class OfferLetterResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    application_id: uuid.UUID
    designation: str
    department_id: Optional[uuid.UUID] = None
    joining_date: Optional[date] = None
    salary_ctc: Optional[float] = None
    salary_currency: str
    probation_months: int
    work_location: Optional[str] = None
    template_id: Optional[uuid.UUID] = None
    status: str
    sent_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    candidate_signature: Optional[str] = None
    signed_at: Optional[datetime] = None
    created_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

    # Enriched via JOINs — not on ORM object, so Optional
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    job_title: Optional[str] = None
    department_name: Optional[str] = None


class OfferLetterListResponse(BaseModel):
    items: list[OfferLetterResponse]
    total: int
    page: int
    limit: int
    pages: int


class OfferRespondRequest(BaseModel):
    decision: str  # accepted | rejected
    candidate_signature: Optional[str] = None  # base64 data-URL


class CandidateOfferResponse(BaseModel):
    """Offer letter view for the authenticated candidate — no internal tokens exposed."""
    id: uuid.UUID
    application_id: uuid.UUID
    designation: str
    department_name: Optional[str] = None
    joining_date: Optional[date] = None
    salary_ctc: Optional[float] = None
    salary_currency: str
    probation_months: int
    work_location: Optional[str] = None
    status: str
    sent_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    candidate_signature: Optional[str] = None
    signed_at: Optional[datetime] = None
    body_html: Optional[str] = None
    job_title: Optional[str] = None
