"""AI-assisted candidate screening: college tier, CGPA, skills and project
scoring for the questionnaire sent when an application enters the `screening`
stage on a job with `Job.screening_enabled = True`.

Two hard gates are deterministic and never depend on Azure OpenAI being
configured, per the explicit scoring brief this module implements:
  - College tier 4/5              -> auto-reject
  - CGPA below CGPA_HARD_MIN (8)  -> auto-reject

Everything else (college tier for names outside the static list, and the
skills/project judgement) is AI-assisted where available and degrades to a
deterministic heuristic otherwise — same fail-open convention as
ai_rejection_service.py / resume_parsing_service.py elsewhere in this app.
Nothing here silently rejects a candidate *because* AI was unavailable: an
unrecognised college defaults to the benefit of the doubt (tier 3) rather
than tier 4/5 when there's no AI to actually judge it.
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

logger = logging.getLogger(__name__)

REQUEST_EXPIRY_DAYS = 14
CGPA_HARD_MIN = 8.0

# Composite weights — must sum to 1.0. Matches the brief: college pedigree and
# skills/project substance matter most; CGPA is a real but smaller signal once
# a candidate has already cleared the hard 8.0 floor.
WEIGHT_COLLEGE = 0.30
WEIGHT_CGPA = 0.20
WEIGHT_SKILLS = 0.25
WEIGHT_PROJECTS = 0.25

# ── College tier classification ──────────────────────────────────────────────
# Static fast-path for the most commonly seen institutions in Indian tech
# hiring, so the common case never depends on an AI round-trip. Anything not
# listed here falls through to AI classification (see classify_college_tier).
_TIER1_COLLEGES = {
    "iit bombay", "iit delhi", "iit madras", "iit kanpur", "iit kharagpur",
    "iit roorkee", "iit guwahati", "iit hyderabad", "iit indore", "iit bhu",
    "iit bhubaneswar", "iit gandhinagar", "iit ropar", "iit patna", "iit mandi",
    "iit jodhpur", "iit varanasi", "indian institute of technology",
    "iisc bangalore", "indian institute of science",
    "bits pilani", "birla institute of technology and science",
    "iiit hyderabad", "international institute of information technology hyderabad",
    "iiit bangalore", "iiit delhi", "iiit-b", "iiit-d",
    "nit trichy", "nit tiruchirappalli", "nit warangal", "nit surathkal",
    "nit karnataka", "dtu", "delhi technological university",
}
_TIER2_COLLEGES = {
    "nit calicut", "nit rourkela", "nit durgapur", "nit allahabad", "mnnit",
    "nit kurukshetra", "nit jaipur", "mnit jaipur", "nit patna", "nit raipur",
    "nit silchar", "nit agartala", "nit hamirpur", "nit jalandhar", "nit srinagar",
    "iiit allahabad", "iiit gwalior", "iiit jabalpur", "iiit kota", "iiit vadodara",
    "vit vellore", "vellore institute of technology", "vit chennai",
    "srm institute of science and technology", "srm university",
    "manipal institute of technology", "manipal academy of higher education",
    "thapar institute of engineering and technology", "thapar university",
    "pes university", "pesu", "pes institute of technology",
    "rv college of engineering", "rvce", "bms college of engineering", "bmsce",
    "psg college of technology", "psg tech",
    "coep pune", "college of engineering pune", "vjti mumbai",
    "vjti", "veermata jijabai technological institute",
    "anna university", "amrita vishwa vidyapeetham", "amrita university",
    "kiit university", "kalinga institute of industrial technology",
    "nsut", "netaji subhas university of technology", "nsit delhi",
    "iit ism dhanbad", "indian school of mines",
    "jadavpur university", "iiit lucknow", "iiit una", "iiit nagpur",
    "iiit surat", "iiit sonepat", "iiit ranchi", "iiit trichy",
    "chennai mathematical institute", "iisc", "iit dharwad", "iit bhilai",
    "iit goa", "iit jammu", "iit palakkad", "iit tirupati",
}


def _normalize_college(name: str) -> str:
    n = name.strip().lower()
    n = re.sub(r"[.,\-()]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def _static_tier_lookup(name: str) -> Optional[int]:
    n = _normalize_college(name)
    if any(key in n for key in _TIER1_COLLEGES):
        return 1
    if any(key in n for key in _TIER2_COLLEGES):
        return 2
    return None


async def classify_college_tier(college_name: str) -> tuple[int, str, Optional[str]]:
    """Returns (tier 1-5, source, reasoning). source is 'static', 'ai', or
    'default'. Tier 4/5 (auto-reject) is only ever assigned by the static list
    (it has none) or by an actual AI judgement — never by a bare "we don't
    recognise this name" default, so a missing Azure OpenAI config can never
    itself cause a rejection."""
    static_tier = _static_tier_lookup(college_name)
    if static_tier is not None:
        return static_tier, "static", None

    from app.config import settings

    if settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_DEPLOYMENT:
        try:
            import httpx

            prompt = f"""You are helping an Indian tech recruiter classify a candidate's college into a
