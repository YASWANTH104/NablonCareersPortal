"""Action Center: for every in-flight application, what has to happen next,
who has to do it, and how late it is.

Model
-----
Each active application gets exactly ONE primary "next action" derived from
where it actually is (stage + its interviews / assessments / offer / screening
questionnaire), plus a couple of stage-independent flags (duplicate review,
pre-boarding documents). This is deliberately not a bag of independent alert
rules: a bag fires "stuck 6 days" AND "schedule TR1" AND "no owner" for the
same person, and a list where every row says three things gets ignored.

Severity
--------
  waiting  -> the ball is in someone else's court (candidate, director,
              upcoming interview). Shown for the "who is where" picture, never
              counted in badges or the digest.
  due      -> action needed from the handler, still inside its SLA.
  overdue  -> past its SLA.
Some waiting states escalate to "due" after a grace period (offer sent but no
response, director sitting on an approval, a long hold).

Ownership
---------
handler = assigned_to, else owner_id (first mover), else nobody — in which
case the item is "unclaimed" and is routed to whoever posted the job, so a
brand-new application still lands in a real person's queue.

SLAs are calendar days, tuned in SLA_DAYS below.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.constants.stages import STAGE_LABELS, TERMINAL_STAGES, ROUND_LABELS, valid_transitions_for
from app.models.application import Application
from app.models.action_snooze import ActionSnooze
from app.models.assessment import Assessment
from app.models.document import DocumentRequest
from app.models.interview import Interview, InterviewPanelist, InterviewFeedback
from app.models.job import Job
from app.models.offer import OfferLetter
from app.models.screening import ScreeningResponse
from app.models.user import User

ROUND_STAGES = ("screening", "tr1", "tr2", "final_tr", "hr")

SLA_DAYS = {
    "review_new": 2,
    "review_screening": 2,
    "schedule_round": 2,
    "reschedule_round": 1,
    "chase_feedback": 1,
    "decide_round": 1,
    "send_assessment": 2,
    "assessment_overdue": 1,
    "evaluate_assessment": 2,
    "decide_assessment": 1,
    "create_offer": 2,
    "send_offer": 2,
    "nudge_director": 4,       # escalates from waiting after 2 days
    "revise_offer": 1,
    "follow_up_offer": 5,      # escalates from waiting after 3 days
    "close_offer": 1,
    "mark_hired": 1,
    "collect_documents": 3,
    "review_hold": 14,         # escalates from waiting after 7 days
    "review_duplicate": 2,
}
DIRECTOR_GRACE_DAYS = 2
OFFER_RESPONSE_GRACE_DAYS = 3
HOLD_GRACE_DAYS = 7

CATEGORIES = {
    "triage": "Triage",
    "interviews": "Interviews",
    "feedback": "Feedback & decisions",
    "assessment": "Assessments",
    "offer": "Offer & joining",
    "hold": "On hold",
    "hygiene": "Data hygiene",
}

SEVERITY_ORDER = {"overdue": 0, "due": 1, "waiting": 2}
_POSITIVE = {"strong_yes", "yes"}
_NEGATIVE = {"strong_no", "no"}


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _days(delta: timedelta) -> float:
    return round(delta.total_seconds() / 86400, 1)


def _fmt_day(dt: datetime | None) -> str:
    from app.utils.timezone import IST
    return _aware(dt).astimezone(IST).strftime("%d %b") if dt else "—"


def _fmt_slot(dt: datetime | None) -> str:
    from app.utils.timezone import IST
    return _aware(dt).astimezone(IST).strftime("%d %b, %I:%M %p IST") if dt else "—"


def _round_label(stage: str) -> str:
    return ROUND_LABELS.get(stage, STAGE_LABELS.get(stage, stage))


async def compute_actions(db: AsyncSession, *, now: datetime | None = None) -> list[dict]:
    """Every action item across the whole pipeline, snoozed ones included
    (flagged via item["snoozed"]). Callers scope/filter."""
    now = now or datetime.now(timezone.utc)

    Candidate, Owner, Handler, Poster = aliased(User), aliased(User), aliased(User), aliased(User)
    apps = (await db.execute(
        select(
            Application,
            Candidate.full_name.label("candidate_name"), Candidate.email.label("candidate_email"),
            Job.title.label("job_title"), Job.posted_by.label("posted_by"),
            Owner.full_name.label("owner_name"), Handler.full_name.label("handler_name"),
            Poster.full_name.label("poster_name"),
        )
        .join(Candidate, Candidate.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .join(Owner, Owner.id == Application.owner_id, isouter=True)
        .join(Handler, Handler.id == Application.assigned_to, isouter=True)
        .join(Poster, Poster.id == Job.posted_by, isouter=True)
        .where(Application.stage.notin_(TERMINAL_STAGES))
    )).all()
    if not apps:
        return []

    by_stage: dict[str, list[uuid.UUID]] = {}
    for r in apps:
        by_stage.setdefault(r.Application.stage, []).append(r.Application.id)

    def ids_at(*stages):
        return [i for s in stages for i in by_stage.get(s, [])]

    # --- screening questionnaires (applied) — latest per application ---
    screening: dict = {}
    applied_ids = ids_at("applied")
    if applied_ids:
        for sr in (await db.execute(
            select(ScreeningResponse)
            .where(ScreeningResponse.application_id.in_(applied_ids))
            .order_by(ScreeningResponse.created_at)
        )).scalars().all():
            screening[sr.application_id] = sr

    # --- interviews + panel + feedback (round stages) ---
    interviews: dict = {}
    pending_fb: dict = {}     # interview_id -> [names of interviewers with no feedback]
    fb_summary: dict = {}     # interview_id -> {"yes","no","other","last_at"}
    round_ids = ids_at(*ROUND_STAGES)
    if round_ids:
        iv_rows = (await db.execute(
            select(Interview).where(Interview.application_id.in_(round_ids))
        )).scalars().all()
        for iv in iv_rows:
            interviews.setdefault(iv.application_id, []).append(iv)
        iv_ids = [iv.id for iv in iv_rows]
        if iv_ids:
            submitted = {}
            for f in (await db.execute(
                select(InterviewFeedback.interview_id, InterviewFeedback.submitted_by,
                       InterviewFeedback.recommendation, InterviewFeedback.created_at)
                .where(InterviewFeedback.interview_id.in_(iv_ids))
            )).all():
                submitted[(f.interview_id, f.submitted_by)] = f
                s = fb_summary.setdefault(f.interview_id, {"yes": 0, "no": 0, "other": 0, "last_at": None})
                key = "yes" if f.recommendation in _POSITIVE else "no" if f.recommendation in _NEGATIVE else "other"
                s[key] += 1
                if s["last_at"] is None or f.created_at > s["last_at"]:
                    s["last_at"] = f.created_at
            for p in (await db.execute(
                select(InterviewPanelist.interview_id, InterviewPanelist.user_id, User.full_name)
                .join(User, User.id == InterviewPanelist.user_id)
                .where(InterviewPanelist.interview_id.in_(iv_ids), InterviewPanelist.role == "interviewer")
            )).all():
                if (p.interview_id, p.user_id) not in submitted:
                    pending_fb.setdefault(p.interview_id, []).append(p.full_name)

    # --- assessments ---
    assessments: dict = {}
    asmt_ids = ids_at("assessment")
    if asmt_ids:
        for a in (await db.execute(
            select(Assessment)
            .where(Assessment.application_id.in_(asmt_ids), Assessment.status != "cancelled")
            .order_by(Assessment.created_at)
        )).scalars().all():
            assessments[a.application_id] = a

    # --- offers + pre-boarding documents ---
    offers: dict = {}
    doc_requests: dict = {}
    offer_ids = ids_at("offer")
    if offer_ids:
        for o in (await db.execute(
            select(OfferLetter).where(OfferLetter.application_id.in_(offer_ids))
        )).scalars().all():
            offers[o.application_id] = o
        for d in (await db.execute(
            select(DocumentRequest)
            .where(DocumentRequest.application_id.in_(offer_ids))
            .order_by(DocumentRequest.created_at)
        )).scalars().all():
            doc_requests[d.application_id] = d

    # --- active snoozes ---
    Snoozer = aliased(User)
    snoozes = {
        (s.ActionSnooze.application_id, s.ActionSnooze.action_type, s.ActionSnooze.stage): {
            "until": _aware(s.ActionSnooze.snoozed_until).isoformat(),
            "note": s.ActionSnooze.note,
            "by_name": s.snoozer_name,
        }
        for s in (await db.execute(
            select(ActionSnooze, Snoozer.full_name.label("snoozer_name"))
            .join(Snoozer, Snoozer.id == ActionSnooze.snoozed_by, isouter=True)
            .where(ActionSnooze.snoozed_until > now)
        )).all()
    }

    items: list[dict] = []

    for r in apps:
        app: Application = r.Application
        stage = app.stage
        stage_since = _aware(app.stage_updated_at)
        handler_id = app.assigned_to or app.owner_id
        handler_name = r.handler_name if app.assigned_to else r.owner_name

        def emit(type_, category, title, detail, since, *, waiting=False, tab="overview", action_label="Open",
                 sla=None):
            since = _aware(since) or stage_since
            sla_days = SLA_DAYS.get(type_) if sla is None else sla
            if waiting:
                severity, due_at = "waiting", None
            else:
                due_at = since + timedelta(days=sla_days or 0)
                severity = "overdue" if now > due_at else "due"
            items.append({
                "key": f"{app.id}:{type_}",
                "type": type_,
                "category": category,
                "category_label": CATEGORIES[category],
                "severity": severity,
                "title": title,
                "detail": detail,
                "action_label": action_label,
                "tab": tab,
                "since": since.isoformat(),
                "age_days": _days(now - since),
                "due_at": due_at.isoformat() if due_at else None,
                "overdue_by_days": _days(now - due_at) if due_at and now > due_at else 0,
                "application_id": str(app.id),
                "candidate_name": r.candidate_name,
                "candidate_email": r.candidate_email,
                "job_id": str(app.job_id),
                "job_title": r.job_title,
                "stage": stage,
                "stage_label": STAGE_LABELS.get(stage, stage),
                "days_in_stage": _days(now - stage_since),
                "source": app.source,
                "owner_id": str(app.owner_id) if app.owner_id else None,
                "owner_name": r.owner_name,
                "handler_id": str(handler_id) if handler_id else None,
                "handler_name": handler_name,
                "unclaimed": handler_id is None,
                "job_poster_id": str(r.posted_by) if r.posted_by else None,
                "job_poster_name": r.poster_name,
                "snoozed": snoozes.get((app.id, type_, stage)),
            })

        # ── stage-independent flags ──────────────────────────────────────
        if app.duplicate_flag and app.duplicate_reviewed_at is None:
            emit("review_duplicate", "hygiene", "Check possible duplicate",
                 app.duplicate_reason or "Another candidate account shares this name.",
                 app.applied_at, action_label="Review")

        # ── on hold replaces the stage action ────────────────────────────
        if app.on_hold:
            held_since = _aware(app.updated_at)
            reason = app.hold_reason or "No reason recorded"
            if now - held_since >= timedelta(days=HOLD_GRACE_DAYS):
                emit("review_hold", "hold", "Resume or close hold",
                     f"On hold {int(_days(now - held_since))} days · {reason}", held_since, action_label="Revisit")
            else:
                emit("on_hold", "hold", "On hold", reason, held_since, waiting=True)
            continue

        # ── applied ──────────────────────────────────────────────────────
        if stage == "applied":
            nxt = valid_transitions_for(app.source).get("applied", ["screening"])[0]
            sr = screening.get(app.id)
            if sr and sr.status == "pending":
                emit("await_screening", "triage", "Awaiting screening answers",
                     f"Link expires {_fmt_day(sr.expires_at)}", sr.created_at, waiting=True, tab="screening")
            elif sr and sr.status == "submitted":
                score = f"Score {round(float(sr.overall_score))}" if sr.overall_score is not None else "Not scored yet"
                rec = f" · {sr.recommendation.replace('_', ' ')}" if sr.recommendation else ""
                emit("review_screening", "triage", "Review screening answers",
                     f"{score}{rec}", sr.submitted_at or sr.updated_at, tab="screening", action_label="Review")
            else:
                emit("review_new", "triage", "Review application",
                     f"Next: {STAGE_LABELS.get(nxt, nxt)}", app.applied_at, action_label="Review")

        # ── interview rounds ─────────────────────────────────────────────
        elif stage in ROUND_STAGES:
            label = _round_label(stage)
            round_ivs = [
                iv for iv in interviews.get(app.id, [])
                if iv.round_type == stage
                or (iv.round_type is None and _aware(iv.created_at) >= stage_since - timedelta(minutes=5))
            ]
            round_ivs.sort(key=lambda iv: _aware(iv.scheduled_at))
            live = [iv for iv in round_ivs if iv.status in ("scheduled", "rescheduled")]
            upcoming = [iv for iv in live if _aware(iv.scheduled_at) + timedelta(minutes=iv.duration_mins or 60) > now]
            done = [iv for iv in round_ivs if iv.status == "completed"] + [iv for iv in live if iv not in upcoming]
            done.sort(key=lambda iv: _aware(iv.scheduled_at))
            missed = [iv for iv in round_ivs if iv.status in ("no_show", "cancelled")]

            if upcoming:
                iv = upcoming[0]
                emit("await_interview", "interviews", f"{label} booked",
                     _fmt_slot(iv.scheduled_at), iv.created_at, waiting=True, tab="interviews")
            elif done:
                iv = done[-1]
                ended = _aware(iv.scheduled_at) + timedelta(minutes=iv.duration_mins or 60)
                waiting_on = pending_fb.get(iv.id, [])
                if waiting_on:
                    emit("chase_feedback", "feedback", f"Chase {label} feedback",
                         "Waiting on " + ", ".join(sorted(waiting_on)), ended,
                         tab="interviews", action_label="Chase")
                else:
                    s = fb_summary.get(iv.id, {"yes": 0, "no": 0, "other": 0, "last_at": None})
                    verdict = f"{s['yes']} yes · {s['no']} no" + (f" · {s['other']} undecided" if s["other"] else "")
                    emit("decide_round", "feedback", f"Decide after {label}",
                         verdict, s["last_at"] or ended, tab="feedback", action_label="Decide")
            elif missed:
                iv = missed[-1]
                what = "No-show" if iv.status == "no_show" else "Cancelled"
                emit("reschedule_round", "interviews", f"Reschedule {label}",
                     f"{what} on {_fmt_slot(iv.scheduled_at)}", iv.updated_at,
                     tab="interviews", action_label="Reschedule")
            else:
                emit("schedule_round", "interviews", f"Schedule {label}",
                     "No interview booked yet", stage_since,
                     tab="interviews", action_label="Schedule")

        # ── assessment ───────────────────────────────────────────────────
        elif stage == "assessment":
            a = assessments.get(app.id)
            if a is None:
                emit("send_assessment", "assessment", "Send assessment",
                     "Nothing sent yet", stage_since,
                     tab="assessments", action_label="Send")
            elif a.status == "pending":
                if a.deadline and _aware(a.deadline) < now:
                    emit("assessment_overdue", "assessment", "Chase overdue assessment",
                         f"{a.title} · was due {_fmt_day(a.deadline)}", a.deadline,
                         tab="assessments", action_label="Follow up")
                else:
                    due = f"due {_fmt_day(a.deadline)}" if a.deadline else f"sent {_fmt_day(a.created_at)}"
                    emit("await_assessment", "assessment", "Awaiting assessment",
                         f"{a.title} · {due}", a.created_at, waiting=True, tab="assessments")
            elif a.status == "submitted":
                emit("evaluate_assessment", "assessment", "Evaluate assessment",
                     a.title, a.updated_at, tab="assessments", action_label="Evaluate")
            else:  # evaluated
                score = (
                    f"Scored {float(a.score):g}" + (f" / {float(a.max_score):g}" if a.max_score is not None else "")
                    if a.score is not None else "Evaluated"
                )
                emit("decide_assessment", "assessment", "Decide after assessment",
                     f"{a.title} · {score}", a.updated_at, tab="assessments", action_label="Decide")

        # ── offer ────────────────────────────────────────────────────────
        elif stage == "offer":
            o = offers.get(app.id)
            if o is None:
                emit("create_offer", "offer", "Create offer letter",
                     "No offer drafted yet", stage_since, tab="offer", action_label="Create")
            elif o.status == "draft":
                emit("send_offer", "offer", "Send offer letter", o.designation, o.created_at,
                     tab="offer", action_label="Send")
            elif o.status == "pending_director":
                pending_since = _aware(o.updated_at)
                if now - pending_since >= timedelta(days=DIRECTOR_GRACE_DAYS):
                    emit("nudge_director", "offer", "Nudge director for approval",
                         f"Pending since {_fmt_day(pending_since)}", pending_since, tab="offer", action_label="Nudge")
                else:
                    emit("await_director", "offer", "Awaiting director approval", o.designation,
                         pending_since, waiting=True, tab="offer")
            elif o.status == "director_rejected":
                emit("revise_offer", "offer", "Revise offer (director sent back)", o.designation,
                     o.updated_at, tab="offer", action_label="Revise")
            elif o.status == "sent":
                sent = _aware(o.sent_at or o.updated_at)
                if o.expires_at and _aware(o.expires_at) < now:
                    emit("close_offer", "offer", "Resolve expired offer",
                         f"Expired {_fmt_day(o.expires_at)}", o.expires_at, tab="offer", action_label="Resolve")
                elif now - sent >= timedelta(days=OFFER_RESPONSE_GRACE_DAYS):
                    exp = f" · expires {_fmt_day(o.expires_at)}" if o.expires_at else ""
                    emit("follow_up_offer", "offer", "Follow up on offer",
                         f"Sent {_fmt_day(sent)}{exp}", sent, tab="offer", action_label="Follow up")
                else:
                    exp = f"expires {_fmt_day(o.expires_at)}" if o.expires_at else f"sent {_fmt_day(sent)}"
                    emit("await_offer_response", "offer", "Awaiting offer response", exp,
                         sent, waiting=True, tab="offer")
            elif o.status == "accepted":
                accepted = o.signed_at or o.accepted_at or o.updated_at
                joining = f"Joining {o.joining_date.strftime('%d %b %Y')}" if o.joining_date else "Joining date not set"
                if o.candidate_signature:
                    emit("mark_hired", "offer", "Mark as hired", joining, accepted,
                         action_label="Mark hired")
                else:
                    emit("await_signature", "offer", "Awaiting offer signature", joining,
                         accepted, waiting=True, tab="offer")
                dr = doc_requests.get(app.id)
                if dr and dr.status != "complete":
                    emit("collect_documents", "offer", "Collect joining documents",
                         f"Requested {_fmt_day(dr.created_at)}", max(_aware(dr.created_at), _aware(accepted)),
                         tab="documents", action_label="Chase")
            elif o.status in ("rejected", "expired", "revoked"):
                what = {"rejected": "Declined", "expired": "Expired", "revoked": "Revoked"}[o.status]
                emit("close_offer", "offer", "Resolve offer", f"{what} · {o.designation}",
                     o.updated_at, tab="offer", action_label="Resolve")

    items.sort(key=lambda i: (SEVERITY_ORDER[i["severity"]], -i["overdue_by_days"], -i["age_days"]))
    return items


def in_scope(item: dict, scope: str, user_id: uuid.UUID | None) -> bool:
    uid = str(user_id) if user_id else None
    if scope == "mine":
        return item["handler_id"] == uid or (item["unclaimed"] and item["job_poster_id"] == uid)
    if scope == "unclaimed":
        return item["unclaimed"]
    return True


def summarize(items: list[dict]) -> dict:
    live = [i for i in items if not i["snoozed"]]
    by_category: dict = {}
    by_handler: dict = {}
    for i in live:
        if i["severity"] != "waiting":
            by_category[i["category"]] = by_category.get(i["category"], 0) + 1
        hkey = i["handler_id"] or "unclaimed"
        h = by_handler.setdefault(hkey, {
            "handler_id": i["handler_id"],
            "name": i["handler_name"] if i["handler_id"] else "Unclaimed",
            "overdue": 0, "due": 0, "waiting": 0,
        })
        h[i["severity"]] += 1
    return {
        "overdue": sum(1 for i in live if i["severity"] == "overdue"),
        "due": sum(1 for i in live if i["severity"] == "due"),
        "waiting": sum(1 for i in live if i["severity"] == "waiting"),
        "snoozed": sum(1 for i in items if i["snoozed"]),
        "by_category": [
            {"category": k, "label": CATEGORIES[k], "count": by_category.get(k, 0)} for k in CATEGORIES
        ],
        "by_handler": sorted(by_handler.values(), key=lambda h: (-h["overdue"], -h["due"], -h["waiting"])),
    }


async def snooze(
    db: AsyncSession, *, application_id: uuid.UUID, action_type: str, days: int, note: str | None,
    user_id: uuid.UUID,
) -> ActionSnooze:
    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")
    if app.stage in TERMINAL_STAGES:
        raise HTTPException(400, "This application is closed — nothing to snooze")
    # One live snooze per (application, action, stage): re-snoozing replaces it.
    await db.execute(delete(ActionSnooze).where(and_(
        ActionSnooze.application_id == application_id,
        ActionSnooze.action_type == action_type,
        ActionSnooze.stage == app.stage,
    )))
    row = ActionSnooze(
        application_id=application_id,
        action_type=action_type,
        stage=app.stage,
        snoozed_until=datetime.now(timezone.utc) + timedelta(days=days),
        note=(note or "").strip() or None,
        snoozed_by=user_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def unsnooze(db: AsyncSession, *, application_id: uuid.UUID, action_type: str) -> None:
    await db.execute(delete(ActionSnooze).where(and_(
        ActionSnooze.application_id == application_id,
        ActionSnooze.action_type == action_type,
    )))
    await db.commit()
