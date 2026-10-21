import uuid
from datetime import date, datetime, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles, Role
from app.services import autoproctor_service as svc

# Its own prefix rather than living under /assessments: that router has
# /assessments/{assessment_id} typed as a UUID, and a literal path declared
# after it would 422 instead of falling through.
router = APIRouter(prefix="/autoproctor", tags=["autoproctor"])
_HR_ROLES = (Role.HR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
# Interviewers see results on the candidates they open, read-only.
_READ_ROLES = (*_HR_ROLES, Role.INTERVIEWER)


class LinkBody(BaseModel):
    """assessment_id links to that assessment; application_id alone links to
    the candidate's AutoProctor assessment, creating one if they have none;
    both None unlinks."""
    assessment_id: Optional[uuid.UUID] = None
    application_id: Optional[uuid.UUID] = None


class SyncBody(BaseModel):
    date_from: date
    date_to: date


# Keeps one run comfortably inside the task's 3-hour limit; wider windows
# should be split into several runs.
MAX_RANGE_DAYS = 31


@router.get("/summary")
async def get_summary(_=Depends(require_roles(*_HR_ROLES)), db: AsyncSession = Depends(get_db)):
    return await svc.summary(db)


@router.get("/attempts")
async def list_attempts(
    q: Optional[str] = Query(None),
    test_label: Optional[str] = Query(None),
    match: Literal["all", "matched", "unmatched"] = Query("all"),
    application_id: Optional[uuid.UUID] = Query(None),
    _=Depends(require_roles(*_READ_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    return await svc.list_attempts(db, q=q, test_label=test_label, match=match, application_id=application_id)


@router.get("/attempts/{attempt_id}")
async def get_attempt(attempt_id: uuid.UUID, _=Depends(require_roles(*_READ_ROLES)), db: AsyncSession = Depends(get_db)):
    return await svc.get_attempt(db, attempt_id)


@router.post("/attempts/{attempt_id}/link")
async def link_attempt(
    attempt_id: uuid.UUID, body: LinkBody,
    user=Depends(require_roles(*_HR_ROLES)), db: AsyncSession = Depends(get_db),
):
    """Attach an attempt to an assessment by hand (candidate sat the test
    under a different email), or detach it with assessment_id=null."""
    return await svc.link_attempt(db, attempt_id, body.assessment_id, body.application_id, user.id)


@router.get("/pending")
async def pending(_=Depends(require_roles(*_HR_ROLES)), db: AsyncSession = Depends(get_db)):
    return await svc.pending_assessments(db)


@router.get("/linkable-assessments")
async def linkable(
    q: str = Query(..., min_length=2),
    _=Depends(require_roles(*_HR_ROLES)), db: AsyncSession = Depends(get_db),
):
    return await svc.linkable_applications(db, q)


@router.get("/runs")
async def runs(_=Depends(require_roles(*_HR_ROLES)), db: AsyncSession = Depends(get_db)):
    return await svc.recent_runs(db)


@router.post("/sync", status_code=202)
async def sync_now(body: SyncBody, _=Depends(require_roles(*_HR_ROLES)), db: AsyncSession = Depends(get_db)):
    """Scrape every attempt started between date_from and date_to (IST days,
    inclusive). Attempts already stored are skipped, so overlapping or
    repeated ranges only fetch what's missing. Import only — reminders and
    auto-drops stay with the nightly run."""
    from app.config import settings
    from app.utils.timezone import IST

    if not settings.AUTOPROCTOR_ENABLED:
        raise HTTPException(400, "AutoProctor sync is turned off (AUTOPROCTOR_ENABLED).")
    from app.services.autoproctor_scraper import missing_config
    missing = missing_config()
    if missing:
        raise HTTPException(400, f"AutoProctor sync isn't configured on the server — set: {', '.join(missing)}")
    today = datetime.now(timezone.utc).astimezone(IST).date()
    if body.date_from > body.date_to:
        raise HTTPException(400, "From date must be on or before To date.")
    if body.date_to > today:
        raise HTTPException(400, "To date can't be in the future.")
    if (body.date_to - body.date_from).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(400, f"Pick at most {MAX_RANGE_DAYS} days per run.")
    run = await svc.queue_manual_run(db, body.date_from, body.date_to)

    from app.tasks.autoproctor_tasks import sync_autoproctor_results
    try:
        sync_autoproctor_results.delay("manual", body.date_from.isoformat(), body.date_to.isoformat(), str(run.id))
    except Exception:
        # Broker unreachable: don't leave a "queued" row that blocks every later click.
        await svc.fail_queued_run(db, run.id, "Could not reach the task queue")
        raise HTTPException(503, "Couldn't start the scrape — the task queue is unavailable. Try again shortly.")
    return {"queued": True, "run_id": str(run.id)}
