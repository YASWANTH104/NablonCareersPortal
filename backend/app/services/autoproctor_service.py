"""AutoProctor results sync and assessment follow-ups.

Nightly (tasks/autoproctor_tasks.py, 00:00 IST):
  1. Log into AutoProctor and import every newly finished attempt: top-level
     data, violation counters, and the candidate's slice of the test's
     responses workbook (stored in blob storage).
  2. Match each attempt to one of our assessments by candidate email + the
     test id in the assessment's platform link, and mark it completed.
  3. Act on each graded result (any run, nightly or manual): score >= 75%
     AND trust >= 90% moves the candidate to their next round; anything
     less moves them to Rejected, and the rejection email goes out
     immediately (user's call for this flow, 2026-10-21). Decided once per attempt.
  4. Nightly only: a candidate still in the assessment stage with nothing
     submitted 30 days after the assessment was sent moves to
     interview_drop (never before the deadline they were given).
  5. Daily at 10:00 IST (send_reminders, its own beat task so candidates
     aren't emailed at midnight): reminder emails 3 and 6 days after the
     assessment was sent, while it's still unsubmitted.

Only candidates sitting in the assessment stage are ever moved by 3 or 4;
anyone HR has already moved on is left alone.

The drop is the dangerous half — it closes a candidate out — so it only runs
after a sync that actually succeeded, and skips anyone whose attempt failed
to import this run. A broken login or a half-failed scrape therefore delays
drops instead of dropping people who did finish.
"""
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone, time as dtime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, update, func, or_, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.application import Application
from app.models.assessment import Assessment
from app.models.autoproctor import AutoproctorAttempt, AutoproctorSyncRun
from app.models.job import Job
from app.models.user import User
from app.services import storage_service
from app.utils.timezone import IST

logger = logging.getLogger(__name__)

DROP_AFTER = timedelta(days=30)
# Reminder emails go out this many days after the assessment was sent.
REMINDER_DAYS = (3, 6)
# The bar from the candidate email: both must be met (inclusive).
SCORE_BAR = 75.0
TRUST_BAR = 90
# The drop sweep needs a successful sync at least this recent.
SYNC_FRESHNESS = timedelta(hours=26)
# A "running" row older than this is a crashed run, not a live one.
RUN_LOCK_TTL = timedelta(hours=3)
# Re-list this far behind the last good run, so attempts that failed to
# import (or finished late) get another chance on the next nights.
RELIST_OVERLAP = timedelta(days=7)
DROP_CATEGORY = "assessment_not_completed"
COMPLETED_STATUSES = ("submitted", "completed", "evaluated")

_TEST_LABEL_RE = re.compile(r"autoproctor\.co/tests/([A-Za-z0-9]+)")


def is_autoproctor_link():
    return Assessment.platform_link.ilike("%autoproctor.co%")


def test_label_from_link(link: Optional[str]) -> Optional[str]:
    m = _TEST_LABEL_RE.search(link or "")
    return m.group(1) if m else None


def sync_start_utc() -> datetime:
    day = datetime.strptime(settings.AUTOPROCTOR_SYNC_START, "%Y-%m-%d").date()
    return _ist_day_start(day)


def drop_due_at(a: Assessment) -> datetime:
    """30 days after the assessment was sent, but never before the deadline
    the candidate was told."""
    due = a.created_at + DROP_AFTER
    if a.deadline and a.deadline > due:
        due = a.deadline
    return due


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Run bookkeeping ──────────────────────────────────────────────────────────

# One sync at a time, across every worker and replica. A session-level
# advisory lock on its own connection lives exactly as long as the run: if the
# worker dies the connection drops and Postgres frees it, so a crashed run can
# never wedge the next one. One-at-a-time also protects the login — two runs
# requesting codes together could each read the other's code.
SYNC_LOCK_KEY = 7_436_201
QUEUE_LOCK_KEY = 7_436_202
ACTIVE_STATUSES = ("queued", "running")


async def _abandon_stale(db: AsyncSession) -> None:
    now = _now()
    await db.execute(
        update(AutoproctorSyncRun)
        .where(AutoproctorSyncRun.status.in_(ACTIVE_STATUSES), AutoproctorSyncRun.started_at < now - RUN_LOCK_TTL)
        .values(status="failed", finished_at=now, error="Abandoned — the worker stopped mid-run")
    )


async def reap_dead_runs(db: AsyncSession) -> None:
    """A "running" row whose worker died (a deploy restarting the container,
    out of memory) would otherwise keep the page on "Running…" with the
    button locked. The run's advisory lock dies with its connection, so a
    running row with no lock held is a dead run. Read from pg_locks rather
    than try-locking, so this check can never block a run that's starting.
    (A bigint key below 2^32 shows up as classid 0, objid = key.)"""
    running = (await db.execute(
        select(AutoproctorSyncRun.id).where(AutoproctorSyncRun.status == "running").limit(1)
    )).first()
    if running:
        held = (await db.execute(text(
            "select exists(select 1 from pg_locks where locktype = 'advisory' "
            "and classid = 0 and objid = :k and objsubid = 1 and granted)"
        ), {"k": SYNC_LOCK_KEY})).scalar()
        if not held:
            await db.execute(
                update(AutoproctorSyncRun).where(AutoproctorSyncRun.status == "running")
                .values(status="failed", finished_at=_now(),
                        error="Stopped — the worker restarted mid-run (e.g. a deploy). "
                              "Run the same range again; attempts already imported are skipped.")
            )
    await _abandon_stale(db)
    await db.commit()


