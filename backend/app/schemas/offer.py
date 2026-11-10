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
    letter_date: Optional[date] = None
    end_date: Optional[date] = None
    reporting_manager: Optional[str] = None
    candidate_address: Optional[str] = None
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
    letter_date: Optional[date] = None
    end_date: Optional[date] = None
    reporting_manager: Optional[str] = None
    candidate_address: Optional[str] = None
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
    letter_date: Optional[date] = None
    end_date: Optional[date] = None
    reporting_manager: Optional[str] = None
    candidate_address: Optional[str] = None
    template_id: Optional[uuid.UUID] = None
    status: str
    sent_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    director_signature: Optional[str] = None
    director_approved_at: Optional[datetime] = None
    candidate_signature: Optional[str] = None
    signed_at: Optional[datetime] = None
    esign_completed_at: Optional[datetime] = None
    # Accepted and signed, by either flow — what the Hired stage gate checks
    is_signed: bool = False
    created_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

    # Enriched via JOINs — not on ORM object, so Optional
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    job_title: Optional[str] = None
    department_name: Optional[str] = None
    # Live Zoho Sign envelope: {status, signed_count, total_signers, waiting_on, request_id}
    esign: Optional[dict] = None


class OfferLetterListResponse(BaseModel):
    items: list[OfferLetterResponse]
    total: int
    page: int
    limit: int
    pages: int


class OfferRespondRequest(BaseModel):
    decision: str  # accepted | rejected
    candidate_signature: Optional[str] = None  # base64 data-URL


class DirectorOfferResponse(BaseModel):
    """Offer summary shown to the director on the public approval link — no internal tokens exposed."""
    designation: str
    department_name: Optional[str] = None
    candidate_name: Optional[str] = None
    job_title: Optional[str] = None
    joining_date: Optional[date] = None
    salary_ctc: Optional[float] = None
    salary_currency: str
    work_location: Optional[str] = None
    status: str
    body_html: Optional[str] = None


class DirectorDecisionRequest(BaseModel):
    decision: str  # approved | rejected
    signature: Optional[str] = None  # base64 data-URL, drawn or uploaded


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
    is_signed: bool = False
    # Zoho Sign progress from the candidate's side: {status, email, my_order,
    # my_status, total_signers, waiting_on, signed_pdf_available}
    esign: Optional[dict] = None
