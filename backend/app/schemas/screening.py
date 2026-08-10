import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class CertificationEntry(BaseModel):
    name: str
    issuer: str = ""
    year: str = ""


class ProjectEntry(BaseModel):
    title: str
    description: str = ""
    tech_stack: str = ""
    link: str = ""


class ScreeningResponseSubmit(BaseModel):
    college_name: str = Field(min_length=1, max_length=255)
    degree: str = Field(min_length=1, max_length=100)
    branch: str = Field(min_length=1, max_length=100)
    graduation_year: int = Field(ge=1990, le=2035)
    cgpa: str = Field(min_length=1, max_length=20)
    key_skills: str = Field(min_length=1)
    certifications: list[CertificationEntry] = []
    projects: list[ProjectEntry] = Field(min_length=1)


class PublicScreeningResponse(BaseModel):
    candidate_name: str
    job_title: str
    submitted_at: Optional[datetime]
    college_name: Optional[str]
    degree: Optional[str]
    branch: Optional[str]
    graduation_year: Optional[int]
    cgpa: Optional[str]
    key_skills: Optional[str]
    certifications: list[CertificationEntry]
    projects: list[ProjectEntry]


class ScreeningResponseDetail(BaseModel):
    id: uuid.UUID
    application_id: uuid.UUID
    job_id: uuid.UUID
    token: str
    college_name: Optional[str]
    degree: Optional[str]
    branch: Optional[str]
    graduation_year: Optional[int]
    cgpa: Optional[str]
    key_skills: Optional[str]
    certifications: list[CertificationEntry]
    projects: list[ProjectEntry]
    email_sent_at: Optional[datetime]
    submitted_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}