async def queue_manual_run(db: AsyncSession, date_from: date, date_to: date) -> AutoproctorSyncRun:
    """Record HR's scrape request as a "queued" run before the task starts,
    so the page shows it straight away and a second click is refused rather
    than queueing a duplicate. The transaction lock serializes two clicks
    landing in the same instant."""
    await reap_dead_runs(db)
    await db.execute(select(func.pg_advisory_xact_lock(QUEUE_LOCK_KEY)))
    active = (await db.execute(
        select(AutoproctorSyncRun.id).where(AutoproctorSyncRun.status.in_(ACTIVE_STATUSES)).limit(1)
    )).first()
    if active:
        # Commit, not rollback: it ends the transaction (releasing the lock)
        # and keeps the stale-row cleanup, without expiring loaded objects.
        await db.commit()
        raise HTTPException(409, "A sync is already queued or running — wait for it to finish.")
    run = AutoproctorSyncRun(started_at=_now(), status="queued", trigger="manual",
                             range_from=date_from, range_to=date_to)
    db.add(run)
    await db.commit()
    return run


async def fail_queued_run(db: AsyncSession, run_id: uuid.UUID, error: str) -> None:
    await _update_run(db, run_id, status="failed", finished_at=_now(), error=error)


async def _claim_run(db: AsyncSession, lock_conn, trigger: str, date_from: Optional[date],
                     date_to: Optional[date], run_id: Optional[uuid.UUID]) -> Optional[uuid.UUID]:
    """Take the sync lock and mark this run as running. Returns the run id,
    or None (after recording why) when another sync holds the lock."""
    got = await lock_conn.scalar(select(func.pg_try_advisory_lock(SYNC_LOCK_KEY)))
    # Session-level locks survive commit; don't leave this connection idle
    # inside a transaction for the length of the run.
    await lock_conn.commit()
    now = _now()
    if not got:
        msg = "Skipped — another sync was running"
        if run_id:
            await _update_run(db, run_id, status="failed", finished_at=now, error=msg)
        else:
            db.add(AutoproctorSyncRun(started_at=now, finished_at=now, status="failed", trigger=trigger,
                                      range_from=date_from, range_to=date_to or date_from, error=msg))
            await db.commit()
        return None

    # We hold the lock, so any other "running" row belongs to a dead run.
    await db.execute(
        update(AutoproctorSyncRun)
        .where(AutoproctorSyncRun.status == "running")
        .values(status="failed", finished_at=now, error="Abandoned — the worker stopped mid-run")
    )
    await _abandon_stale(db)
    if run_id:
        await db.execute(update(AutoproctorSyncRun).where(AutoproctorSyncRun.id == run_id)
                         .values(status="running", started_at=now))
    else:
        run = AutoproctorSyncRun(started_at=now, status="running", trigger=trigger,
                                 range_from=date_from, range_to=date_to or date_from)
        db.add(run)
        await db.flush()
        run_id = run.id
    await db.commit()
    return run_id


async def last_successful_run(db: AsyncSession) -> Optional[AutoproctorSyncRun]:
    """Last good INCREMENTAL run. A manual range import only proves that
    window was fetched, so it neither moves the nightly window forward nor
    counts as the fresh sync the auto-drop requires."""
    return (await db.execute(
        select(AutoproctorSyncRun).where(AutoproctorSyncRun.status == "success",
                                         AutoproctorSyncRun.range_from.is_(None))
        .order_by(AutoproctorSyncRun.started_at.desc()).limit(1)
    )).scalar_one_or_none()


async def _list_since(db: AsyncSession) -> datetime:
    start = sync_start_utc()
    last = await last_successful_run(db)
    if last:
        return max(start, last.started_at - RELIST_OVERLAP)
    return start


# ── Import ───────────────────────────────────────────────────────────────────

