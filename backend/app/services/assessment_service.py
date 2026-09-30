import uuid
from typing import Optional
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.assessment import Assessment
from app.schemas.assessment import AssessmentCreate, AssessmentUpdate, AssessmentResponse, AssessmentBulkCreate

MAX_BULK_ASSESSMENTS = 200


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

        app = await db.get(Application, data.application_id)
        candidate = await db.get(User, app.applicant_id)
        job = await db.get(Job, app.job_id)

        job_title = job.title if job else "the position"
        deadline_str = data.deadline.strftime("%B %d, %Y at %I:%M %p") if data.deadline else "TBD"

        db.add(Notification(
            user_id=candidate.id,
            type="assessment_scheduled",
            title=f"Assessment assigned: {data.title}",
            body=f"Complete your assessment for {job_title} by {deadline_str}.",
            link="/portal/applications",
        ))
        await db.commit()
    except Exception:
        pass

    # Email (a real ACS send takes several seconds) runs out-of-request via
    # Celery — same fix as interview scheduling, which had the identical bug.
    try:
        from app.tasks.email_tasks import send_assessment_scheduled_email
        send_assessment_scheduled_email.delay(str(assessment.id))
    except Exception:
        pass

    return assessment


async def bulk_create_assessments(
    db: AsyncSession,
    data: AssessmentBulkCreate,
    created_by: uuid.UUID,
    *,
    allowed_application_ids: Optional[set[uuid.UUID]] = None,
) -> list[dict]:
    """Schedule the same assessment for every application in data.application_ids.

    Each row goes through create_assessment() independently — same isolate-
    per-row-failure shape as application_service.bulk_submit_from_excel — so
    one already-assessed or unknown application_id doesn't block the rest of
    a placement drive's batch. create_assessment already queues the
    candidate's own email via Celery (send_assessment_scheduled_email), so a
    batch of N application_ids here IS the bulk-email action; nothing extra
    to dispatch.

    `allowed_application_ids`, when given, restricts the batch to a caller-
    verified set (e.g. only candidates belonging to one campus's job
    assignment) — a public portal token must never be able to schedule an
    assessment for an application_id outside what it was handed.
    """
    if not data.application_ids:
        return []
    if len(data.application_ids) > MAX_BULK_ASSESSMENTS:
        raise HTTPException(400, f"Please schedule at most {MAX_BULK_ASSESSMENTS} assessments at a time.")

    from app.models.application import Application

    per_application = data.model_dump(exclude={"application_ids"})
    results: list[dict] = []

    for application_id in data.application_ids:
        if allowed_application_ids is not None and application_id not in allowed_application_ids:
            results.append({"application_id": application_id, "status": "error", "error": "Not part of this assignment."})
            continue
        try:
            app = await db.get(Application, application_id)
            if not app:
                results.append({"application_id": application_id, "status": "error", "error": "Application not found."})
                continue
            assessment = await create_assessment(
                db, AssessmentCreate(application_id=application_id, **per_application), created_by,
            )
            results.append({"application_id": application_id, "status": "success", "assessment_id": assessment.id})
        except HTTPException as exc:
            await db.rollback()
            results.append({"application_id": application_id, "status": "error", "error": str(exc.detail)})
        except Exception:
            await db.rollback()
            results.append({"application_id": application_id, "status": "error", "error": "Unexpected error scheduling this assessment."})

    return results


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
