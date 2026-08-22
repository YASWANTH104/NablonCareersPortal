import uuid
from datetime import datetime, date
from pydantic import BaseModel, EmailStr
from typing import Optional


class CandidateProfileBase(BaseModel):
    current_company: Optional[str] = None
    current_designation: Optional[str] = None
    total_experience: Optional[str] = None
    current_location: Optional[str] = None
    skills: Optional[str] = None
    education: Optional[str] = None


class CandidateProfileUpdate(CandidateProfileBase):
    pass


class CandidateProfileResponse(CandidateProfileBase):
    model_config = {"from_attributes": True}


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    # Plain str, NOT EmailStr — matching ApplicantBrief.email, which already
    # does this. EmailStr on the way OUT re-validates an address the database
    # has already accepted, and a single row pydantic dislikes then fails
    # serialization for the entire response: one user with a reserved-domain
    # address (e.g. anything @example.invalid, which email-validator rejects as
    # special-use) 500s GET /users for every admin, and 500s /auth/me for that
    # user, locking them out of the app completely. Addresses are validated
    # where they enter the system — UserInvite below, and the auth request
    # schemas — which is the only place validation can actually prevent bad data.
    email: str
    full_name: str
    role: str
    department: Optional[str] = None
    employee_id: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[date] = None
    avatar_url: Optional[str] = None
    is_active: bool
    is_verified: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    date_of_birth: Optional[date] = None


class UserInvite(BaseModel):
    email: EmailStr
    full_name: str
    role: str
    department: Optional[str] = None
    employee_id: Optional[str] = None
