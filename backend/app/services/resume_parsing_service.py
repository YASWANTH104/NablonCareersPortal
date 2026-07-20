"""
Extracts structured candidate fields from an uploaded resume so apply forms
can be auto-filled (candidate/agency/HR then corrects before submitting).

Text extraction: pypdf for PDF, python-docx for DOCX.
Field extraction: Azure OpenAI (same httpx pattern as ai_rejection_service);
falls back to regex-only extraction (email/phone/links) when AI is unavailable.
"""
import io
import re
import logging
from typing import Any

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 15000  # plenty for a resume, keeps the prompt bounded

PARSED_FIELDS = [
    "full_name", "email", "phone", "current_location", "total_experience",
    "current_company", "current_designation", "education", "skills",
    "linkedin_url", "github_url", "portfolio_url",
]


def extract_text(content: bytes, content_type: str, filename: str = "") -> str:
    """Best-effort plain-text extraction. Returns '' when the format is unsupported."""
    name = (filename or "").lower()
    try:
        if content_type == "application/pdf" or name.endswith(".pdf"):
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            return "\n".join((page.extract_text() or "") for page in reader.pages)

        if (
            content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            or name.endswith(".docx")
        ):
            from docx import Document
            doc = Document(io.BytesIO(content))
            parts = [p.text for p in doc.paragraphs]
            for table in doc.tables:
                for row in table.rows:
                    parts.extend(cell.text for cell in row.cells)
            return "\n".join(parts)
    except Exception as exc:
        logger.warning(f"Resume text extraction failed ({content_type}): {exc}")

    return ""


def _regex_fallback(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {k: None for k in PARSED_FIELDS}

    email = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
    if email:
        result["email"] = email.group(0)

    phone = re.search(r"(?:\+91[\s-]?)?[6-9]\d{9}|\+\d{1,3}[\s-]?\d{6,12}", text)
    if phone:
        result["phone"] = phone.group(0).strip()

    linkedin = re.search(r"(?:https?://)?(?:www\.)?linkedin\.com/in/[\w\-./]+", text, re.I)
    if linkedin:
        url = linkedin.group(0)
        result["linkedin_url"] = url if url.startswith("http") else f"https://{url}"

    github = re.search(r"(?:https?://)?(?:www\.)?github\.com/[\w\-./]+", text, re.I)
    if github:
        url = github.group(0)
        result["github_url"] = url if url.startswith("http") else f"https://{url}"

    result["is_ai_parsed"] = False
    return result


def _build_prompt(text: str) -> str:
    return f"""You are a resume parser for a careers portal. Extract candidate details from the resume text below.

Resume text:
\"\"\"
{text[:MAX_TEXT_CHARS]}
\"\"\"

Return a JSON object with exactly these keys (use null when the resume does not state a value — never guess or invent):
{{
  "full_name": "candidate's full name",
  "email": "email address",
  "phone": "phone number",
  "current_location": "city/country the candidate is based in",
  "total_experience": "total professional experience, e.g. '5 years'",
  "current_company": "most recent employer ('Fresher' if none)",
  "current_designation": "most recent job title",
  "education": "highest/most recent qualification, e.g. 'B.Tech, CSE, IIT Delhi'",
  "skills": "comma-separated list of key skills",
  "linkedin_url": "LinkedIn profile URL",
  "github_url": "GitHub profile URL",
  "portfolio_url": "personal website/portfolio URL"
}}

Rules:
- Every value must be a string or null. No nested objects or arrays.
- Copy values from the resume; do not fabricate anything that is not present.
- Return only valid JSON, no markdown fences."""


async def parse_resume(content: bytes, content_type: str, filename: str = "") -> dict[str, Any]:
    """
    Returns dict with PARSED_FIELDS keys plus 'is_ai_parsed'.
    Never raises — degrades to regex extraction, then to empty fields.
    """
    from app.config import settings

    text = extract_text(content, content_type, filename)
    if not text.strip():
        return {**{k: None for k in PARSED_FIELDS}, "is_ai_parsed": False}

    if settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_DEPLOYMENT:
        try:
            import httpx, json

            url = (
                f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/"
                f"{settings.AZURE_OPENAI_DEPLOYMENT}/chat/completions"
                f"?api-version={settings.AZURE_OPENAI_API_VERSION}"
            )
            payload = {
                "messages": [{"role": "user", "content": _build_prompt(text)}],
                "temperature": 0,
                "max_tokens": 800,
                "response_format": {"type": "json_object"},
            }
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    url,
                    json=payload,
                    headers={"api-key": settings.AZURE_OPENAI_API_KEY},
                )
                resp.raise_for_status()
                raw = resp.json()["choices"][0]["message"]["content"]
                parsed = json.loads(raw)

            result = {}
            for key in PARSED_FIELDS:
                val = parsed.get(key)
                result[key] = val.strip() if isinstance(val, str) and val.strip() else None
            result["is_ai_parsed"] = True
            return result
        except Exception as exc:
            logger.warning(f"Azure OpenAI resume parsing failed, falling back to regex: {exc}")

    return _regex_fallback(text)
