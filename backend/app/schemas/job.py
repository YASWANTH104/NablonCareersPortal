import uuid
from datetime import datetime
from pydantic import BaseModel
from typing import Optional


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
    openings: int = 1
    is_internal: bool = False
    closes_at: Optional[datetime] = None


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
    openings: Optional[int] = None
    is_internal: Optional[bool] = None
    closes_at: Optional[datetime] = None


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
    openings: int
    status: str
    is_internal: bool
    posted_by: Optional[uuid.UUID] = None
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
