"""AI-assisted candidate screening: college (NIRF ranking), CGPA, skills and
project scoring for the questionnaire sent when an application enters the
`screening` stage on a job with `Job.screening_enabled = True`.

Two hard gates drive auto-rejection, both deterministic and never dependent
on Azure OpenAI being configured:
  - CGPA below CGPA_HARD_MIN                     -> auto-reject
  - Composite score below OVERALL_SCORE_HARD_MIN -> auto-reject

College is NOT a rejection gate (removed 2026-09-27, explicit instruction:
"don't auto reject the candidates based on the college, just give score
based on the NIRF ranking"). It only ever contributes its 30% weight to the
composite score, via classify_college_nirf / app/constants/nirf_rankings.py
(NIRF India Rankings 2025, Engineering category) — no college signal, however
weak or unranked, can by itself reject a candidate.

Skipped entirely for SCREENING_EXEMPT_SOURCES (TA-sourced, referral and
campus placement applications) — those are already vetted by a person before
they enter the pipeline. Direct and agency applications get the questionnaire
(see create_and_queue_email).

Everything else (college score for names outside the static NIRF list, and
the skills/project judgement) is AI-assisted where available and degrades to
a deterministic heuristic otherwise — same fail-open convention as
ai_rejection_service.py / resume_parsing_service.py elsewhere in this app.
Nothing here silently penalises a candidate *because* AI was unavailable: an
unrecognised, NIRF-unranked college defaults to a neutral mid-range score
rather than a low one when there's no AI to actually judge it.

Auto-rejects from this module never email the candidate immediately — see
REJECTION_EMAIL_DELAY and the notify_delay passed into move_stage below. The
stage still moves to "rejected" right away (for pipeline bookkeeping/HR
visibility); only the candidate-facing email is held, and
screening_tasks.send_delayed_screening_rejection_emails (Celery beat) fires
it once the delay has passed. This was an explicit instruction: sending an
instant automated rejection the moment the questionnaire is scored/expires
was "very brutal" — 2026-09-27.
"""
import json
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import ScreeningResponse
from app.constants.nirf_rankings import RANK_BY_ALIAS, BAND_101_150_ALIASES, BAND_101_150, NIRF_SOURCE

logger = logging.getLogger(__name__)

# Raised from 2 days to 7 (2026-08-26). The questionnaire goes out the moment
# an application lands at "applied", so a candidate who applies on a Friday
# evening was previously losing most of the window to a weekend they never saw
# the email in. Kept in days as the source of truth — the candidate-facing
# email reads in days, and an hours figure past 48 stops being legible.
REQUEST_EXPIRY_DAYS = 7
REQUEST_EXPIRY_HOURS = REQUEST_EXPIRY_DAYS * 24
CGPA_HARD_MIN = 7.5

# How long a screening-flow auto-rejection holds its candidate-facing email
# before screening_tasks.send_delayed_screening_rejection_emails actually
# sends it — see the module docstring. The stage move to "rejected" itself
# is NOT delayed, only the email.
REJECTION_EMAIL_DELAY = timedelta(days=2)

# Application sources that never get the screening questionnaire, even on a
# job with screening_enabled=True. TA-sourced, referral and campus placement
# candidates are hand-picked by a recruiter / employee / placement cell, so the
# questionnaire is redundant for them. They stay at `applied` for HR to move on
# manually.
SCREENING_EXEMPT_SOURCES = frozenset({"talent_acquisition", "referral", "campus"})

# Third hard gate, applied after the composite score is computed (college tier
# and CGPA gates above run first and short-circuit before this is ever
# reached): a candidate who clears both of those but still scores below this
# bar on the weighted composite is auto-rejected too, per the explicit ask
# that a low overall score should reject like the other two gates rather than
# just sitting there as an HR-facing label.
OVERALL_SCORE_HARD_MIN = 70.0

# Composite weights — must sum to 1.0. Matches the brief: college pedigree and
# skills/project substance matter most; CGPA is a real but smaller signal once
# a candidate has already cleared the hard 8.0 floor.
WEIGHT_COLLEGE = 0.30
WEIGHT_CGPA = 0.20
WEIGHT_SKILLS = 0.25
WEIGHT_PROJECTS = 0.25