async def _store_attempt(db: AsyncSession, data: dict, workbook: Optional[bytes]) -> AutoproctorAttempt:
    from app.services.autoproctor_scraper import slice_responses

    base = f"autoproctor/{data['test_label']}/{data['attempt_label']}"
    responses_url, responses = None, []
    if workbook:
        try:
            sliced, responses = slice_responses(workbook, data["candidate_email"])
            if sliced:
                responses_url = await storage_service.upload_bytes(
                    sliced, f"{base}/responses.xlsx",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
        except Exception:
            logger.exception(f"AutoProctor {data['attempt_label']}: responses workbook unreadable")
    attempt = AutoproctorAttempt(**data, responses=responses, responses_file_url=responses_url)
    db.add(attempt)
    await db.flush()
    return attempt


def _apply_completion(assessment: Assessment, attempt: AutoproctorAttempt) -> None:
    """Mark the assessment done with the attempt's score. An assessment HR has
    already evaluated keeps HR's status — the sync only fills in, never
    overrides a human call."""
    if assessment.status != "evaluated":
        assessment.status = "completed"
    assessment.completed_at = attempt.finished_at
    if attempt.points_scored is not None and attempt.points_available:
        assessment.score, assessment.max_score = attempt.points_scored, attempt.points_available
    elif attempt.percentage_scored is not None:
        assessment.score, assessment.max_score = attempt.percentage_scored, 100


async def match_attempt(db: AsyncSession, attempt: AutoproctorAttempt) -> bool:
    """Link an attempt to one of our AutoProctor assessments for the same email.

    Preference: an assessment whose link carries this attempt's test id
    (pending first, then any not-yet-linked one); failing that, the candidate's
    only pending AutoProctor assessment. Anything more ambiguous stays
    unmatched for HR to link by hand."""
    rows = (await db.execute(
        select(Assessment)
        .join(Application, Application.id == Assessment.application_id)
        .join(User, User.id == Application.applicant_id)
        .where(
            func.lower(User.email) == attempt.candidate_email.lower(),
            Assessment.status != "cancelled",
            is_autoproctor_link(),
        )
        .order_by(Assessment.created_at.desc())
    )).scalars().all()
    if not rows:
        return False

    linked = set((await db.execute(
        select(AutoproctorAttempt.assessment_id).where(
            AutoproctorAttempt.assessment_id.in_([a.id for a in rows]),
            AutoproctorAttempt.id != attempt.id,
        )
    )).scalars().all())

    same_test = [a for a in rows if test_label_from_link(a.platform_link) == attempt.test_label]
    choice = (
        next((a for a in same_test if a.status == "pending"), None)
        or next((a for a in same_test if a.id not in linked), None)
    )
    if choice is None:
        pending = [a for a in rows if a.status == "pending"]
        choice = pending[0] if len(pending) == 1 else None
    if choice is None:
        return False

    attempt.assessment_id, attempt.application_id, attempt.match_method = choice.id, choice.application_id, "auto"
    _apply_completion(choice, attempt)
    return True


async def _refresh_scores(db: AsyncSession, attempt: AutoproctorAttempt, row: dict) -> None:
    """A seen attempt can still change — manual grading finishes later. Pick
    up the new score from the list row without re-scraping the PDFs."""
    pct = row.get("percentage_scored_times_hundred")
    pct = None if pct is None else round(pct / 100, 2)
    graded, trust = bool(row.get("graded")), row.get("trust_score_pct")
    if (pct, graded, trust) == (attempt.percentage_scored, attempt.graded, attempt.trust_score_pct):
        return
    attempt.percentage_scored, attempt.graded, attempt.trust_score_pct = pct, graded, trust
    if pct is not None and attempt.points_available:
        attempt.points_scored = round(attempt.points_available * pct / 100, 2)
    if attempt.assessment_id:
        assessment = await db.get(Assessment, attempt.assessment_id)
        if assessment and assessment.status in ("completed", "evaluated"):
            _apply_completion(assessment, attempt)
    elif attempt.match_method != "manual":
        await match_attempt(db, attempt)


def _ist_day_start(day: date) -> datetime:
    return datetime.combine(day, dtime.min, tzinfo=IST).astimezone(timezone.utc)


async def run_sync(
    db: AsyncSession,
    trigger: str = "schedule",
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    run_id: Optional[uuid.UUID] = None,
) -> dict:
    """Import attempts, act on graded results, then (nightly only) auto-drop.

    run_id: the "queued" row HR's click created (manual runs); the nightly
    run creates its own.

    With date_from/date_to (IST calendar days, inclusive) it imports exactly
    the attempts started in that window — HR's manual "scrape this range".
    Without them it's the nightly incremental run. Either way an attempt
    already stored is never scraped again (attempt_label is unique), so
    overlapping ranges and re-runs only fetch what's missing; stored ones
    just pick up a changed score from the list row.

    Follow-ups only run on the nightly schedule: a manual range import is a
    data fetch, and HR clicking it shouldn't email or drop anyone as a side
    effect."""
    lock_conn = await db.bind.connect()
    try:
        run_id = await _claim_run(db, lock_conn, trigger, date_from, date_to, run_id)
        if run_id is None:
            return {"skipped": "another sync is running"}
        return await _run_locked(db, run_id, trigger, date_from, date_to)
    finally:
        try:
            await lock_conn.execute(select(func.pg_advisory_unlock(SYNC_LOCK_KEY)))
            await lock_conn.commit()
        finally:
            await lock_conn.close()


async def _run_locked(db: AsyncSession, run_id: uuid.UUID, trigger: str,
                      date_from: Optional[date], date_to: Optional[date]) -> dict:
    from celery.exceptions import SoftTimeLimitExceeded
    from app.services.autoproctor_scraper import AutoproctorSession

    # Plain counters, not run.* attributes: a per-attempt rollback expires
    # every loaded ORM object, and touching an expired one in async
    # SQLAlchemy lazy-loads and crashes the whole run.
    stats = dict(seen=0, imported=0, matched=0, failed=0, skipped=0)
    failed_emails: set[str] = set()
    status, error = "success", None
    try:
        if date_from:
            since = _ist_day_start(date_from)
            until = _ist_day_start((date_to or date_from) + timedelta(days=1))
        else:
            since, until = await _list_since(db), None

        async with AutoproctorSession() as ap:
            rows = await ap.list_attempts(since)
            if until:
                rows = [r for r in rows if (_row_started(r) or since) < until]
            stats["seen"] = len(rows)
            await _update_run(db, run_id, attempts_seen=stats["seen"])
            labels = [r["label"] for r in rows]
            existing = set((await db.execute(
                select(AutoproctorAttempt.attempt_label).where(AutoproctorAttempt.attempt_label.in_(labels))
            )).scalars().all()) if labels else set()

            # Already-stored attempts first, while nothing has been rolled back.
            for row in rows:
                if row["label"] in existing:
                    stats["skipped"] += 1
                    try:
                        attempt = (await db.execute(
                            select(AutoproctorAttempt).where(AutoproctorAttempt.attempt_label == row["label"])
                        )).scalar_one()
                        await _refresh_scores(db, attempt, row)
                        await db.commit()
                    except SoftTimeLimitExceeded:
                        raise
                    except Exception:
                        await db.rollback()
                        logger.exception(f"AutoProctor attempt {row['label']}: score refresh failed")
            await _update_run(db, run_id, attempts_skipped=stats["skipped"])

            workbooks: dict[str, Optional[bytes]] = {}
            for row in rows:
                label = row["label"]
                if label in existing:
                    continue
                try:
                    data = await ap.scrape_attempt(label)
                    test_label = data["test_label"]
                    if test_label not in workbooks:
                        try:
                            workbooks[test_label] = await ap.download_test_responses(label)
                        except Exception:
                            logger.exception(f"AutoProctor test {test_label}: responses download failed")
                            workbooks[test_label] = None
                    attempt = await _store_attempt(db, data, workbooks[test_label])
                    if await match_attempt(db, attempt):
                        stats["matched"] += 1
                    await db.commit()
                    stats["imported"] += 1
                except SoftTimeLimitExceeded:
                    # Not an attempt failure: the task is out of time. Stop the
                    # run cleanly so it's recorded as finished, not left "running".
                    raise
                except Exception:
                    await db.rollback()
                    stats["failed"] += 1
                    failed_emails.add(((row.get("test_taker") or {}).get("email") or "").lower())
                    logger.exception(f"AutoProctor attempt {label}: import failed")
                # Live progress for the page's status line.
                await _update_run(db, run_id, attempts_imported=stats["imported"],
                                  attempts_matched=stats["matched"], attempts_failed=stats["failed"])
    except SoftTimeLimitExceeded:
        await db.rollback()
        status = "failed"
        error = (f"Stopped at the 3-hour limit after importing {stats['imported']} attempts. "
                 "Run the same date range again to continue; attempts already imported are skipped.")
        logger.warning(f"AutoProctor sync hit the time limit: {stats}")
    except Exception as exc:
        await db.rollback()
        status, error = "failed", f"{type(exc).__name__}: {exc}"[:2000]
        logger.exception("AutoProctor sync failed")

    await _update_run(db, run_id, status=status, error=error, finished_at=_now(),
                      attempts_seen=stats["seen"], attempts_imported=stats["imported"],
                      attempts_matched=stats["matched"], attempts_failed=stats["failed"],
                      attempts_skipped=stats["skipped"])

    # Results decide on every run, manual included: they act on real scores,
    # unlike the drop, which acts on an absence of data.
    advanced = rejected = 0
    try:
        out = await process_outcomes(db)
        advanced, rejected = out["advanced"], out["rejected"]
        await _update_run(db, run_id, candidates_advanced=advanced, candidates_rejected=rejected)
    except Exception:
        await db.rollback()
        logger.exception("AutoProctor outcomes failed")

    dropped = 0
    if trigger == "schedule":
        try:
            dropped = (await process_followups(db, failed_emails))["dropped"]
            await _update_run(db, run_id, candidates_dropped=dropped)
        except Exception:
            await db.rollback()
            logger.exception("AutoProctor auto-drop failed")

    return {"status": status, **stats, "advanced": advanced, "rejected": rejected, "dropped": dropped, "error": error}


def _row_started(row: dict) -> Optional[datetime]:
    from app.services.autoproctor_scraper import _parse_dt
    return _parse_dt(row.get("test_client_start_time"))


async def _update_run(db: AsyncSession, run_id: uuid.UUID, **values) -> None:
    await db.execute(update(AutoproctorSyncRun).where(AutoproctorSyncRun.id == run_id).values(**values))
    await db.commit()


# ── Reminders and auto-drop ──────────────────────────────────────────────────

async def _pending_rows(db: AsyncSession):
    """AutoProctor assessments still pending for candidates sitting in the
    assessment stage — the only people the auto-drop can apply to."""
    return (await db.execute(
        select(Assessment, Application, User, Job)
        .join(Application, Application.id == Assessment.application_id)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .where(
            Assessment.status == "pending",
            is_autoproctor_link(),
            Application.stage == "assessment",
            Application.on_hold.is_(False),
        )
        .order_by(Assessment.created_at)
    )).all()


async def _still_in_assessment(db: AsyncSession, application_id: uuid.UUID) -> bool:
    """Lock the application row and confirm it's still sitting in the
    assessment stage and not on hold. Candidates in any other stage are never
    reminded or dropped, whatever their assessment status."""
    row = (await db.execute(
        select(Application.stage, Application.on_hold)
        .where(Application.id == application_id)
        .with_for_update()
    )).first()
    return bool(row) and row.stage == "assessment" and not row.on_hold


# Where a cleared candidate goes when the job doesn't say: the order each
# pipeline already ran in (agency candidates take the HR screening call after
# their assessment; direct and campus go straight to TR1).
DEFAULT_PASS_STAGE = {"direct": "tr1", "agency": "screening", "campus": "tr1"}


def next_round_after_assessment(source: Optional[str], job_choice: Optional[str] = None) -> str:
    """The job's own choice (jobs.assessment_pass_stage) when it's a legal
    move for this candidate's pipeline, else the source default."""
    from app.constants.stages import valid_transitions_for
    allowed = valid_transitions_for(source).get("assessment", [])
    if job_choice and job_choice in allowed:
        return job_choice
    default = DEFAULT_PASS_STAGE.get(source or "direct", "tr1")
    return default if default in allowed else allowed[0]


async def process_outcomes(db: AsyncSession) -> dict:
    """Act on graded results: clear the bar (score >= 75% and trust >= 90%)
    -> next round; otherwise -> Rejected, rejection email sent immediately. Only for
    candidates still in the assessment stage and not on hold; each attempt
    is decided once (decision column), so later syncs never re-move anyone.
    Ungraded attempts wait until AutoProctor finishes grading them."""
    from app.services import application_service

    rows = (await db.execute(
        select(AutoproctorAttempt.id, AutoproctorAttempt.application_id, AutoproctorAttempt.percentage_scored,
               AutoproctorAttempt.trust_score_pct, Application.source, Job.assessment_pass_stage)
        .join(Application, Application.id == AutoproctorAttempt.application_id)
        .join(Job, Job.id == Application.job_id)
        .where(
            AutoproctorAttempt.decision.is_(None),
            AutoproctorAttempt.assessment_id.is_not(None),
            AutoproctorAttempt.graded.is_(True),
            AutoproctorAttempt.percentage_scored.is_not(None),
            AutoproctorAttempt.trust_score_pct.is_not(None),
        )
        .order_by(AutoproctorAttempt.finished_at)
    )).all()

    advanced = rejected = 0
    for attempt_id, app_id, pct, trust, source, pass_stage in rows:
        app_row = (await db.execute(
            select(Application.stage, Application.on_hold).where(Application.id == app_id).with_for_update()
        )).first()
        if not app_row or app_row.on_hold:
            await db.rollback()  # on hold: decide once HR resumes them
            continue
        if app_row.stage != "assessment":
            await db.execute(update(AutoproctorAttempt).where(AutoproctorAttempt.id == attempt_id)
                             .values(decision="skipped", decided_at=_now()))
            await db.commit()
            continue

        cleared = pct >= SCORE_BAR and trust >= TRUST_BAR
        result = f"score {pct:g}%, trust {trust}%"
        try:
            if cleared:
                await application_service.move_stage(
                    db, app_id, next_round_after_assessment(source, pass_stage), None,
                    notes=f"Moved automatically — cleared the assessment ({result})",
                )
            else:
                await application_service.move_stage(
                    db, app_id, "rejected", None,
                    notes=f"Moved automatically — assessment below the bar ({result})",
                    rejection_reason=(f"Assessment below the bar: {result} "
                                      f"(needs {SCORE_BAR:g}% score and {TRUST_BAR}% trust)"),
                )
        except HTTPException as exc:
            await db.rollback()
            logger.warning(f"Assessment outcome not applied to application {app_id}: {exc.detail}")
            continue
        await db.execute(update(AutoproctorAttempt).where(AutoproctorAttempt.id == attempt_id)
                         .values(decision="advanced" if cleared else "rejected", decided_at=_now()))
        await db.commit()
        if cleared:
            advanced += 1
        else:
            rejected += 1
    return {"advanced": advanced, "rejected": rejected}


async def process_followups(db: AsyncSession, failed_emails: set[str] = frozenset(), dry_run: bool = False) -> dict:
    """dry_run: report who WOULD be reminded/dropped without emailing or
    moving anyone — for checking the sweep against real data safely."""
    from app.services import application_service

    last = await last_successful_run(db)
    if not last or last.started_at < _now() - SYNC_FRESHNESS:
        logger.warning("AutoProctor follow-ups skipped: no successful sync in the last 26h")
        return {"dropped": 0, "skipped": True}

    now = _now()
    dropped = 0
    would = {"drop": []}
    # Snapshot to plain values up front: move_stage commits and a failed move
    # rolls back, and either would expire ORM rows we'd still be iterating.
    items = [{
        "assessment_id": a.id, "application_id": app.id, "created_at": a.created_at,
        "due": drop_due_at(a), "title": a.title,
        "platform_link": a.platform_link, "duration_mins": a.duration_mins,
        "email": candidate.email, "full_name": candidate.full_name, "job_title": job.title,
    } for a, app, candidate, job in await _pending_rows(db)]

    for it in items:
        # A second assessment for the same application already done means
        # this one is redundant, not ignored.
        done_elsewhere = (await db.execute(
            select(Assessment.id).where(
                Assessment.application_id == it["application_id"],
                Assessment.id != it["assessment_id"],
                Assessment.status.in_(COMPLETED_STATUSES),
            ).limit(1)
        )).first()
        if done_elsewhere:
            continue

        if now >= it["due"]:
            if (it["email"] or "").lower() in failed_emails:
                continue
            if dry_run:
                would["drop"].append({"application_id": str(it["application_id"]), "email": it["email"], "due": it["due"]})
                continue
            # Re-check under the row lock: the list above was read earlier,
            # and HR may have moved the candidate on since (TR1 -> Interview
            # Drop is also a legal move, so move_stage alone wouldn't refuse).
            if not await _still_in_assessment(db, it["application_id"]):
                await db.rollback()
                continue
            try:
                await application_service.move_stage(
                    db, it["application_id"], "interview_drop", None,
                    notes="Moved automatically — assessment not completed within 30 days",
                    rejection_reason="Assessment not completed within 30 days of being sent",
                    drop_category=DROP_CATEGORY,
                )
                await db.execute(update(Assessment).where(Assessment.id == it["assessment_id"]).values(status="expired"))
                await db.commit()
                dropped += 1
            except HTTPException as exc:
                await db.rollback()
                logger.warning(f"Auto-drop skipped for application {it['application_id']}: {exc.detail}")
            continue

    if dry_run:
        return {"dropped": 0, "would": would}
    return {"dropped": dropped}


async def send_reminders(db: AsyncSession, dry_run: bool = False) -> dict:
    """Day-3 and day-6 reminders for AutoProctor assessments still unsubmitted
    by candidates still in the assessment stage.

    Same safety gate as the auto-drop: only after a nightly sync succeeded in
    the last 26h, so a broken sync can't remind people who already finished.
    Catches up without spamming: an assessment that's past day 6 with no
    reminder yet (e.g. it predates this feature) gets ONE email, counted as
    both. Each send is claimed with a conditional UPDATE on reminder_count
    first, so an overlapping run can never email anyone twice."""
    from app.services.email_service import send_email
    from app.utils.timezone import format_ist

    last = await last_successful_run(db)
    if not last or last.started_at < _now() - SYNC_FRESHNESS:
        logger.warning("Assessment reminders skipped: no successful AutoProctor sync in the last 26h")
        return {"sent": 0, "skipped": True}

    now = _now()
    items = [{
        "assessment_id": a.id, "application_id": app.id, "created_at": a.created_at, "deadline": a.deadline,
        "count": a.reminder_count or 0, "drop_at": drop_due_at(a), "title": a.title,
        "platform_link": a.platform_link, "duration_mins": a.duration_mins,
        "email": candidate.email, "full_name": candidate.full_name, "job_title": job.title,
    } for a, app, candidate, job in await _pending_rows(db)]

    sent, would = 0, []
    for it in items:
        due = sum(1 for d in REMINDER_DAYS if now >= it["created_at"] + timedelta(days=d))
        if due <= it["count"] or now >= it["drop_at"]:
            continue
        done_elsewhere = (await db.execute(
            select(Assessment.id).where(
                Assessment.application_id == it["application_id"],
                Assessment.id != it["assessment_id"],
                Assessment.status.in_(COMPLETED_STATUSES),
            ).limit(1)
        )).first()
        if done_elsewhere:
            continue
        if dry_run:
            would.append({"email": it["email"], "reminder": due})
            continue
        if not await _still_in_assessment(db, it["application_id"]):
            await db.rollback()
            continue
        claimed = (await db.execute(
            update(Assessment)
            .where(Assessment.id == it["assessment_id"], Assessment.reminder_count == it["count"])
            .values(reminder_count=due, reminder_sent_at=now)
            .returning(Assessment.id)
        )).first()
        await db.commit()
        if not claimed:
            continue
        # Point them at the deadline they were given while it's still ahead,
        # otherwise at the last day before they're dropped.
        complete_by = it["deadline"] if it["deadline"] and it["deadline"] > now else it["drop_at"]
        ok = await send_email(
            to_email=it["email"],
            subject=(f"Reminder: complete your assessment for {it['job_title']}" if due == 1
                     else f"Second reminder: your assessment for {it['job_title']} is still pending"),
            template_name="assessment_reminder",
            context={
                "full_name": it["full_name"],
                "job_title": it["job_title"],
                "assessment_title": it["title"],
                "platform_link": it["platform_link"],
                "complete_by": format_ist(complete_by),
                "duration_mins": it["duration_mins"],
            },
        )
        if ok:
            sent += 1
        else:
            logger.error(f"Assessment reminder failed for {it['email']}")
    return {"sent": 0, "would": would} if dry_run else {"sent": sent}


# ── Read side (router) ───────────────────────────────────────────────────────

def attempt_dict(a: AutoproctorAttempt, app: Optional[Application] = None, candidate: Optional[User] = None,
                 job: Optional[Job] = None, include_responses: bool = False) -> dict:
    from app.services.autoproctor_scraper import report_url

    out = {
        "id": str(a.id),
        "attempt_label": a.attempt_label,
        "test_label": a.test_label,
        "test_title": a.test_title,
        "candidate_email": a.candidate_email,
        "candidate_name": a.candidate_name,
        "started_at": a.started_at,
        "finished_at": a.finished_at,
        "duration_seconds": a.duration_seconds,
        "device_type": a.device_type,
        "trust_score_pct": a.trust_score_pct,
        "percentage_scored": a.percentage_scored,
        "points_scored": a.points_scored,
        "points_available": a.points_available,
        "graded": a.graded,
        "violations": a.violations or {},
        "violation_total": sum(v for v in (a.violations or {}).values() if isinstance(v, int)),
        "aux_device_verified": a.aux_device_verified,
        "responses_file_url": storage_service.refresh_url(a.responses_file_url) if a.responses_file_url else None,
        "proctoring_report_url": storage_service.refresh_url(a.proctoring_report_url) if a.proctoring_report_url else None,
        "aux_report_url": storage_service.refresh_url(a.aux_report_url) if a.aux_report_url else None,
        "autoproctor_url": report_url(a.attempt_label),
        "assessment_id": str(a.assessment_id) if a.assessment_id else None,
        "application_id": str(a.application_id) if a.application_id else None,
        "match_method": a.match_method,
        "decision": a.decision,
        "decided_at": a.decided_at,
        "question_count": len(a.responses or []),
        "application": None,
    }
    if app is not None:
        out["application"] = {
            "id": str(app.id),
            "stage": app.stage,
            "candidate_name": candidate.full_name if candidate else None,
            "job_title": job.title if job else None,
        }
    if include_responses:
        out["responses"] = a.responses or []
    return out


async def list_attempts(db: AsyncSession, *, q: Optional[str] = None, test_label: Optional[str] = None,
                        match: str = "all", application_id: Optional[uuid.UUID] = None,
                        limit: int = 200) -> list[dict]:
    stmt = (
        select(AutoproctorAttempt, Application, User, Job)
        .outerjoin(Application, Application.id == AutoproctorAttempt.application_id)
        .outerjoin(User, User.id == Application.applicant_id)
        .outerjoin(Job, Job.id == Application.job_id)
    )
    if application_id:
        stmt = stmt.where(AutoproctorAttempt.application_id == application_id)
    if test_label:
        stmt = stmt.where(AutoproctorAttempt.test_label == test_label)
    if match == "matched":
        stmt = stmt.where(AutoproctorAttempt.assessment_id.is_not(None))
    elif match == "unmatched":
        stmt = stmt.where(AutoproctorAttempt.assessment_id.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            AutoproctorAttempt.candidate_email.ilike(like),
            AutoproctorAttempt.candidate_name.ilike(like),
            AutoproctorAttempt.test_title.ilike(like),
        ))
    stmt = stmt.order_by(AutoproctorAttempt.finished_at.desc().nulls_last()).limit(limit)
    return [attempt_dict(a, app, u, j, include_responses=bool(application_id))
            for a, app, u, j in (await db.execute(stmt)).all()]