hiring tier used broadly across Indian tech recruiting:
- Tier 1: IITs, IISc, top IIITs (Hyderabad/Bangalore/Delhi), BITS Pilani, flagship NITs (Trichy/Warangal/Surathkal/Karnataka), DTU.
- Tier 2: Other NITs/IIITs, well-regarded state/private engineering colleges with strong placement records (e.g. VIT, SRM, Manipal, Thapar, PES, RVCE, BMS, PSG Tech, COEP, VJTI, Anna University-affiliated top colleges, Amrita, KIIT, NSUT).
- Tier 3: Reputable but average state/private engineering colleges — decent but unremarkable placement records.
- Tier 4: Weak or largely unknown private engineering colleges with poor placement records.
- Tier 5: Diploma-only / polytechnic / unaccredited institutions, or clearly not a real degree-granting engineering college.

College name given by the candidate: "{college_name}"

Respond with JSON only: {{"tier": <1-5 integer>, "reasoning": "one sentence explaining the classification"}}"""

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
                tier = int(result.get("tier", 3))
                tier = min(5, max(1, tier))
                return tier, "ai", result.get("reasoning")
        except Exception as exc:
            logger.warning(f"College tier AI classification failed, defaulting to tier 3: {exc}")

    return 3, "default", "College not recognised and AI unavailable — defaulted to Tier 3 (benefit of the doubt); needs manual review."


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
    # 8.0 -> 50 (just cleared the hard floor), 10.0 -> 100. Never negative
    # since callers only reach this after the cgpa >= CGPA_HARD_MIN gate.
    return round(min(100.0, 50 + ((cgpa - CGPA_HARD_MIN) / 2.0) * 50), 2)


def _college_score(tier: int) -> float:
    return {1: 100.0, 2: 80.0, 3: 50.0}.get(tier, 0.0)


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
    tier, tier_source, tier_reasoning = await classify_college_tier(resp.college_name or "")
    cgpa = float(resp.cgpa) if resp.cgpa is not None else 0.0

    resp.college_tier = tier
    reasons = []

    if tier >= 4:
        reasons.append(
            f"College '{resp.college_name}' classified as Tier {tier} ({tier_source} "
            f"classification) — below the Tier 1-3 bar for this role."
        )
    if cgpa < CGPA_HARD_MIN:
        reasons.append(f"CGPA {cgpa:.2f} is below the required minimum of {CGPA_HARD_MIN:.1f}.")

    if reasons:
        resp.auto_reject = True
        resp.auto_reject_reason = " ".join(reasons)
        resp.college_score = _college_score(tier) if tier <= 3 else 0.0
        resp.cgpa_score = _cgpa_score(cgpa) if cgpa >= CGPA_HARD_MIN else 0.0
        resp.skills_score = None
        resp.project_score = None
        resp.overall_score = None
        resp.recommendation = None
        resp.ai_reasoning = {"college": tier_reasoning} if tier_reasoning else None
        resp.is_ai_scored = tier_source == "ai"
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
        is_ai_scored = tier_source == "ai"  # still AI-scored overall if only the tier call succeeded

    college_score = _college_score(tier)
    cgpa_score = _cgpa_score(cgpa)
    overall = (
        college_score * WEIGHT_COLLEGE
        + cgpa_score * WEIGHT_CGPA
        + skills_score * WEIGHT_SKILLS
        + project_score * WEIGHT_PROJECTS
    )

    resp.college_score = college_score
    resp.cgpa_score = cgpa_score
    resp.skills_score = skills_score
    resp.project_score = project_score
    resp.overall_score = round(overall, 2)
    resp.recommendation = _recommendation(overall)
    resp.auto_reject = False
    resp.auto_reject_reason = None
    resp.ai_reasoning = {
        "college": tier_reasoning,
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
        expires_at=datetime.now(timezone.utc) + timedelta(days=REQUEST_EXPIRY_DAYS),
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
    `applied`."""
    from app.models.application import Application

    application = await db.get(Application, application_id)
    if not application or application.stage != "applied":
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
                notes="Automatically rejected by the screening questionnaire (college tier / CGPA gate).",
                rejection_reason=(
                    "Thank you for completing our screening questionnaire. After reviewing your "
                    "responses against the requirements for this role, we won't be moving forward "
                    "with your application at this time. We encourage you to keep building your "
                    "profile and to apply again in the future."
                ),
                drop_category="profile_mismatch",
            )
        except HTTPException:
            # Stage may have already moved on (e.g. HR acted manually first) —
            # the score is still recorded either way, so this is non-fatal.
            logger.info(f"Auto-reject stage move skipped for application {application.id} (already moved on)")
    elif application.stage == "applied":
        # Passed both hard gates — advance out of "applied" into "screening" so HR
        # sees them (with a score attached) in the Screening column, same as if
        # they'd clicked the move themselves. Only acts from "applied": if HR has
        # already moved the candidate on by the time they submit, their manual
        # action wins and this is a no-op (guarded, not forced).
        try:
            from app.services import application_service
            await application_service.move_stage(
                db,
                application.id,
                "screening",
                moved_by=None,
                notes="Automatically advanced to Screening after passing the AI screening gate.",
            )
        except HTTPException:
            logger.info(f"Auto-advance to screening skipped for application {application.id} (already moved on)")

    return _to_dict(req)


async def get_for_application(db: AsyncSession, application_id: uuid.UUID) -> Optional[dict]:
    req = (await db.execute(
        select(ScreeningResponse).where(ScreeningResponse.application_id == application_id)
    )).scalar_one_or_none()
    if not req:
        return None
    return _to_dict(req)
