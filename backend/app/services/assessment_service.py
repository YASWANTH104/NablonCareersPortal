import uuid
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.assessment import Assessment
from app.schemas.assessment import AssessmentCreate, AssessmentUpdate, AssessmentResponse


async def create_assessment(
    db: AsyncSession,
    data: AssessmentCreate,
    created_by: uuid.UUID,
) -> Assessment:
    assessment = Assessment(created_by=created_by, **data.model_dump())
    db.add(assessment)
    await db.commit()
    await db.refresh(assessment)

    try:
        from app.models.application import Application
        from app.models.user import User
        from app.models.job import Job
        from app.models.notification import Notification
        from app.services.email_service import send_email

        app = await db.get(Application, data.application_id)
        candidate = await db.get(User, app.applicant_id)
        job = await db.get(Job, app.job_id)

        job_title = job.title if job else "the position"
        deadline_str = data.deadline.strftime("%B %d, %Y at %I:%M %p") if data.deadline else "TBD"
        type_label = data.assessment_type.replace("_", " ").title()

        db.add(Notification(
            user_id=candidate.id,
            type="assessment_scheduled",
            title=f"Assessment assigned: {data.title}",
            body=f"Complete your assessment for {job_title} by {deadline_str}.",
            link="/portal/applications",
        ))

        await send_email(
            to_email=candidate.email,
            subject=f"Assessment Assigned – {job_title}",
            template_name="assessment_scheduled",
            context={
                "full_name": candidate.full_name,
                "job_title": job_title,
                "assessment_title": data.title,
                "assessment_type": type_label,
                "deadline": deadline_str,
                "duration_mins": data.duration_mins,
                "platform_link": data.platform_link,
                "instructions": data.instructions,
            },
        )
        await db.commit()
    except Exception:
        pass

    return assessment


async def list_assessments(
    db: AsyncSession,
    application_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
) -> list[Assessment]:
    stmt = select(Assessment)
    if application_id:
        stmt = stmt.where(Assessment.application_id == application_id)
    if status:
        stmt = stmt.where(Assessment.status == status)
    stmt = stmt.order_by(Assessment.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_assessment(db: AsyncSession, assessment_id: uuid.UUID) -> Assessment:
    obj = await db.get(Assessment, assessment_id)
    if not obj:
        raise HTTPException(404, "Assessment not found")
    return obj


async def update_assessment(
    db: AsyncSession,
    assessment_id: uuid.UUID,
    data: AssessmentUpdate,
) -> Assessment:
    obj = await get_assessment(db, assessment_id)
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(obj, field, val)
    await db.commit()
    await db.refresh(obj)
    return obj


async def cancel_assessment(db: AsyncSession, assessment_id: uuid.UUID) -> None:
    obj = await get_assessment(db, assessment_id)
    obj.status = "cancelled"
    await db.commit()
