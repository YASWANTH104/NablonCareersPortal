import uuid
from datetime import datetime, date
from pydantic import BaseModel
from typing import Optional

EMPLOYMENT_TYPES = ("full_time", "intern", "contract", "part_time")
BILLING_STATUSES = ("billable", "non_billable", "bench", "training")
PROJECT_STATUSES = ("active", "on_hold", "completed")


# ── Employee profile ─────────────────────────────────────────────────────────

class EmployeeProfileCreate(BaseModel):
    user_id: uuid.UUID
    employee_code: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    employment_type: str = "full_time"
    billing_status: str = "non_billable"
    date_of_joining: Optional[date] = None
    total_experience_years: Optional[float] = None
    location: Optional[str] = None
    bio: Optional[str] = None
    skills: Optional[list[str]] = None


class EmployeeProfileUpdate(BaseModel):
    employee_code: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    employment_type: Optional[str] = None
    billing_status: Optional[str] = None
    date_of_joining: Optional[date] = None
    total_experience_years: Optional[float] = None
    location: Optional[str] = None
    bio: Optional[str] = None
    skills: Optional[list[str]] = None
    is_active: Optional[bool] = None


class AllocationSummary(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    project_name: str
    allocation_percent: int
    role_on_project: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class EmployeeProfileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    email: str
    avatar_url: Optional[str] = None
    role: str

    employee_code: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    employment_type: str
    billing_status: str
    date_of_joining: Optional[date] = None
    total_experience_years: Optional[float] = None
    location: Optional[str] = None
    bio: Optional[str] = None
    skills: Optional[list[str]] = None
    resume_url: Optional[str] = None
    resume_name: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    current_allocations: list[AllocationSummary] = []
    total_allocated_percent: int = 0


# ── Projects ─────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    client_name: Optional[str] = None
    description: Optional[str] = None
    status: str = "active"
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    client_name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class ProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    client_name: Optional[str] = None
    description: Optional[str] = None
    status: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    created_at: datetime
    updated_at: datetime
    headcount: int = 0


class RosterMember(BaseModel):
    allocation_id: uuid.UUID
    employee_profile_id: uuid.UUID
    full_name: str
    designation: Optional[str] = None
    allocation_percent: int
    role_on_project: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class ProjectDetailResponse(ProjectResponse):
    roster: list[RosterMember] = []


# ── Allocations ──────────────────────────────────────────────────────────────

class ProjectAllocationCreate(BaseModel):
    project_id: uuid.UUID
    allocation_percent: int = 100
    role_on_project: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notes: Optional[str] = None


class ProjectAllocationUpdate(BaseModel):
    allocation_percent: Optional[int] = None
    role_on_project: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notes: Optional[str] = None


class ProjectAllocationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    employee_profile_id: uuid.UUID
    project_id: uuid.UUID
    project_name: Optional[str] = None
    employee_name: Optional[str] = None
    allocation_percent: int
    role_on_project: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notes: Optional[str] = None
    created_at: datetime


# ── Onboarding (users not yet in the resourcing system) ─────────────────────

class OnboardableUser(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    role: str
    department: Optional[str] = None


# ── Stats ────────────────────────────────────────────────────────────────────

class ResourceStatsResponse(BaseModel):
    total: int
    billable: int
    non_billable: int
    bench: int
    training: int
    interns: int
    unallocated: int
    by_department: dict[str, int]
    by_employment_type: dict[str, int]


# ── Natural-language search ──────────────────────────────────────────────────

class ResourceSearchRequest(BaseModel):
    query: str


class ResourceSearchResponse(BaseModel):
    summary: str
    count: int
    interpreted_as: dict
    is_ai_interpreted: bool
    results: list[EmployeeProfileResponse]
