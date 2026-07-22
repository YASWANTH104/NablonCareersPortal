"""
Turns an uploaded JD document (a designed PDF/DOCX) into the portal's structured
job fields so HR can attach the original file AND have the on-page description
auto-filled from it (HR reviews/edits before saving).

Text extraction reuses resume_parsing_service.extract_text (pypdf / python-docx).
Field extraction uses Azure OpenAI (same httpx pattern as jd_generation_service);
when AI is unavailable it degrades to putting the raw extracted text into the
description so nothing is lost.
"""
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 18000  # a formatted JD is longer than a resume; keep prompt bounded


def _int_or_none(val: Any) -> int | None:
    if val is None:
        return None
    if isinstance(val, int):
        return val
    m = re.search(r"\d+", str(val))
    return int(m.group(0)) if m else None


def _text_to_html(text: str) -> str:
    """Minimal, safe HTML fallback: paragraphs from the raw extracted text."""
    from html import escape

    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paras:
        paras = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return "".join(f"<p>{escape(p)}</p>" for p in paras[:60])


def _build_prompt(text: str) -> str:
    return f"""You are parsing a company's job-description document into structured fields \
for a careers portal. Below is the raw text extracted from an uploaded JD (a designed PDF/DOCX), \
so formatting and column order may be imperfect.

Raw JD text:
\"\"\"
{text[:MAX_TEXT_CHARS]}
\"\"\"

Rewrite the content into clean, well-structured fields. Return a JSON object with exactly these keys:
{{
  "title": "the role title, or null if not stated",
  "location": "primary location, or null",
  "employment_type": "one of full_time|part_time|contract|internship|freelance, or null",
  "experience_min": "minimum years of experience as an integer, or null",
  "experience_max": "maximum years of experience as an integer, or null",
  "description": "HTML string: an overview of the role, team and mission drawn from the JD, \
2-4 short paragraphs plus a '<h3>What you'll do</h3>' section with a <ul><li>...</li></ul> of \
responsibilities. Use only <p>, <h3>, <ul>, <li>, <strong> tags.",
  "requirements": "HTML string: a single <ul> of <li> bullets for required/preferred \
qualifications and skills. Use only <ul>, <li>, <strong> tags.",
  "benefits": "HTML string: a single <ul> of <li> bullets for benefits/perks mentioned, or an \
empty string if the JD states none. Use only <ul>, <li> tags.",
  "skills_required": ["short skill/technology tags as plain strings, up to 12"]
}}

Rules:
- Use ONLY information present in the JD text. Do not invent tools, numbers or benefits not stated.
- Preserve the substance and tone of the original JD; reorganize, don't summarize away detail.
- Every value must be a string, integer or null (skills_required is an array of strings).
- Return only valid JSON, no markdown fences, no extra keys."""


async def parse_jd_document(content: bytes, content_type: str, filename: str = "") -> dict[str, Any]:
    """
    Returns dict with keys: title, location, employment_type, experience_min,
    experience_max, description, requirements, benefits, skills_required, parsed.
    Never raises — degrades to raw-text-in-description when AI/text extraction is unavailable.
    """
    from app.config import settings
    from app.services import resume_parsing_service

    empty = {
        "title": None, "location": None, "employment_type": None,
        "experience_min": None, "experience_max": None,
        "description": "", "requirements": "", "benefits": "",
        "skills_required": [], "parsed": False,
    }

    text = resume_parsing_service.extract_text(content, content_type, filename)
    if not text.strip():
        return empty

    if settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_DEPLOYMENT:
        try:
            import httpx

            url = (
                f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/"
                f"{settings.AZURE_OPENAI_DEPLOYMENT}/chat/completions"
                f"?api-version={settings.AZURE_OPENAI_API_VERSION}"
            )
            payload = {
                "messages": [{"role": "user", "content": _build_prompt(text)}],
                "temperature": 0.3,
                "max_tokens": 2000,
                "response_format": {"type": "json_object"},
            }
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    url, json=payload, headers={"api-key": settings.AZURE_OPENAI_API_KEY}
                )
                resp.raise_for_status()
                raw = resp.json()["choices"][0]["message"]["content"]
                result = json.loads(raw)

            et = result.get("employment_type")
            valid_et = {"full_time", "part_time", "contract", "internship", "freelance"}
            return {
                "title": (result.get("title") or None),
                "location": (result.get("location") or None),
                "employment_type": et if et in valid_et else None,
                "experience_min": _int_or_none(result.get("experience_min")),
                "experience_max": _int_or_none(result.get("experience_max")),
                "description": result.get("description") or _text_to_html(text),
                "requirements": result.get("requirements") or "",
                "benefits": result.get("benefits") or "",
                "skills_required": [s for s in (result.get("skills_required") or []) if isinstance(s, str)][:12],
                "parsed": True,
            }
        except Exception as exc:
            logger.warning(f"JD PDF parsing via Azure OpenAI failed, using raw text: {exc}")

    # AI unavailable — keep the content by dropping the raw text into the description.
    return {**empty, "description": _text_to_html(text)}
