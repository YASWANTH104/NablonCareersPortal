import uuid
from datetime import datetime
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.job import Job, Department, JobQuestion
from app.models.user import User
from app.schemas.job import JobCreate, JobUpdate, JobQuestionCreate
from app.utils.slug import generate_slug


JOB_STATUS_TRANSITIONS = {
    "draft": ["published"],
    "published": ["paused", "closed"],
    "paused": ["published", "closed"],
    "closed": ["archived"],
    "archived": [],
}


async def _name_map(db: AsyncSession, user_ids: set) -> dict:
    ids = {uid for uid in user_ids if uid}
    if not ids:
        return {}
    rows = (await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))).all()
    return {row.id: row.full_name for row in rows}


def _job_to_dict(job: Job, names: dict) -> dict:
    data = {c.name: getattr(job, c.name) for c in Job.__table__.columns}
    data["posted_by_name"] = names.get(job.posted_by)
    data["hiring_manager_name"] = names.get(job.hiring_manager_id)
    return data


async def get_job_with_names(db: AsyncSession, job: Job) -> dict:
    names = await _name_map(db, {job.posted_by, job.hiring_manager_id})
    return _job_to_dict(job, names)


async def list_jobs_public(
    db: AsyncSession,
    *,
    search: Optional[str] = None,
    department_id: Optional[str] = None,
    location_type: Optional[str] = None,
    employment_type: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    audience: str = "public",
) -> dict:
    # "public": anonymous visitors / candidates on the public job board — only
    # jobs open to outside applicants. "referral": logged-in internal staff
    # (any non-applicant role) browsing what they're allowed to refer for.
    # Internal-only jobs are excluded from both — there's no external route,
    # referral or otherwise, once a job is marked internal-only.
    filters = [Job.status == "published", Job.is_internal.is_(False)]
    filters.append(Job.allow_referrals.is_(True) if audience == "referral" else Job.allow_outsiders.is_(True))

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

    ids = {j.posted_by for j in rows} | {j.hiring_manager_id for j in rows}
    names = await _name_map(db, ids)
    items = [_job_to_dict(j, names) for j in rows]

    return {"items": items, "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


async def is_hiring_manager(db: AsyncSession, job_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Single source of truth for the "is this user the hiring manager on
    this job" check — used by application_service/interview_service/etc. to
    grant view-only pipeline access to a job's assigned hiring manager
    without duplicating this query in every service module."""
    job = await db.get(Job, job_id)
    return bool(job and job.hiring_manager_id and str(job.hiring_manager_id) == str(user_id))


async def hiring_manager_job_ids(db: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Every job id this user is the assigned hiring manager on — used to
    scope a hiring manager's application-list view to only their own jobs."""
    rows = (await db.execute(select(Job.id).where(Job.hiring_manager_id == user_id))).scalars().all()
    return list(rows)


async def list_accessible_jobs_for_applicant_view(db: AsyncSession, current_user) -> list[dict]:
    """Minimal {id, title} list of jobs current_user can see applications for
    on ApplicantsPage — mirrors exactly the scoping rule in
    application_service.get_all_applications: HR sees every job; a hiring
    manager sees their own jobs. Deliberately does NOT include jobs a plain
    interviewer merely has an assigned interview on — this list/the
    Applicants tab is a hiring-manager-only view; an interviewer's access to
    a specific candidate is detail-page-only, reached via "My Interviews",
    never through this general job-scoped browse list. Also deliberately NOT
    the same source as the public GET /jobs endpoint, which for a non-HR
    caller returns the published/referral job board — an unrelated list that
    has nothing to do with hiring_manager_id."""
    hr_roles = {"hr_manager", "admin", "super_admin"}
    if current_user.role in hr_roles:
        rows = (await db.execute(select(Job.id, Job.title).order_by(Job.title))).all()
        return [{"id": jid, "title": title} for jid, title in rows]

    job_ids = set(await hiring_manager_job_ids(db, current_user.id))
    if not job_ids:
        return []

    rows = (await db.execute(
        select(Job.id, Job.title).where(Job.id.in_(job_ids)).order_by(Job.title)
    )).all()
    return [{"id": jid, "title": title} for jid, title in rows]


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
    is_first_publish = new_status == "published" and not job.published_at
    if is_first_publish:
        job.published_at = datetime.utcnow()

    await db.commit()

    # Announce to the internal team once, on the job's first-ever publish —
    # not on every pause/resume — and only when it's actually open to referrals
    # (an internal-only or referrals-off job has nothing for them to act on).
    if is_first_publish and not job.is_internal and job.allow_referrals:
        from app.tasks.email_tasks import send_new_job_posted_email
        send_new_job_posted_email.delay(str(job.id))

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
