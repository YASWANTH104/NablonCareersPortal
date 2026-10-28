"""Weekly (Friday) and monthly (last day of month) hiring summary emails.

Metric definitions — kept here in one place because the email is read by
people who never open the Reports page, so the numbers must mean exactly one
thing:

- Interviews conducted: status == completed, bucketed by scheduled_at (IST).
  Same definition as the Interviewers report.
- Offers closed: a move INTO the hired stage inside the window (stage
  history, dated by the move). Credited to the partner agency when the
  candidate came via one, otherwise to the internal recruiter who owns the
  application (owner_id → sourced_by → "Unassigned").
- Panel: the set of interviewer-role panelists on a conducted interview
  (observers excluded). Two interviews with the same people = same panel.
- Open positions: published jobs; remaining = openings − hired to date.

Windows (all IST): weekly = Saturday 00:00 → send time, so a Friday 6 PM send
covers Sat–Fri. Monthly = 1st 00:00 → send time. Each is compared with the
same-length window one period earlier."""
import json
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime, date, time, timedelta, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.constants.stages import TERMINAL_STAGES
from app.models.agency import Agency
from app.models.application import Application, ApplicationStageHistory
from app.models.interview import Interview, InterviewPanelist, InterviewFeedback
from app.models.job import Job
from app.models.scheduled_report import ScheduledReportSettings
from app.models.user import User
from app.utils.timezone import IST

logger = logging.getLogger(__name__)

SEND_HOUR_IST = 18  # beat schedule in celery_app.py must match (12:30 UTC)
MAX_OPEN_POSITION_ROWS = 20
MAX_HIRE_ROWS = 25

_ROUND_SHORT = {"screening": "Screening", "tr1": "TR1", "tr2": "TR2", "final_tr": "Final TR", "hr": "HR"}
_GENDERED = re.compile(r"\b(he|she|him|his|her|hers|himself|herself)\b", re.IGNORECASE)
_SOURCE_LABELS = {
    "direct": "Direct", "referral": "Referral", "agency": "Partner",
    "talent_acquisition": "TA sourced", "campus": "Campus",
}


# ── Settings ────────────────────────────────────────────────────────────────

async def get_settings(db: AsyncSession) -> ScheduledReportSettings:
    """The migration seeds row 1; this only matters on a DB built via
    create_all (local/dev), where the seed never ran."""
    row = await db.get(ScheduledReportSettings, 1)
    if row is None:
        row = ScheduledReportSettings(id=1, recipients=[], weekly_enabled=True, monthly_enabled=True)
        db.add(row)
        await db.flush()
    return row


def is_last_day_of_month(d: date) -> bool:
    return (d + timedelta(days=1)).day == 1


def next_send_times(now: datetime) -> dict:
    local = now.astimezone(IST)
    weekly_day = local.date() + timedelta(days=(4 - local.weekday()) % 7)  # Friday
    weekly = datetime.combine(weekly_day, time(SEND_HOUR_IST), tzinfo=IST)
    if weekly <= local:
        weekly += timedelta(days=7)

    month_end = _month_end(local.date())
    monthly = datetime.combine(month_end, time(SEND_HOUR_IST), tzinfo=IST)
    if monthly <= local:
        monthly = datetime.combine(_month_end(month_end + timedelta(days=1)), time(SEND_HOUR_IST), tzinfo=IST)
    return {"weekly": weekly.isoformat(), "monthly": monthly.isoformat()}


def _month_end(d: date) -> date:
    first_next = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return first_next - timedelta(days=1)


# ── Windows ─────────────────────────────────────────────────────────────────

def _windows(kind: str, now: datetime) -> tuple[datetime, datetime, datetime, datetime]:
    """(start, end, prev_start, prev_end), tz-aware."""
    local = now.astimezone(IST)
    if kind == "weekly":
        saturday = local.date() - timedelta(days=(local.weekday() - 5) % 7)
        start = datetime.combine(saturday, time.min, tzinfo=IST)
        return start, now, start - timedelta(days=7), now - timedelta(days=7)

    start = datetime.combine(local.date().replace(day=1), time.min, tzinfo=IST)
    prev_start = datetime.combine((start.date() - timedelta(days=1)).replace(day=1), time.min, tzinfo=IST)
    # Same elapsed span into last month, capped at its end — so a mid-month
    # preview compares like with like rather than MTD vs a full month.
    prev_end = min(prev_start + (now - start), start)
    return start, now, prev_start, prev_end