async def get_attempt(db: AsyncSession, attempt_id: uuid.UUID) -> dict:
    a = await db.get(AutoproctorAttempt, attempt_id)
    if not a:
        raise HTTPException(404, "Attempt not found")
    app = await db.get(Application, a.application_id) if a.application_id else None
    candidate = await db.get(User, app.applicant_id) if app else None
    job = await db.get(Job, app.job_id) if app else None
    return attempt_dict(a, app, candidate, job, include_responses=True)


async def pending_assessments(db: AsyncSession) -> list[dict]:
    now = _now()
    out = []
    for a, app, candidate, job in await _pending_rows(db):
        due = drop_due_at(a)
        out.append({
            "assessment_id": str(a.id),
            "application_id": str(app.id),
            "title": a.title,
            "test_label": test_label_from_link(a.platform_link),
            "candidate_name": candidate.full_name,
            "candidate_email": candidate.email,
            "job_title": job.title,
            "scheduled_at": a.created_at,
            "deadline": a.deadline,
            "drop_at": due,
            "reminders_sent": a.reminder_count or 0,
            "last_reminder_at": a.reminder_sent_at,
            "next_reminder_at": next(
                (a.created_at + timedelta(days=d) for i, d in enumerate(REMINDER_DAYS) if i >= (a.reminder_count or 0)), None),
            "days_left": max(0, (due - now).days),
            "overdue": now >= due,
        })
    return out


