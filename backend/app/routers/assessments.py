import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles, Role
from app.models.user import User
from app.schemas.assessment import AssessmentCreate, AssessmentUpdate, AssessmentResponse, AssessmentBulkCreate
from app.services import assessment_service

router = APIRouter(prefix="/assessments", tags=["assessments"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


@router.post("", response_model=AssessmentResponse, status_code=201)
async def schedule_assessment(
    data: AssessmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await assessment_service.create_assessment(db, data, current_user.id)


@router.post("/bulk")
async def schedule_assessments_bulk(
    data: AssessmentBulkCreate,
    current_user: User = Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Schedule the same assessment (deadline, platform link, instructions)
    across many applications at once — e.g. an entire campus placement
    drive's roster. See assessment_service.bulk_create_assessments."""
    results = await assessment_service.bulk_create_assessments(db, data, current_user.id)
    created = sum(1 for r in results if r["status"] == "success")
    return {"results": results, "created": created, "failed": len(results) - created}


@router.get("", response_model=list[AssessmentResponse])
async def list_assessments(
    application_id: Optional[uuid.UUID] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await assessment_service.list_assessments(db, application_id=application_id, status=status)


@router.get("/{assessment_id}", response_model=AssessmentResponse)
async def get_assessment(
    assessment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await assessment_service.get_assessment(db, assessment_id)


@router.patch("/{assessment_id}", response_model=AssessmentResponse)
async def update_assessment(
    assessment_id: uuid.UUID,
    data: AssessmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await assessment_service.update_assessment(db, assessment_id, data)


@router.delete("/{assessment_id}", status_code=204)
async def cancel_assessment(
    assessment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assessment_service.cancel_assessment(db, assessment_id)