def _period_label(kind: str, start: datetime, end: datetime) -> str:
    s, e = start.astimezone(IST), end.astimezone(IST)
    if kind == "monthly":
        return s.strftime("%B %Y")
    if s.month == e.month:
        return f"{s.day}–{e.day} {e.strftime('%b %Y')}"
    return f"{s.strftime('%d %b')} – {e.strftime('%d %b %Y')}"


def _delta(cur: int, prev: int) -> dict:
    if prev == 0:
        return {"text": "new" if cur else "no change", "dir": "up" if cur else "flat"}
    pct = round((cur - prev) / prev * 100)
    return {"text": f"{'+' if pct > 0 else ''}{pct}%", "dir": "up" if pct > 0 else "down" if pct < 0 else "flat"}


# ── Metrics ─────────────────────────────────────────────────────────────────

async def _interviews(db: AsyncSession, kind: str, start: datetime, end: datetime) -> dict:
    rows = (await db.execute(
        select(Interview.id, Interview.scheduled_at, Interview.status, Interview.round_type)
        .where(
            Interview.scheduled_at >= start,
            Interview.scheduled_at < end,
            Interview.status.in_(("completed", "cancelled", "no_show")),
        )
    )).all()
    conducted = [r for r in rows if r.status == "completed"]

    by_bucket: Counter = Counter()
    for r in conducted:
        by_bucket[_bucket_key(kind, r.scheduled_at.astimezone(IST).date(), start)] += 1

    by_round = Counter(_ROUND_SHORT.get(r.round_type, "Other") for r in conducted)
    return {
        "total": len(conducted),
        "cancelled": sum(1 for r in rows if r.status == "cancelled"),
        "no_show": sum(1 for r in rows if r.status == "no_show"),
        "buckets": [
            {"label": label, "count": by_bucket.get(key, 0)}
            for key, label in _bucket_labels(kind, start, end)
        ],
        "by_round": [
            {"round": k, "count": by_round[k]}
            for k in [*_ROUND_SHORT.values(), "Other"] if by_round.get(k)
        ],
        "_conducted": conducted,
    }


def _bucket_key(kind: str, d: date, start: datetime) -> date:
    if kind == "weekly":
        return d
    # Monthly: Mon–Sun weeks, the first one clipped to the 1st.
    return max(d - timedelta(days=d.weekday()), start.astimezone(IST).date())


def _bucket_labels(kind: str, start: datetime, end: datetime) -> list[tuple[date, str]]:
    first, last = start.astimezone(IST).date(), end.astimezone(IST).date()
    out = []
    if kind == "weekly":
        d = first
        while d <= last:
            out.append((d, d.strftime("%a %d %b")))
            d += timedelta(days=1)
        return out
    d = first
    while d <= last:
        week_end = min(d + timedelta(days=6 - d.weekday()), last)
        label = f"{d.day}–{week_end.day} {d.strftime('%b')}" if week_end != d else d.strftime("%d %b")
        out.append((d, label))
        d = week_end + timedelta(days=1)
    return out