# ── College scoring (NIRF ranking) ───────────────────────────────────────────
# Static fast-path against the real, published NIRF India Rankings 2025
# (Engineering) list — app/constants/nirf_rankings.py — so the common case
# never depends on an AI round-trip. Anything not in that list falls through
# to an AI-assisted plausibility score (see classify_college_nirf) and is
# NEVER treated as tier 4/5-style "bad" — it's simply unranked.

def _normalize_college(name: str) -> str:
    n = name.strip().lower()
    n = re.sub(r"[.,\-()]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def _static_nirf_lookup(name: str) -> Optional[tuple[str, "int | str"]]:
    """Returns (kind, value): ("rank", 1-100) or ("band", "101-150"), or None
    if the college isn't in the static NIRF list at all."""
    n = _normalize_college(name)
    for alias, rank in RANK_BY_ALIAS.items():
        if alias in n or n in alias:
            return ("rank", rank)
    for alias in BAND_101_150_ALIASES:
        if alias in n or n in alias:
            return ("band", BAND_101_150)
    return None


async def classify_college_nirf(college_name: str) -> dict:
    """Returns {rank, band, ai_score, source, reasoning}. `source` is
    'static', 'ai', or 'unranked'. Only ever informs the college SCORE
    (see _college_score_from_nirf) — never a rejection signal on its own,
    regardless of source, per the 2026-09-27 instruction."""
    static = _static_nirf_lookup(college_name or "")
    if static:
        kind, value = static
        return {
            "rank": value if kind == "rank" else None,
            "band": value if kind == "band" else None,
            "ai_score": None,
            "source": "static",
            "reasoning": None,
        }

    from app.config import settings

    if settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_DEPLOYMENT:
        try:
            import httpx

            prompt = f"""You are helping an Indian tech recruiter judge a candidate's college. It is NOT
in India's official NIRF 2025 Engineering rankings (top 150) — {NIRF_SOURCE} — so score it on general
reputation instead (teaching quality, research output, placement record, general standing), the same
kind of judgement NIRF itself would weigh.

College name given by the candidate: "{college_name}"

Respond with JSON only: {{"score": <0-100 integer>, "reasoning": "one sentence explaining the score"}}

Guidance: 0-100 is a REPUTATION score, not a pass/fail gate — this candidate cannot be rejected for
their college, only scored, so judge fairly and avoid extreme low scores (below 20) unless the name
given clearly isn't a real accredited engineering institution at all."""

            url = (
                f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/"
                f"{settings.AZURE_OPENAI_DEPLOYMENT}/chat/completions"
                f"?api-version={settings.AZURE_OPENAI_API_VERSION}"
            )
            payload = {
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": 200,
                "response_format": {"type": "json_object"},
            }
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(url, json=payload, headers={"api-key": settings.AZURE_OPENAI_API_KEY})
                resp.raise_for_status()
                raw = resp.json()["choices"][0]["message"]["content"]
                result = json.loads(raw)
                score = min(100.0, max(0.0, float(result.get("score", 50))))
                return {
                    "rank": None, "band": None, "ai_score": score,
                    "source": "ai", "reasoning": result.get("reasoning"),
                }
        except Exception as exc:
            logger.warning(f"College NIRF AI scoring failed, defaulting to a neutral score: {exc}")

    return {
        "rank": None, "band": None, "ai_score": None, "source": "unranked",
        "reasoning": (
            "College not in the NIRF 2025 Engineering top 150 and AI unavailable — scored at a "
            "neutral default (never a rejection reason); recommend manual review of the institution."
        ),
    }


def _college_score_from_nirf(nirf: dict) -> float:
    if nirf["rank"] is not None:
        # Rank 1 -> 100, rank 100 -> 55, linear. Never below 55 for a top-100
        # published rank — the floor is deliberately well above the
        # unranked/AI-default score so real ranking precision is rewarded.
        return round(100.0 - (nirf["rank"] - 1) * (45.0 / 99.0), 2)
    if nirf["band"] == BAND_101_150:
        return 48.0
    if nirf["ai_score"] is not None:
        return nirf["ai_score"]
    return 35.0  # unranked, AI unavailable — neutral, not punitive


def _college_tier_from_nirf(nirf: dict) -> Optional[int]:
    """Coarse 1-3 bucket kept only for the existing HR "Tier X" badge — no
    gating meaning. None means unranked (badge hidden)."""
    if nirf["rank"] is not None:
        return 1 if nirf["rank"] <= 25 else 2
    if nirf["band"] == BAND_101_150:
        return 3
    return None


# ── Skills / project scoring ─────────────────────────────────────────────────

# Keyword weights for the no-AI fallback and as a floor signal even when AI is
# used. Deliberately weighted toward Python/ML/AI per the scoring brief.
_HIGH_VALUE_SKILLS = {
    "python": 10, "machine learning": 10, "deep learning": 10, "artificial intelligence": 10,
    "ai": 9, "nlp": 9, "natural language processing": 9, "llm": 10, "llms": 10,
    "generative ai": 10, "genai": 10, "pytorch": 9, "tensorflow": 9, "keras": 7,
    "langchain": 9, "transformers": 8, "computer vision": 8, "opencv": 6,
    "data science": 8, "scikit-learn": 7, "sklearn": 7, "mlops": 8,
    "hugging face": 7, "huggingface": 7, "rag": 8, "vector database": 6,
    "sql": 4, "pandas": 5, "numpy": 5, "fastapi": 5, "django": 4, "flask": 4,
    "java": 3, "c++": 3, "javascript": 3, "react": 3, "node": 3, "docker": 3,
    "kubernetes": 3, "aws": 3, "azure": 3, "gcp": 3,
}


def _fallback_skills_score(skills: list[str]) -> tuple[float, str]:
    if not skills:
        return 0.0, "No skills listed."
    normalized = [s.strip().lower() for s in skills if s and s.strip()]
    matched = []
    total = 30.0  # baseline credit for listing anything at all
    for skill in normalized:
        for key, weight in _HIGH_VALUE_SKILLS.items():
            if key in skill:
                total += weight
                matched.append(skill)
                break
    total = min(100.0, total)
    reasoning = (
        f"Keyword match (no AI configured): {len(matched)} of {len(normalized)} listed skills "
        f"matched high-value keywords (Python/ML/AI-weighted)."
    )
    return total, reasoning


def _fallback_project_score(projects: list[dict]) -> tuple[float, str]:
    if not projects:
        return 0.0, "No projects listed."
    score = 15.0  # baseline for attempting the section
    qualifying = 0
    for p in projects:
        desc = (p.get("description") or "").strip()
        has_github = bool((p.get("github_url") or "").strip())
        if len(desc) >= 40:
            score += 15
            qualifying += 1
        if has_github:
            score += 10
    score = min(100.0, score)
    reasoning = (
        f"Heuristic (no AI configured): {qualifying} of {len(projects)} projects had a substantive "
        f"description; GitHub links present were credited."
    )
    return score, reasoning


async def _ai_score_skills_and_projects(
    *,
    job_title: str,
    job_skills: list[str],
    skills: list[str],
    projects: list[dict],
    relevant_experience: Optional[str],
    achievements: Optional[str],
    github_profile_url: Optional[str],
) -> Optional[dict]:
    """Returns {skills_score, skills_reasoning, project_score, project_reasoning}
    or None if Azure OpenAI isn't configured or the call fails (caller falls
    back to the deterministic heuristic in that case)."""
    from app.config import settings

    if not (settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_DEPLOYMENT):
        return None

    try:
        import httpx

        projects_text = "\n".join(
            f"- {p.get('title', 'Untitled')}: {p.get('description', '')} "
            f"[Tech: {p.get('tech_stack') or 'not specified'}] "
            f"[GitHub: {p.get('github_url') or 'none provided'}]"
            for p in projects
        ) or "(none provided)"

        prompt = f"""You are a technical recruiter at Nablon AI screening a candidate for the role
of "{job_title}". The role's required/preferred skills are: {', '.join(job_skills) or 'not specified'}.

Score the candidate on two dimensions, 0-100 each. Give meaningfully higher scores for genuine
strength in Python and AI/ML-adjacent skills (machine learning, deep learning, NLP, LLMs, GenAI,
PyTorch/TensorFlow, data science, MLOps) since this company builds production agentic AI systems —
but do not invent relevance that isn't there.

Candidate's listed skills: {', '.join(skills) or '(none listed)'}
Candidate's relevant experience: {relevant_experience or '(none provided)'}
Candidate's achievements: {achievements or '(none provided)'}
Candidate's GitHub profile: {github_profile_url or '(not provided)'}

Candidate's projects:
{projects_text}

Judge project quality on genuine technical depth, originality, relevance to the role, and whether
the GitHub link (if any) plausibly supports the claimed work — a project with no link and a vague
one-line description should score low; a well-described project with relevant tech and a real repo
link should score high.

Respond with JSON only, exactly these keys:
{{
  "skills_score": <0-100 integer>,
  "skills_reasoning": "one or two sentences",
  "project_score": <0-100 integer>,
  "project_reasoning": "one or two sentences"
}}"""

        url = (
            f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/"
            f"{settings.AZURE_OPENAI_DEPLOYMENT}/chat/completions"
            f"?api-version={settings.AZURE_OPENAI_API_VERSION}"
        )
        payload = {
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 500,
            "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers={"api-key": settings.AZURE_OPENAI_API_KEY})
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            result = json.loads(raw)

        return {
            "skills_score": min(100.0, max(0.0, float(result.get("skills_score", 0)))),
            "skills_reasoning": result.get("skills_reasoning"),
            "project_score": min(100.0, max(0.0, float(result.get("project_score", 0)))),
            "project_reasoning": result.get("project_reasoning"),
        }
    except Exception as exc:
        logger.warning(f"AI skills/project scoring failed, falling back to heuristic: {exc}")
        return None


def _cgpa_score(cgpa: float) -> float:
    # CGPA_HARD_MIN -> 50 (just cleared the hard floor), 10.0 -> 100. Never
    # negative since callers only reach this after the cgpa >= CGPA_HARD_MIN
    # gate. Divisor is derived from CGPA_HARD_MIN (not hardcoded) so the
    # 10.0 -> 100 endpoint stays correct if the floor is ever tuned again.
    return round(min(100.0, 50 + ((cgpa - CGPA_HARD_MIN) / (10.0 - CGPA_HARD_MIN)) * 50), 2)


def _recommendation(score: float) -> str:
    if score >= 75:
        return "strong_fit"
    if score >= 55:
        return "moderate_fit"
    return "weak_fit"


async def score_screening_response(
    resp: ScreeningResponse,
    *,
    job_title: str,
    job_skills: list[str],
) -> None:
    """Mutates resp in place with every scoring field. Does not commit —
    caller is responsible for the transaction."""
    nirf = await classify_college_nirf(resp.college_name or "")
    college_score = _college_score_from_nirf(nirf)
    cgpa = float(resp.cgpa) if resp.cgpa is not None else 0.0

    resp.college_tier = _college_tier_from_nirf(nirf)
    resp.college_nirf_rank = nirf["rank"]
    resp.college_nirf_band = nirf["band"]
    resp.college_score = college_score

    # College is scoring-only — see the module docstring. Only CGPA gates here.
    reasons = []
    if cgpa < CGPA_HARD_MIN:
        reasons.append(f"CGPA {cgpa:.2f} is below the required minimum of {CGPA_HARD_MIN:.1f}.")

    if reasons:
        resp.auto_reject = True
        resp.auto_reject_reason = " ".join(reasons)
        resp.cgpa_score = _cgpa_score(cgpa) if cgpa >= CGPA_HARD_MIN else 0.0
        resp.skills_score = None
        resp.project_score = None
        resp.overall_score = None
        resp.recommendation = None
        resp.ai_reasoning = {"college": nirf["reasoning"]} if nirf["reasoning"] else None
        resp.is_ai_scored = nirf["source"] == "ai"
        resp.scored_at = datetime.now(timezone.utc)
        return

    skills = resp.skills or []
    projects = resp.projects or []

    ai_result = await _ai_score_skills_and_projects(
        job_title=job_title,
        job_skills=job_skills or [],
        skills=skills,
        projects=projects,
        relevant_experience=resp.relevant_experience,
        achievements=resp.achievements,
        github_profile_url=resp.github_profile_url,
    )

    if ai_result:
        skills_score = ai_result["skills_score"]
        project_score = ai_result["project_score"]
        skills_reasoning = ai_result["skills_reasoning"]
        project_reasoning = ai_result["project_reasoning"]
        is_ai_scored = True
    else:
        skills_score, skills_reasoning = _fallback_skills_score(skills)
        project_score, project_reasoning = _fallback_project_score(projects)
        is_ai_scored = nirf["source"] == "ai"  # still AI-scored overall if only the college call succeeded

    cgpa_score = _cgpa_score(cgpa)
    overall = (
        college_score * WEIGHT_COLLEGE
        + cgpa_score * WEIGHT_CGPA
        + skills_score * WEIGHT_SKILLS
        + project_score * WEIGHT_PROJECTS
    )

    resp.cgpa_score = cgpa_score
    resp.skills_score = skills_score
    resp.project_score = project_score
    resp.overall_score = round(overall, 2)
    resp.recommendation = _recommendation(overall)
    if overall < OVERALL_SCORE_HARD_MIN:
        resp.auto_reject = True
        resp.auto_reject_reason = (
            f"Overall screening score {overall:.1f} is below the required minimum of "
            f"{OVERALL_SCORE_HARD_MIN:.0f}."
        )
    else:
        resp.auto_reject = False
        resp.auto_reject_reason = None
    resp.ai_reasoning = {
        "college": nirf["reasoning"],
        "skills": skills_reasoning,
        "projects": project_reasoning,
    }
    resp.is_ai_scored = is_ai_scored
    resp.scored_at = datetime.now(timezone.utc)


# ── Request lifecycle ────────────────────────────────────────────────────────

def _to_dict(resp: ScreeningResponse) -> dict:
    return {
        "id": resp.id,
        "application_id": resp.application_id,
        "status": resp.status,
        "college_name": resp.college_name,
        "cgpa": float(resp.cgpa) if resp.cgpa is not None else None,
        "relevant_experience": resp.relevant_experience,
        "skills": resp.skills,
        "projects": resp.projects,
        "achievements": resp.achievements,
        "github_profile_url": resp.github_profile_url,
        "college_tier": resp.college_tier,
        "college_nirf_rank": resp.college_nirf_rank,
        "college_nirf_band": resp.college_nirf_band,
        "college_score": float(resp.college_score) if resp.college_score is not None else None,
        "cgpa_score": float(resp.cgpa_score) if resp.cgpa_score is not None else None,
        "skills_score": float(resp.skills_score) if resp.skills_score is not None else None,
        "project_score": float(resp.project_score) if resp.project_score is not None else None,
        "overall_score": float(resp.overall_score) if resp.overall_score is not None else None,
        "recommendation": resp.recommendation,
        "auto_reject": resp.auto_reject,
        "auto_reject_reason": resp.auto_reject_reason,
        "ai_reasoning": resp.ai_reasoning,
        "is_ai_scored": resp.is_ai_scored,
        "submitted_at": resp.submitted_at,
        "scored_at": resp.scored_at,
        "expires_at": resp.expires_at,
        "created_at": resp.created_at,
    }


async def get_or_create_request(db: AsyncSession, application_id: uuid.UUID) -> ScreeningResponse:
    existing = (await db.execute(
        select(ScreeningResponse).where(ScreeningResponse.application_id == application_id)
    )).scalar_one_or_none()
    if existing:
        return existing

    req = ScreeningResponse(
        application_id=application_id,
        token=secrets.token_urlsafe(32),
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=REQUEST_EXPIRY_HOURS),
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


async def create_and_queue_email(db: AsyncSession, application_id: uuid.UUID) -> None:
    """Creates the screening request (if one doesn't already exist) and queues
    the candidate-facing email. Called right after the application-received
    email fires in application_service.submit_application /
    submit_sourced_application, on any job with screening_enabled=True.
    Mirrors the offer-stage DocumentRequest auto-trigger — email send is
    Celery-only, never inline (see the 2026-07-20 synchronous-email fix).

    Hard-gated to the `applied` stage — by explicit design the questionnaire
    is only ever sent to a candidate still sitting at `applied`, never once
    they've moved on (to screening or anywhere else). Checked here, not just
    left to the call sites, so it holds regardless of what calls this in the
    future — there is deliberately no move_stage-triggered fallback anymore,
    since that would fire only after the stage had already flipped past
    `applied`.

    Skipped for SCREENING_EXEMPT_SOURCES (TA-sourced, referral, campus
    placement). Direct and agency applications get it."""
    from app.models.application import Application

    application = await db.get(Application, application_id)
    if not application or application.stage != "applied":
        return
    if application.source in SCREENING_EXEMPT_SOURCES:
        return

    req = await get_or_create_request(db, application_id)
    if req.email_sent_at:
        return  # already sent once for this application — idempotent across both call sites

    from app.tasks.email_tasks import send_screening_request_email_task
    send_screening_request_email_task.delay(str(application_id))

    req.email_sent_at = datetime.now(timezone.utc)
    await db.commit()


async def get_request_by_token(db: AsyncSession, token: str) -> ScreeningResponse:
    req = (await db.execute(
        select(ScreeningResponse).where(ScreeningResponse.token == token)
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Invalid or expired link")

    now = datetime.now(timezone.utc)
    if req.expires_at.replace(tzinfo=timezone.utc) < now and req.status == "pending":
        raise HTTPException(400, "This screening link has expired")

    return req


async def get_public_info(db: AsyncSession, token: str) -> dict:
    from app.models.application import Application
    from app.models.user import User
    from app.models.job import Job

    req = await get_request_by_token(db, token)

    row = (await db.execute(
        select(User.full_name, Job.title)
        .select_from(Application)
        .join(User, User.id == Application.applicant_id)
        .join(Job, Job.id == Application.job_id)
        .where(Application.id == req.application_id)
    )).first()

    return {
        "status": req.status,
        "candidate_name": row[0] if row else "Candidate",
        "job_title": row[1] if row else "",
        "expires_at": req.expires_at,
    }


async def submit_screening(db: AsyncSession, token: str, data) -> dict:
    from app.models.application import Application
    from app.models.job import Job

    req = await get_request_by_token(db, token)
    if req.status == "submitted":
        raise HTTPException(409, "This screening form has already been submitted")

    application = await db.get(Application, req.application_id)
    if not application:
        raise HTTPException(404, "Application not found")
    job = await db.get(Job, application.job_id)

    req.college_name = data.college_name.strip()
    req.cgpa = data.cgpa
    req.relevant_experience = (data.relevant_experience or "").strip() or None
    req.skills = [s.strip() for s in (data.skills or []) if s and s.strip()]
    req.projects = [p.model_dump() for p in (data.projects or [])]
    req.achievements = (data.achievements or "").strip() or None
    req.github_profile_url = (data.github_profile_url or "").strip() or None
    req.status = "submitted"
    req.submitted_at = datetime.now(timezone.utc)

    await score_screening_response(
        req,
        job_title=job.title if job else "",
        job_skills=(job.skills_required or []) if job else [],
    )

    await db.commit()
    await db.refresh(req)

    if req.auto_reject:
        try:
            from app.services import application_service
            await application_service.move_stage(
                db,
                application.id,
                "rejected",
                moved_by=None,
                notes="Automatically rejected by the screening questionnaire (CGPA / overall score gate).",
                rejection_reason=(
                    "Thank you for completing our screening questionnaire. After reviewing your "
                    "responses against the requirements for this role, we won't be moving forward "
                    "with your application at this time. We encourage you to keep building your "
                    "profile and to apply again in the future."
                ),
                drop_category="profile_mismatch",
                notify_delay=REJECTION_EMAIL_DELAY,
            )
        except HTTPException:
            # Stage may have already moved on (e.g. HR acted manually first) —
            # the score is still recorded either way, so this is non-fatal.
            logger.info(f"Auto-reject stage move skipped for application {application.id} (already moved on)")
    elif application.stage == "applied":
        # Passed both hard gates — advance out of "applied" into whichever stage
        # comes next for this application's source, so HR sees them (with a
        # score attached) in the right column, same as if they'd clicked the
        # move themselves. Only acts from "applied": if HR has already moved the
        # candidate on by the time they submit, their manual action wins and
        # this is a no-op (guarded, not forced).
        #
        # Agency-sourced applications run assessment before the HR screening
        # call (see AGENCY_VALID_TRANSITIONS) — "applied" -> "screening" isn't a
        # valid move for them, so hardcoding "screening" here would 400 and get
        # silently swallowed below, leaving a passed candidate stuck at
        # "applied" forever.
        # Campus runs the same order — derive the step from the shared table
        # rather than branching on "agency" here, which left campus candidates
        # trying the invalid applied -> screening move.
        from app.constants.stages import valid_transitions_for
        next_stage = valid_transitions_for(application.source)["applied"][0]
        try:
            from app.services import application_service
            await application_service.move_stage(
                db,
                application.id,
                next_stage,
                moved_by=None,
                notes=f"Automatically advanced to {next_stage.title()} after passing the AI screening gate.",
            )
        except HTTPException:
            logger.info(f"Auto-advance to {next_stage} skipped for application {application.id} (already moved on)")

    return _to_dict(req)


async def get_for_application(db: AsyncSession, application_id: uuid.UUID) -> Optional[dict]:
    req = (await db.execute(
        select(ScreeningResponse).where(ScreeningResponse.application_id == application_id)
    )).scalar_one_or_none()
    if not req:
        return None
    return _to_dict(req)


async def auto_reject_expired(db: AsyncSession) -> int:
    """Auto-rejects any candidate whose screening link expired (7 days,
    REQUEST_EXPIRY_DAYS) without ever submitting the questionnaire — but only
    while the application is STILL sitting at `applied`. If HR already moved
    it on manually (to any other stage, screening included) before the
    deadline, that manual action wins and this is a no-op for that row —
    same guarded-not-forced convention as the pass/fail auto-advance in
    submit_screening above. Runs periodically via
    app/tasks/screening_tasks.py::auto_reject_expired_screening_requests.

    Idempotent by construction: once an application here actually moves to
    `rejected`, the next run's `application.stage != "applied"` check skips
    it — no separate "already processed" flag needed.
    """
    from app.models.application import Application
    from app.services import application_service

    now = datetime.now(timezone.utc)
    expired = (await db.execute(
        select(ScreeningResponse).where(
            ScreeningResponse.status == "pending",
            ScreeningResponse.expires_at < now,
        )
    )).scalars().all()

    rejected = 0
    for req in expired:
        application = await db.get(Application, req.application_id)
        if not application or application.stage != "applied":
            continue
        # A TA/referral/campus candidate sent the questionnaire before the exemption
        # existed must not be rejected for ignoring a form they no longer need.
        if application.source in SCREENING_EXEMPT_SOURCES:
            continue

        try:
            await application_service.move_stage(
                db,
                application.id,
                "rejected",
                moved_by=None,
                notes=(
                    "Automatically rejected — screening questionnaire was not submitted "
                    f"within the {REQUEST_EXPIRY_DAYS}-day window."
                ),
                rejection_reason=(
                    "We did not receive your screening questionnaire responses within the "
                    "time window provided, so we are unable to move forward with your "
                    "application at this time."
                ),
                drop_category="other",
                notify_delay=REJECTION_EMAIL_DELAY,
            )
            rejected += 1
        except HTTPException:
            logger.info(
                f"Auto-reject-on-expiry skipped for application {application.id} "
                "(stage already moved on by HR)"
            )

    return rejected