async def summary(db: AsyncSession) -> dict:
    await reap_dead_runs(db)
    now = _now()
    week_ago = now - timedelta(days=7)
    completed_7d, avg_score, avg_trust = (await db.execute(
        select(func.count(), func.avg(AutoproctorAttempt.percentage_scored), func.avg(AutoproctorAttempt.trust_score_pct))
        .where(AutoproctorAttempt.finished_at >= week_ago)
    )).one()
    unmatched = (await db.execute(
        select(func.count()).select_from(AutoproctorAttempt).where(AutoproctorAttempt.assessment_id.is_(None))
    )).scalar_one()
    pending = await pending_assessments(db)
    last = (await db.execute(
        select(AutoproctorSyncRun).order_by(AutoproctorSyncRun.started_at.desc()).limit(1)
    )).scalar_one_or_none()
    good = await last_successful_run(db)
    # Any finished run, nightly or a manual range, counts as "last synced".
    last_synced_at = (await db.execute(
        select(AutoproctorSyncRun.finished_at).where(AutoproctorSyncRun.status == "success")
        .order_by(AutoproctorSyncRun.finished_at.desc().nulls_last()).limit(1)
    )).scalar_one_or_none()
    return {
        "enabled": settings.AUTOPROCTOR_ENABLED,
        "completed_7d": completed_7d,
        "avg_score_7d": round(avg_score, 1) if avg_score is not None else None,
        "avg_trust_7d": round(avg_trust, 1) if avg_trust is not None else None,
        "awaiting": len(pending),
        "drop_within_2d": sum(1 for p in pending if p["drop_at"] - now <= timedelta(days=2)),
        "unmatched": unmatched,
        "last_run": run_dict(last) if last else None,
        "last_success_at": good.finished_at if good else None,
        "last_synced_at": last_synced_at,
    }