async def _panels(db: AsyncSession, conducted: list) -> list[dict]:
    if not conducted:
        return []
    ids = [r.id for r in conducted]
    round_of = {r.id: r.round_type for r in conducted}

    members: dict = defaultdict(list)
    for p in (await db.execute(
        select(InterviewPanelist.interview_id, InterviewPanelist.user_id, User.full_name)
        .join(User, InterviewPanelist.user_id == User.id)
        .where(InterviewPanelist.interview_id.in_(ids), InterviewPanelist.role == "interviewer")
    )).all():
        members[p.interview_id].append((p.user_id, p.full_name))

    submitted = {
        (f.interview_id, f.submitted_by)
        for f in (await db.execute(
            select(InterviewFeedback.interview_id, InterviewFeedback.submitted_by)
            .where(InterviewFeedback.interview_id.in_(ids))
        )).all()
    }

    panels: dict = {}
    for iid in ids:
        people = sorted(members.get(iid, []), key=lambda m: m[1] or "")
        key = tuple(uid for uid, _ in people)
        p = panels.setdefault(key, {
            "members": ", ".join(n for _, n in people) or "No panel recorded",
            "names": [n for _, n in people],
            "size": len(people),
            "count": 0,
            "feedback_pending": 0,
            "_rounds": Counter(),
        })
        p["count"] += 1
        p["_rounds"][_ROUND_SHORT.get(round_of[iid], "Other")] += 1
        if any((iid, uid) not in submitted for uid in key):
            p["feedback_pending"] += 1

    out = []
    for p in sorted(panels.values(), key=lambda x: (-x["count"], x["members"])):
        rounds = p.pop("_rounds")
        p["rounds"] = " · ".join(f"{k} {rounds[k]}" for k in [*_ROUND_SHORT.values(), "Other"] if rounds.get(k))
        out.append(p)
    return out


async def _hires(db: AsyncSession, start: datetime, end: datetime) -> dict:
    H = ApplicationStageHistory
    Candidate = User
    rows = (await db.execute(
        select(
            H.application_id, H.created_at,
            Application.source, Application.agency_id, Application.owner_id, Application.sourced_by,
            Candidate.full_name.label("candidate"), Job.title, Job.internal_title,
        )
        .join(Application, H.application_id == Application.id)
        .join(Candidate, Application.applicant_id == Candidate.id)
        .join(Job, Application.job_id == Job.id)
        .where(H.to_stage == "hired", H.from_stage != "hired", H.created_at >= start, H.created_at < end)
        .order_by(H.created_at)
    )).all()

    seen, hires = set(), []
    for r in rows:
        if r.application_id not in seen:
            seen.add(r.application_id)
            hires.append(r)

    user_ids = {r.owner_id or r.sourced_by for r in hires if not r.agency_id} - {None}
    agency_ids = {r.agency_id for r in hires if r.agency_id}
    user_names = dict((await db.execute(select(User.id, User.full_name).where(User.id.in_(user_ids)))).all()) if user_ids else {}
    agency_names = dict((await db.execute(select(Agency.id, Agency.name).where(Agency.id.in_(agency_ids)))).all()) if agency_ids else {}

    credit: Counter = Counter()
    listed = []
    for r in hires:
        if r.agency_id:
            who, kind = agency_names.get(r.agency_id, "Unknown partner"), "Partner"
        else:
            who, kind = user_names.get(r.owner_id or r.sourced_by, "Unassigned"), "Internal"
        credit[(who, kind)] += 1
        listed.append({
            "candidate": r.candidate,
            "job": r.internal_title or r.title,
            "credit": who,
            "type": kind,
            "source": _SOURCE_LABELS.get(r.source, r.source),
            "date": r.created_at.astimezone(IST).strftime("%d %b"),
        })

    return {
        "total": len(hires),
        "internal": sum(1 for r in hires if not r.agency_id),
        "partner": sum(1 for r in hires if r.agency_id),
        "by_credit": [
            {"name": who, "type": kind, "count": n}
            for (who, kind), n in sorted(credit.items(), key=lambda x: (-x[1], x[0][0]))
        ],
        "list": listed[:MAX_HIRE_ROWS],
        "hidden": max(len(listed) - MAX_HIRE_ROWS, 0),
    }


