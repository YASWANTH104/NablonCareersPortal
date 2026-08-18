import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator


class ProjectItem(BaseModel):
    title: str
    description: str
    github_url: Optional[str] = None
    tech_stack: Optional[str] = None

    @field_validator("title", "description")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("This field is required")
        return v.strip()


class ScreeningSubmit(BaseModel):
    college_name: str
    cgpa: float
    relevant_experience: Optional[str] = None
    skills: list[str] = []
    projects: list[ProjectItem] = []
    achievements: Optional[str] = None
    github_profile_url: Optional[str] = None

    @field_validator("college_name")
    @classmethod
    def _college_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("College name is required")
        return v.strip()

    @field_validator("cgpa")
    @classmethod
    def _cgpa_range(cls, v: float) -> float:
        if v < 0 or v > 10:
            raise ValueError("CGPA must be between 0 and 10")
        return v


class ScreeningPublicInfo(BaseModel):
    status: str
    candidate_name: str
    job_title: str
    expires_at: datetime


class ScreeningResponseOut(BaseModel):
    id: uuid.UUID
    application_id: uuid.UUID
    status: str
    college_name: Optional[str] = None
    cgpa: Optional[float] = None
    relevant_experience: Optional[str] = None
    skills: Optional[list[str]] = None
    projects: Optional[list[dict]] = None
    achievements: Optional[str] = None
    github_profile_url: Optional[str] = None
    college_tier: Optional[int] = None
    college_score: Optional[float] = None
    cgpa_score: Optional[float] = None
    skills_score: Optional[float] = None
    project_score: Optional[float] = None
    overall_score: Optional[float] = None
    recommendation: Optional[str] = None
    auto_reject: bool = False
    auto_reject_reason: Optional[str] = None
    ai_reasoning: Optional[dict] = None
    is_ai_scored: bool = False
    submitted_at: Optional[datetime] = None
    scored_at: Optional[datetime] = None
    expires_at: datetime
    created_at: Optional[datetime] = None