def run_dict(r: AutoproctorSyncRun) -> dict:
    return {
        "id": str(r.id), "started_at": r.started_at, "finished_at": r.finished_at, "status": r.status,
        "trigger": r.trigger, "attempts_seen": r.attempts_seen, "attempts_imported": r.attempts_imported,
        "attempts_matched": r.attempts_matched, "attempts_failed": r.attempts_failed,
        "reminders_sent": r.reminders_sent, "candidates_dropped": r.candidates_dropped, "error": r.error,
        "attempts_skipped": r.attempts_skipped, "range_from": r.range_from, "range_to": r.range_to,
        "candidates_advanced": r.candidates_advanced, "candidates_rejected": r.candidates_rejected,
    }


async def linkable_applications(db: AsyncSession, q: str) -> list[dict]:
    """Candidates an unmatched attempt can be linked to — searched by name or
    email across EVERY stage (a candidate may have sat the test before being
    moved to Assessment, or under another email). Each row carries the
    candidate's latest AutoProctor assessment if they have one; linking a
    row without one creates it (link_attempt)."""
    like = f"%{q.strip()}%"
    rows = (await db.execute(
        select(Application, User, Job)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .where(or_(User.full_name.ilike(like), User.email.ilike(like)))
        .order_by(Application.applied_at.desc()).limit(25)
    )).all()
    app_ids = [app.id for app, _, _ in rows]
    latest: dict = {}
    if app_ids:
        for a in (await db.execute(
            select(Assessment).where(Assessment.application_id.in_(app_ids), Assessment.status != "cancelled",
                                     is_autoproctor_link())
            .order_by(Assessment.created_at.desc())
        )).scalars().all():
            latest.setdefault(a.application_id, a)
    out = []
    for app, u, j in rows:
        a = latest.get(app.id)
        out.append({
            "application_id": str(app.id), "candidate_name": u.full_name, "candidate_email": u.email,
            "job_title": j.title, "stage": app.stage,
            "assessment_id": str(a.id) if a else None,
            "assessment_title": a.title if a else None,
            "assessment_status": a.status if a else None,
        })
    return out