async def _open_positions(db: AsyncSession, now: datetime) -> dict:
    jobs = (await db.execute(
        select(Job.id, Job.title, Job.internal_title, Job.location, Job.openings, Job.published_at, Job.status)
        .where(Job.status.in_(("published", "paused")))
    )).all()
    published = [j for j in jobs if j.status == "published"]
    ids = [j.id for j in published]

    hired, active = {}, {}
    if ids:
        hired = dict((await db.execute(
            select(Application.job_id, func.count())
            .where(Application.job_id.in_(ids), Application.stage == "hired")
            .group_by(Application.job_id)
        )).all())
        active = dict((await db.execute(
            select(Application.job_id, func.count())
            .where(Application.job_id.in_(ids), Application.stage.notin_(TERMINAL_STAGES))
            .group_by(Application.job_id)
        )).all())

    rows = []
    for j in published:
        openings = j.openings or 1
        filled = hired.get(j.id, 0)
        rows.append({
            "title": j.internal_title or j.title,
            "location": j.location or "—",
            "openings": openings,
            "filled": filled,
            "remaining": max(openings - filled, 0),
            "in_pipeline": active.get(j.id, 0),
            "days_open": (now - j.published_at).days if j.published_at else None,
        })
    rows.sort(key=lambda r: (-r["remaining"], -(r["days_open"] or 0)))

    return {
        "jobs": len(published),
        "openings": sum(r["openings"] for r in rows),
        "filled": sum(r["filled"] for r in rows),
        "remaining": sum(r["remaining"] for r in rows),
        "paused_jobs": len(jobs) - len(published),
        "rows": rows[:MAX_OPEN_POSITION_ROWS],
        "hidden": max(len(rows) - MAX_OPEN_POSITION_ROWS, 0),
    }


async def _count_conducted(db: AsyncSession, start: datetime, end: datetime) -> int:
    return (await db.execute(
        select(func.count()).select_from(Interview)
        .where(Interview.status == "completed", Interview.scheduled_at >= start, Interview.scheduled_at < end)
    )).scalar_one()


async def _count_hires(db: AsyncSession, start: datetime, end: datetime) -> int:
    H = ApplicationStageHistory
    return (await db.execute(
        select(func.count(func.distinct(H.application_id)))
        .where(H.to_stage == "hired", H.from_stage != "hired", H.created_at >= start, H.created_at < end)
    )).scalar_one()


# ── Insights ────────────────────────────────────────────────────────────────

def _insights_prompt(report: dict) -> str:
    # Candidate names stay out of the prompt — the model only needs counts and
    # who on our side did the work.
    facts = {
        "period": f"{report['kind']} report, {report['period_label']}",
        "comparison_period": "previous week" if report["kind"] == "weekly" else "same point last month",
        "interviews_conducted": report["interviews"]["total"],
        "interviews_conducted_previous": report["previous"]["interviews"],
        "interviews_cancelled": report["interviews"]["cancelled"],
        "interviews_no_show": report["interviews"]["no_show"],
        "interviews_by_" + ("day" if report["kind"] == "weekly" else "week"): report["interviews"]["buckets"],
        "interviews_by_round": report["interviews"]["by_round"],
        "hires": report["hires"]["total"],
        "hires_previous": report["previous"]["hires"],
        "hires_internal": report["hires"]["internal"],
        "hires_via_partner": report["hires"]["partner"],
        "hires_by_recruiter_or_partner": report["hires"]["by_credit"],
        "panels": [
            {"members": p["members"], "interviews": p["count"], "rounds": p["rounds"],
             "interviews_with_feedback_pending": p["feedback_pending"]}
            for p in report["panels"]
        ],
        "open_positions": {k: report["open_positions"][k] for k in ("jobs", "openings", "filled", "remaining", "paused_jobs")},
        "open_jobs": [
            {k: r[k] for k in ("title", "remaining", "in_pipeline", "days_open")}
            for r in report["open_positions"]["rows"]
        ],
    }
    return f"""You are a talent-acquisition analyst at Nablon AI writing for the hiring leadership team.

Below are this period's hiring metrics as JSON. Write 3 to 5 key insights.

{json.dumps(facts, indent=1, default=str)}

Rules:
- Every number you mention must appear in, or be directly computable from, the data above. Never estimate or invent.
- Each insight is a concrete observation, optionally followed by a specific next step (e.g. "SC – MedTech (US) has been open 94 days with nobody in the pipeline; brief a partner this week.").
- Do not interpret or editorialise. Never use "indicating", "suggesting", "showing", "highlighting", "positive trend", "potential issues" or similar — the data can't tell you why something happened.
- Prioritise, in this order: open positions with 0–1 candidates in pipeline (name them); panels with feedback pending (name the members); interview load concentrated on one or two panels (name them, give their share); who drove the hires (internal vs partner, top names); changes vs the comparison period of 20% or more. Skip changes smaller than 20%.
- Don't call a round a bottleneck from interview counts alone — more TR1 interviews than TR2 is the normal funnel shape.
- Refer to people by name only — never "he", "she", "his" or "her".
- One sentence per insight, at most 30 words, plain English.
- If the data is sparse (e.g. zero interviews), say so plainly in one insight rather than padding.
- Return only valid JSON, no markdown fences: {{"insights": ["...", "..."]}}
"""


