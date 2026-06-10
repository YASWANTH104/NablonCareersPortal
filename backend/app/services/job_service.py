import uuid
from datetime import datetime
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.job import Job, Department, JobQuestion
from app.schemas.job import JobCreate, JobUpdate, JobQuestionCreate
from app.utils.slug import generate_slug


JOB_STATUS_TRANSITIONS = {
    "draft": ["published"],
    "published": ["paused", "closed"],
    "paused": ["published", "closed"],
    "closed": ["archived"],
    "archived": [],
}


async def list_jobs_public(
    db: AsyncSession,
    *,
    search: Optional[str] = None,
    department_id: Optional[str] = None,
    location_type: Optional[str] = None,
    employment_type: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    filters = [Job.status == "published"]

    if search:
        filters.append(Job.title.ilike(f"%{search}%"))
    if department_id:
        try:
            filters.append(Job.department_id == uuid.UUID(department_id))
        except ValueError:
            pass
    if location_type:
        filters.append(Job.location_type == location_type)
    if employment_type:
        filters.append(Job.employment_type == employment_type)

    condition = and_(*filters)
    total = (await db.execute(select(func.count()).select_from(Job).where(condition))).scalar_one()

    offset = (page - 1) * limit
    rows = (
        await db.execute(
            select(Job).where(condition).order_by(Job.published_at.desc().nullslast()).offset(offset).limit(limit)
        )
    ).scalars().all()

    return {"items": list(rows), "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


async def list_jobs_hr(
    db: AsyncSession,
    *,
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    filters = []
    if status:
        filters.append(Job.status == status)
    if search:
        filters.append(Job.title.ilike(f"%{search}%"))

    condition = and_(*filters) if filters else True
    total = (await db.execute(select(func.count()).select_from(Job).where(condition))).scalar_one()

    offset = (page - 1) * limit
    rows = (
        await db.execute(select(Job).where(condition).order_by(Job.created_at.desc()).offset(offset).limit(limit))
    ).scalars().all()

    return {"items": list(rows), "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


async def get_job_by_slug(db: AsyncSession, slug: str) -> Optional[Job]:
    result = await db.execute(select(Job).where(Job.slug == slug))
    return result.scalar_one_or_none()


async def get_job_by_id(db: AsyncSession, job_id: uuid.UUID) -> Optional[Job]:
    return await db.get(Job, job_id)


async def create_job(db: AsyncSession, data: JobCreate, posted_by: uuid.UUID) -> Job:
    slug = generate_slug(data.title)
    job = Job(slug=slug, posted_by=posted_by, **data.model_dump())
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def update_job(db: AsyncSession, job_id: uuid.UUID, data: JobUpdate) -> Job:
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(job, field, value)

    job.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(job)
    return job


async def update_job_status(db: AsyncSession, job_id: uuid.UUID, new_status: str) -> Job:
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    allowed = JOB_STATUS_TRANSITIONS.get(job.status, [])
    if new_status not in allowed:
        raise HTTPException(400, f"Cannot transition from '{job.status}' to '{new_status}'")

    job.status = new_status
    job.updated_at = datetime.utcnow()
    if new_status == "published" and not job.published_at:
        job.published_at = datetime.utcnow()

    await db.commit()
    await db.refresh(job)
    return job


async def delete_job(db: AsyncSession, job_id: uuid.UUID) -> None:
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    await db.delete(job)
    await db.commit()


async def get_job_questions(db: AsyncSession, job_id: uuid.UUID) -> list:
    result = await db.execute(
        select(JobQuestion)
        .where(JobQuestion.job_id == job_id)
        .order_by(JobQuestion.order_index)
    )
    return list(result.scalars().all())


async def add_job_question(db: AsyncSession, job_id: uuid.UUID, data: JobQuestionCreate) -> JobQuestion:
    question = JobQuestion(job_id=job_id, **data.model_dump())
    db.add(question)
    await db.commit()
    await db.refresh(question)
    return question


async def remove_job_question(db: AsyncSession, job_id: uuid.UUID, question_id: uuid.UUID) -> None:
    result = await db.execute(
        select(JobQuestion).where(JobQuestion.id == question_id, JobQuestion.job_id == job_id)
    )
    question = result.scalar_one_or_none()
    if not question:
        raise HTTPException(404, "Question not found")
    await db.delete(question)
    await db.commit()


async def list_departments(db: AsyncSession) -> list:
    result = await db.execute(select(Department).order_by(Department.name))
    return list(result.scalars().all())


async def create_department(db: AsyncSession, name: str) -> Department:
    dept = Department(name=name)
    db.add(dept)
    try:
        await db.commit()
        await db.refresh(dept)
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Department name already exists")
    return dept


async def update_department(db: AsyncSession, dept_id, name: str) -> Department:
    dept = (await db.execute(select(Department).where(Department.id == dept_id))).scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    dept.name = name
    try:
        await db.commit()
        await db.refresh(dept)
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Department name already exists")
    return dept


async def delete_department(db: AsyncSession, dept_id) -> None:
    dept = (await db.execute(select(Department).where(Department.id == dept_id))).scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    try:
        await db.delete(dept)
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete — department has jobs assigned")
