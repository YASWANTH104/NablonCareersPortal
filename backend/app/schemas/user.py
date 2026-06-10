import uuid
from datetime import datetime
from pydantic import BaseModel, EmailStr
from typing import Optional


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: str
    department: Optional[str] = None
    employee_id: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool
    is_verified: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None


class UserInvite(BaseModel):
    email: EmailStr
    full_name: str
    role: str
    department: Optional[str] = None
    employee_id: Optional[str] = None