async def generate_insights(report: dict) -> list[str] | None:
    """None when Azure OpenAI isn't configured or the call fails — the email
    still goes out, with the section marked unavailable."""
    if not (settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_DEPLOYMENT):
        return None
    try:
        import httpx

        url = (
            f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/"
            f"{settings.AZURE_OPENAI_DEPLOYMENT}/chat/completions"
            f"?api-version={settings.AZURE_OPENAI_API_VERSION}"
        )
        payload = {
            "messages": [{"role": "user", "content": _insights_prompt(report)}],
            "temperature": 0.2,
            "max_tokens": 600,
        }
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(url, json=payload, headers={"api-key": settings.AZURE_OPENAI_API_KEY})
            resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = raw.strip("`").removeprefix("json").strip()
        insights = [str(i).strip() for i in json.loads(raw).get("insights", []) if str(i).strip()]
        # The prompt forbids gendered pronouns but the model still guesses them
        # from names ("recognise her contributions"). Misgendering a colleague
        # in a leadership email is worse than one fewer bullet, so drop those.
        insights = [i for i in insights if not _GENDERED.search(i)]
        return insights[:5] or None
    except Exception as exc:
        logger.warning(f"Scheduled report insights failed: {exc}")
        return None


# ── Build + send ────────────────────────────────────────────────────────────

async def build_report(db: AsyncSession, kind: str, now: datetime | None = None) -> dict:
    if kind not in ("weekly", "monthly"):
        raise ValueError(f"Unknown report kind: {kind}")
    now = now or datetime.now(timezone.utc)
    start, end, prev_start, prev_end = _windows(kind, now)

    interviews = await _interviews(db, kind, start, end)
    panels = await _panels(db, interviews.pop("_conducted"))
    hires = await _hires(db, start, end)
    previous = {
        "interviews": await _count_conducted(db, prev_start, prev_end),
        "hires": await _count_hires(db, prev_start, prev_end),
    }

    report = {
        "kind": kind,
        "period_label": _period_label(kind, start, end),
        "window_label": (
            f"{start.astimezone(IST).strftime('%a %d %b, %I:%M %p')} – "
            f"{end.astimezone(IST).strftime('%a %d %b, %I:%M %p')} IST"
        ),
        "compare_label": "last week" if kind == "weekly" else "same point last month",
        "interviews": interviews,
        "panels": panels,
        "hires": hires,
        "open_positions": await _open_positions(db, now),
        "previous": previous,
        "deltas": {
            "interviews": _delta(interviews["total"], previous["interviews"]),
            "hires": _delta(hires["total"], previous["hires"]),
        },
        "bucket_heading": "By day" if kind == "weekly" else "By week",
        "reports_url": f"{settings.FRONTEND_URL}/hr/reports",
        "settings_url": f"{settings.FRONTEND_URL}/hr/settings",
    }
    report["max_bucket"] = max([b["count"] for b in interviews["buckets"]] + [1])
    report["insights"] = await generate_insights(report)
    return report


def subject_for(report: dict, preview: bool = False) -> str:
    base = (
        f"Weekly hiring report · {report['period_label']}"
        if report["kind"] == "weekly"
        else f"Monthly hiring summary · {report['period_label']}"
    )
    return f"[Preview] {base}" if preview else base


async def send_report(report: dict, recipients: list[str], preview: bool = False) -> bool:
    from app.services.email_service import send_email

    return await send_email(
        to_email=recipients,
        subject=subject_for(report, preview),
        template_name="scheduled_report",
        context={**report, "is_preview": preview},
    )
