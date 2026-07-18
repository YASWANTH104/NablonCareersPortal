"""
Drafts a full job description from short role notes using Azure OpenAI.
Raises if AI is not configured or the call fails — unlike rejection emails,
there is no sane non-AI fallback for "write me a JD".
"""
import json
import logging

logger = logging.getLogger(__name__)


class JDGenerationUnavailable(Exception):
    """Raised when Azure OpenAI is not configured or the call fails."""


def _build_prompt(
    title: str,
    department: str | None,
    location: str | None,
    location_type: str | None,
    employment_type: str | None,
    experience_min: int | None,
    experience_max: int | None,
    notes: str,
) -> str:
    context_lines = [f"Role title: {title}"]
    if department:
        context_lines.append(f"Department: {department}")
    if location:
        context_lines.append(f"Location: {location}")
    if location_type:
        context_lines.append(f"Work mode: {location_type}")
    if employment_type:
        context_lines.append(f"Employment type: {employment_type}")
    if experience_min is not None or experience_max is not None:
        context_lines.append(
            f"Experience: {experience_min or 0}-{experience_max if experience_max is not None else '∞'} years"
        )
    context = "\n".join(context_lines)

    return f"""You are a technical recruiter writing a job posting for Nablon AI, a company that \
builds production-grade agentic AI systems for Fortune 500 clients across CPG, Banking, \
MedTech and Industrial.

Role context:
{context}

Hiring manager's rough notes on the role:
{notes.strip()}

Using the notes and context above, draft a complete job posting. Generate a JSON response \
with exactly these keys:
{{
  "description": "HTML string, 2-4 short paragraphs plus a '<h3>What you'll do</h3>' section \
with a bullet list (<ul><li>...</li></ul>) of 4-6 concrete responsibilities. Use only <p>, \
<h3>, <ul>, <li>, <strong> tags.",
  "requirements": "HTML string: a single <ul> with 5-8 <li> bullet points covering must-have \
skills, experience and qualifications implied by the notes and context. Use only <ul>, <li>, \
<strong> tags.",
  "benefits": "HTML string: a single <ul> with 3-5 <li> bullet points of role-appropriate \
benefits/perks (comp, learning, flexibility, health, equity — infer sensibly, keep generic \
where the notes don't specify). Use only <ul>, <li> tags.",
  "skills_required": ["5 to 10 short skill/technology tags as plain strings, no HTML"]
}}

Rules:
- Base every claim strictly on the notes and context given. Do not invent specific tools, \
frameworks, team names or numbers that were not mentioned or reasonably implied.
- Keep tone professional, specific, and free of buzzword filler ("rockstar", "ninja", "fast-paced \
environment").
- Return only valid JSON, no markdown fences, no extra keys.
"""


async def generate_job_description(
    title: str,
    notes: str,
    department: str | None = None,
    location: str | None = None,
    location_type: str | None = None,
    employment_type: str | None = None,
    experience_min: int | None = None,
    experience_max: int | None = None,
) -> dict:
    """
    Returns dict with keys: description, requirements, benefits, skills_required.
    Raises JDGenerationUnavailable if Azure OpenAI is not configured or the call fails.
    """
    from app.config import settings

    if not (settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_DEPLOYMENT):
        raise JDGenerationUnavailable("Azure OpenAI is not configured")

    try:
        import httpx

        prompt = _build_prompt(
            title, department, location, location_type, employment_type,
            experience_min, experience_max, notes,
        )
        url = (
            f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/"
            f"{settings.AZURE_OPENAI_DEPLOYMENT}/chat/completions"
            f"?api-version={settings.AZURE_OPENAI_API_VERSION}"
        )
        payload = {
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.6,
            "max_tokens": 1400,
            "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={"api-key": settings.AZURE_OPENAI_API_KEY},
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            result = json.loads(raw)

        return {
            "description": result.get("description", ""),
            "requirements": result.get("requirements", ""),
            "benefits": result.get("benefits", ""),
            "skills_required": [s for s in result.get("skills_required", []) if isinstance(s, str)][:10],
        }
    except Exception as exc:
        logger.warning(f"JD generation via Azure OpenAI failed: {exc}")
        raise JDGenerationUnavailable(str(exc)) from exc
