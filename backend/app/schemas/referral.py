import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ReferralCreate(BaseModel):
    job_id: uuid.UUID
    candidate_name: str
    candidate_email: str
    candidate_phone: Optional[str] = None
    relationship: Optional[str] = None
    note: Optional[str] = None
    resume_url: Optional[str] = None


class ReferralStatusUpdate(BaseModel):
    status: str


class ReferralBonusUpdate(BaseModel):
    bonus_eligible: Optional[bool] = None
    bonus_paid: Optional[bool] = None
    bonus_amount: Optional[float] = None


class ReferralResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_id: uuid.UUID
    referred_by: uuid.UUID
    candidate_name: str
    candidate_email: str
    candidate_phone: Optional[str] = None
    relationship: Optional[str] = None
    note: Optional[str] = None
    resume_url: Optional[str] = None
    status: str
    bonus_eligible: bool
    bonus_paid: bool
    bonus_amount: Optional[float] = None
    invited_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    job_title: Optional[str] = None
    referrer_name: Optional[str] = None


class ReferralListResponse(BaseModel):
    items: list[ReferralResponse]
    total: int
    page: int
    limit: int
    pages: int
