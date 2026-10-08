import uuid
from typing import Literal, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.services import action_center_service as svc

router = APIRouter(prefix="/action-center", tags=["action-center"])
_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)


@router.get("")
async def list_actions(
    scope: Literal["mine", "team", "unclaimed"] = Query("mine"),
    handler_id: Optional[uuid.UUID] = Query(None),
    include_snoozed: bool = Query(False),
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Every in-flight candidate's next action for the chosen scope.
    Summary counts are computed over the scope BEFORE handler/snooze display
    filtering, so the tiles always describe the whole scope."""
    all_items = await svc.compute_actions(db)
    scoped = [i for i in all_items if svc.in_scope(i, scope, user.id)]
    summary = svc.summarize(scoped)
    items = scoped
    if handler_id:
        items = [i for i in items if i["handler_id"] == str(handler_id)]
    if not include_snoozed:
        items = [i for i in items if not i["snoozed"]]
    return {"scope": scope, "summary": summary, "items": items}


@router.get("/count")
async def my_action_count(
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Sidebar badge: the caller's own due + overdue items (never 'waiting')."""
    mine = [
        i for i in await svc.compute_actions(db)
        if svc.in_scope(i, "mine", user.id) and not i["snoozed"] and i["severity"] != "waiting"
    ]
    return {
        "overdue": sum(1 for i in mine if i["severity"] == "overdue"),
        "due": sum(1 for i in mine if i["severity"] == "due"),
    }


class SnoozeRequest(BaseModel):
    application_id: uuid.UUID
    action_type: str = Field(..., min_length=1, max_length=50)
    days: int = Field(..., ge=1, le=30)
    note: Optional[str] = Field(None, max_length=500)


@router.post("/snoozes", status_code=201)
async def snooze_action(
    data: SnoozeRequest,
    user=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    row = await svc.snooze(
        db, application_id=data.application_id, action_type=data.action_type,
        days=data.days, note=data.note, user_id=user.id,
    )
    return {"id": str(row.id), "snoozed_until": row.snoozed_until.isoformat()}


@router.delete("/snoozes/{application_id}/{action_type}", status_code=204)
async def unsnooze_action(
    application_id: uuid.UUID,
    action_type: str,
    _=Depends(require_roles(*_HR_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    await svc.unsnooze(db, application_id=application_id, action_type=action_type)
