import uuid
import secrets
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.screening import ScreeningResponse
from app.schemas.screening import ScreeningResponseSubmit, PublicScreeningResponse


async def get_or_create(db: AsyncSession, application_id: uuid.UUID, job_id: uuid.UUID) -> ScreeningResponse:
    existing = (await db.execute(
        select(ScreeningResponse).where(ScreeningResponse.application_id == application_id)
    )).scalar_one_or_none()
    if existing:
        return existing

    resp = ScreeningResponse(
        application_id=application_id,
        job_id=job_id,
        token=secrets.token_urlsafe(32),
    )
    db.add(resp)
    await db.commit()
    await db.refresh(resp)
    return resp


async def get_by_token(db: AsyncSession, token: str) -> ScreeningResponse:
    resp = (await db.execute(
        select(ScreeningResponse).where(ScreeningResponse.token == token)
    )).scalar_one_or_none()
    if not resp:
        raise HTTPException(404, "Invalid link")
    return resp


async def get_public_status(db: AsyncSession, token: str) -> PublicScreeningResponse:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job

    resp = await get_by_token(db, token)

    row = (await db.execute(
        select(User.full_name, Job.title)
        .select_from(Application)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .where(Application.id == resp.application_id)
    )).first()
    if not row:
        raise HTTPException(404, "Application not found")
    candidate_name, job_title = row

    return PublicScreeningResponse(
        candidate_name=candidate_name,
        job_title=job_title,
        submitted_at=resp.submitted_at,
        college_name=resp.college_name,
        degree=resp.degree,
        branch=resp.branch,
        graduation_year=resp.graduation_year,
        cgpa=resp.cgpa,
        key_skills=resp.key_skills,
        certifications=resp.certifications or [],
        projects=resp.projects or [],
    )


async def submit(db: AsyncSession, token: str, data: ScreeningResponseSubmit) -> PublicScreeningResponse:
    resp = await get_by_token(db, token)

    resp.college_name = data.college_name
    resp.degree = data.degree
    resp.branch = data.branch
    resp.graduation_year = data.graduation_year
    resp.cgpa = data.cgpa
    resp.key_skills = data.key_skills
    resp.certifications = [c.model_dump() for c in data.certifications]
    resp.projects = [p.model_dump() for p in data.projects]
    resp.submitted_at = datetime.now(timezone.utc)
    await db.commit()

    return await get_public_status(db, token)
