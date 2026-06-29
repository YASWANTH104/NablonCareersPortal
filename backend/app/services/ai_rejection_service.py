"""
Generates personalized rejection email content using Azure OpenAI.
Falls back to raw feedback if AI is not configured or call fails.
"""
import logging
from typing import Any

logger = logging.getLogger(__name__)

_STAGE_LABELS = {
    "applied":    "initial application review",
    "screening":  "screening interview",
    "assessment": "technical assessment",
    "tr1":        "Technical Round 1 interview",
    "tr2":        "Technical Round 2 interview",
    "hr":         "HR interview",
    "offer":      "offer stage",
}


def _build_prompt(
    candidate_name: str,
    job_title: str,
    from_stage: str,
    feedbacks: list[dict],
) -> str:
    stage_label = _STAGE_LABELS.get(from_stage, from_stage)
    feedback_text = ""

    for i, fb in enumerate(feedbacks, 1):
        parts = [f"Round {i} ({fb.get('round_label', 'Interview')})"]
        if fb.get("overall_rating"):
            parts.append(f"  Overall rating: {fb['overall_rating']}/10")
        if fb.get("technical_score"):
            parts.append(f"  Technical: {fb['technical_score']}/10")
        if fb.get("communication_score"):
            parts.append(f"  Communication: {fb['communication_score']}/10")
        if fb.get("cultural_fit_score"):
            parts.append(f"  Cultural fit: {fb['cultural_fit_score']}/10")
        if fb.get("problem_solving_score"):
            parts.append(f"  Problem solving: {fb['problem_solving_score']}/10")
        if fb.get("strengths"):
            parts.append(f"  Strengths: {fb['strengths']}")
        if fb.get("weaknesses"):
            parts.append(f"  Areas to improve: {fb['weaknesses']}")
        if fb.get("notes"):
            parts.append(f"  Interviewer notes: {fb['notes']}")
        if fb.get("recommendation"):
            parts.append(f"  Recommendation: {fb['recommendation']}")
        feedback_text += "\n".join(parts) + "\n\n"

    return f"""You are a compassionate, professional HR communications writer at Nablon AI.

Write a personalized rejection email body for a candidate who was not selected after the {stage_label}.

Candidate: {candidate_name}
Role applied for: {job_title}
Stage rejected from: {stage_label}

Interviewer feedback from all rounds:
{feedback_text.strip()}

Generate a JSON response with exactly these four keys:
{{
  "opening": "2-3 sentence warm, personalized opening paragraph acknowledging their effort at the {stage_label}. Do NOT use generic phrases like 'we regret to inform you'.",
  "strengths": "2-4 sentences summarising the genuine strengths observed across all rounds. Be specific and reference actual feedback points.",
  "improvements": "2-4 sentences on clear, constructive areas to work on. Be honest but encouraging — frame as growth opportunities, not failures.",
  "encouragement": "2-3 sentences encouraging them to reapply after 6 months once they have worked on those areas. Make it feel like a genuine invitation, not a formality."
}}

Rules:
- Use the candidate's first name naturally in the opening.
- Be warm, honest, and human — not corporate.
- Base strengths and improvements strictly on the feedback provided.
- Do not invent details not present in the feedback.
- Return only valid JSON, no markdown fences.
"""


def _fallback_content(feedbacks: list[dict]) -> dict:
    """Returns raw feedback as plain text when AI is unavailable."""
    all_strengths = [fb["strengths"] for fb in feedbacks if fb.get("strengths")]
    all_weaknesses = [fb["weaknesses"] for fb in feedbacks if fb.get("weaknesses")]

    return {
        "opening": None,
        "strengths": " ".join(all_strengths) if all_strengths else None,
        "improvements": " ".join(all_weaknesses) if all_weaknesses else None,
        "encouragement": None,
        "is_ai_generated": False,
    }


async def generate_rejection_content(
    candidate_name: str,
    job_title: str,
    from_stage: str,
    feedbacks: list[dict],
) -> dict[str, Any]:
    """
    Returns dict with keys: opening, strengths, improvements, encouragement, is_ai_generated.
    Falls back gracefully if Azure OpenAI is not configured or the call fails.
    """
    from app.config import settings

    # --- AZURE OPENAI CALL (wire up when credentials are ready) ---
    if settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_DEPLOYMENT:
        try:
            import httpx, json

            prompt = _build_prompt(candidate_name, job_title, from_stage, feedbacks)
            url = (
                f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/"
                f"{settings.AZURE_OPENAI_DEPLOYMENT}/chat/completions"
                f"?api-version={settings.AZURE_OPENAI_API_VERSION}"
            )
            payload = {
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
                "max_tokens": 800,
            }
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    url,
                    json=payload,
                    headers={"api-key": settings.AZURE_OPENAI_API_KEY},
                )
                resp.raise_for_status()
                raw = resp.json()["choices"][0]["message"]["content"]
                result = json.loads(raw)
                result["is_ai_generated"] = True
                return result
        except Exception as exc:
            logger.warning(f"Azure OpenAI call failed, falling back to raw feedback: {exc}")

    # --- FALLBACK ---
    return _fallback_content(feedbacks)
