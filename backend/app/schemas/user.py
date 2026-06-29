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
    email: EmailStr
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
