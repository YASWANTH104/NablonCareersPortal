import uuid
from datetime import datetime
from pydantic import BaseModel
from typing import Literal, Optional

Criticality = Literal["critical", "high", "medium", "low"]


class DepartmentCreate(BaseModel):
    name: str


class DepartmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    created_at: datetime


class JobQuestionCreate(BaseModel):
    question: str
    type: str = "text"
    options: Optional[dict] = None
    is_required: bool = False
    order_index: int = 0


class JobQuestionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_id: uuid.UUID
    question: str
    type: str
    options: Optional[dict] = None
    is_required: bool
    order_index: int


class JDGenerateRequest(BaseModel):
    title: str
    notes: str
    department: Optional[str] = None
    location: Optional[str] = None
    location_type: Optional[str] = None
    employment_type: Optional[str] = None
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None


class JDGenerateResponse(BaseModel):
    description: str
    requirements: str
    benefits: str
    skills_required: list[str]


class JDPdfParseResponse(BaseModel):
    # The stored blob URL + original filename for the uploaded PDF, plus the
    # structured fields extracted from it so HR can review/apply before saving.
    jd_pdf_url: str
    jd_pdf_name: str
    description: str
    requirements: str
    benefits: str
    skills_required: list[str]
    title: Optional[str] = None
    location: Optional[str] = None
    employment_type: Optional[str] = None
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    parsed: bool = True


class JobCreate(BaseModel):
    title: str
    department_id: Optional[uuid.UUID] = None
    location: Optional[str] = None
    location_type: Optional[str] = None
    employment_type: Optional[str] = None
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    salary_currency: str = "INR"
    show_salary: bool = False
    description: str
    requirements: Optional[str] = None
    benefits: Optional[str] = None
    skills_required: Optional[list[str]] = None
    jd_pdf_url: Optional[str] = None
    jd_pdf_name: Optional[str] = None
    openings: int = 1
    is_internal: bool = False
    allow_referrals: bool = True
    allow_outsiders: bool = True
    criticality: Criticality = "medium"
    closes_at: Optional[datetime] = None
    hiring_manager_id: Optional[uuid.UUID] = None


class JobUpdate(BaseModel):
    title: Optional[str] = None
    department_id: Optional[uuid.UUID] = None
    location: Optional[str] = None
    location_type: Optional[str] = None
    employment_type: Optional[str] = None
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    salary_currency: Optional[str] = None
    show_salary: Optional[bool] = None
    description: Optional[str] = None
    requirements: Optional[str] = None
    benefits: Optional[str] = None
    skills_required: Optional[list[str]] = None
    jd_pdf_url: Optional[str] = None
    jd_pdf_name: Optional[str] = None
    openings: Optional[int] = None
    is_internal: Optional[bool] = None
    allow_referrals: Optional[bool] = None
    allow_outsiders: Optional[bool] = None
    criticality: Optional[Criticality] = None
    closes_at: Optional[datetime] = None
    hiring_manager_id: Optional[uuid.UUID] = None


class JobStatusUpdate(BaseModel):
    status: str


class JobResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    title: str
    slug: str
    department_id: Optional[uuid.UUID] = None
    location: Optional[str] = None
    location_type: Optional[str] = None
    employment_type: Optional[str] = None
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    salary_currency: str
    show_salary: bool
    description: str
    requirements: Optional[str] = None
    benefits: Optional[str] = None
    skills_required: Optional[list[str]] = None
    jd_pdf_url: Optional[str] = None
    jd_pdf_name: Optional[str] = None
    openings: int
    status: str
    is_internal: bool
    allow_referrals: bool
    allow_outsiders: bool
    criticality: Criticality
    posted_by: Optional[uuid.UUID] = None
    posted_by_name: Optional[str] = None
    hiring_manager_id: Optional[uuid.UUID] = None
    hiring_manager_name: Optional[str] = None
    published_at: Optional[datetime] = None
    closes_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class JobListResponse(BaseModel):
    items: list[JobResponse]
    total: int
    page: int
    limit: int
    pages: int
