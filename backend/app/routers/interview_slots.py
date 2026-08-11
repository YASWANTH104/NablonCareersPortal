import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.schemas.interview_slot import SlotPublishRequest, SlotResponse, SlotBookRequest
from app.services import interview_slot_service

router = APIRouter(prefix="/interview-slots", tags=["interview-slots"])

_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
_HR_AND_INTERVIEWER = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN, Role.INTERVIEWER)


@router.get("/jobs")
async def publishable_jobs(
    _=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_slot_service.list_publishable_jobs(db)


@router.post("/publish", response_model=list[SlotResponse], status_code=201)
async def publish_slots(
    data: SlotPublishRequest,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_slot_service.publish_slots(
        db,
        requesting_user=user,
        interviewer_id=data.interviewer_id,
        job_id=data.job_id,
        round_type=data.round_type,
        duration_mins=data.duration_mins,
        start_times=data.start_times,
    )


@router.get("/mine", response_model=list[SlotResponse])
async def my_slots(
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_slot_service.get_my_slots(db, user.id)


@router.delete("/{slot_id}", status_code=204)
async def unpublish_slot(
    slot_id: uuid.UUID,
    user=Depends(require_roles(*_HR_AND_INTERVIEWER)),
    db: AsyncSession = Depends(get_db),
):
    await interview_slot_service.unpublish_slot(db, slot_id, user)


@router.get("/interviewer/{user_id}", response_model=list[SlotResponse])
async def interviewer_slots(
    user_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_slot_service.get_interviewer_slots_for_hr(db, user_id)


@router.get("/job/{job_id}", response_model=list[SlotResponse])
async def job_slots(
    job_id: uuid.UUID,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_slot_service.get_job_slots_for_hr(db, job_id)


@router.post("/book", response_model=SlotResponse)
async def book_slot(
    data: SlotBookRequest,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await interview_slot_service.book_slot(
        db,
        application_id=data.application_id,
        slot_id=data.slot_id,
        booked_by_user_id=user.id,
    )