async def link_attempt(db: AsyncSession, attempt_id: uuid.UUID, assessment_id: Optional[uuid.UUID],
                       application_id: Optional[uuid.UUID] = None, linked_by: Optional[uuid.UUID] = None) -> dict:
    """Manually (re)link an attempt to an assessment, or to an application
    that has no AutoProctor assessment yet (one is created for it, quietly —
    no email, no stage move), or unlink it when both ids are None. Undoes the
    completion the attempt had written on its previous assessment. Any result
    decision (advance/reject) happens on the next sync, not here, so a wrong
    link can still be fixed before it moves anyone."""
    from app.services.autoproctor_scraper import BASE

    attempt = await db.get(AutoproctorAttempt, attempt_id)
    if not attempt:
        raise HTTPException(404, "Attempt not found")

    if assessment_id is None and application_id is not None:
        app = await db.get(Application, application_id)
        if not app:
            raise HTTPException(404, "Application not found")
        existing = (await db.execute(
            select(Assessment).where(Assessment.application_id == app.id, Assessment.status != "cancelled",
                                     is_autoproctor_link())
            .order_by(Assessment.created_at.desc()).limit(1)
        )).scalar_one_or_none()
        if existing is None:
            existing = Assessment(
                application_id=app.id, title=attempt.test_title, assessment_type="online_test",
                platform_link=f"{BASE}/tests/{attempt.test_label}/instructions/",
                status="pending", created_by=linked_by,
            )
            db.add(existing)
            await db.flush()
        assessment_id = existing.id

    if attempt.assessment_id and attempt.assessment_id != assessment_id:
        previous = await db.get(Assessment, attempt.assessment_id)
        if previous and previous.status == "completed":
            previous.status, previous.completed_at, previous.score, previous.max_score = "pending", None, None, None

    if assessment_id is None:
        attempt.assessment_id = attempt.application_id = None
        attempt.match_method = "manual"
    else:
        assessment = await db.get(Assessment, assessment_id)
        if not assessment or assessment.status == "cancelled":
            raise HTTPException(404, "Assessment not found")
        attempt.assessment_id, attempt.application_id, attempt.match_method = assessment.id, assessment.application_id, "manual"
        _apply_completion(assessment, attempt)
    await db.commit()
    return await get_attempt(db, attempt.id)


async def recent_runs(db: AsyncSession, limit: int = 15) -> list[dict]:
    rows = (await db.execute(
        select(AutoproctorSyncRun).order_by(AutoproctorSyncRun.started_at.desc()).limit(limit)
    )).scalars().all()
    return [run_dict(r) for r in rows]
