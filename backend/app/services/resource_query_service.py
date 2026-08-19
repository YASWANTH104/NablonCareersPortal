"""Natural-language search over the resource pool ("show unallocated
associates", "how many interns do we have").

The query is translated into a small set of structured filters — never a raw
DB query the model writes itself — which then run through
resource_service.list_employee_profiles exactly like a normal filtered list
call. This keeps results deterministic and fast even when Azure OpenAI is
configured, and degrades to a keyword heuristic when it isn't, matching the
same fail-open convention as ai_rejection_service.py / jd_generation_service.py.
"""
import logging
import re

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.resource import Project
from app.schemas.resource import ResourceSearchResponse, EMPLOYMENT_TYPES, BILLING_STATUSES
from app.services import resource_service

logger = logging.getLogger(__name__)

_KNOWN_SKILLS = [
    "Python", "Java", "JavaScript", "TypeScript", "React", "Angular", "Vue",
    "Node", "Node.js", "AWS", "Azure", "GCP", "Machine Learning", "ML", "AI",
    "Deep Learning", "SQL", "PostgreSQL", "MongoDB", "DevOps", "Kubernetes",
    "Docker", ".NET", "C#", "C++", "Go", "Golang", "Rust", "FastAPI", "Django",
    "Flask", "Spring", "Salesforce", "Data Engineering", "Data Science",
    "NLP", "Computer Vision", "Terraform", "CI/CD",
]


def _build_prompt(nl_query: str) -> str:
    return f"""You are a query interpreter for an internal HR/resource-management tool
at Nablon AI. Translate the user's natural-language question about internal
associates (employees) into a structured JSON filter object.

Question: "{nl_query}"

Return a JSON object with exactly these keys (use null where not applicable):
{{
  "intent": "count" or "list" — "count" only if the user is explicitly asking how many/count,
  "employment_type": one of {list(EMPLOYMENT_TYPES)} or null,
  "billing_status": one of {list(BILLING_STATUSES)} or null,
  "unallocated": true if asking for people with no current project/bench/not staffed, false if asking for people who ARE currently allocated, otherwise null,
  "department": a department name mentioned, or null,
  "project_name": a specific project name mentioned, or null,
  "skill_keywords": a list of specific skills/technologies mentioned (e.g. ["Python", "AWS"]), or null,
  "search": any free-text name/keyword search that doesn't fit the above, or null
}}

Rules:
- Only set fields the question actually implies. Leave everything else null.
- "bench" or "not allocated" or "not staffed" or "without a project" means unallocated=true.
- Return only valid JSON, no markdown fences.
"""


def _heuristic_interpret(nl_query: str) -> dict:
    q = nl_query.lower()
    filters: dict = {
        "intent": "list", "employment_type": None, "billing_status": None,
        "unallocated": None, "department": None, "project_name": None,
        "skill_keywords": None, "search": None,
    }

    if any(w in q for w in ["how many", "count of", "number of", "no. of"]):
        filters["intent"] = "count"

    for et in EMPLOYMENT_TYPES:
        if et.replace("_", " ") in q or et.replace("_", "-") in q:
            filters["employment_type"] = et
            break
    if filters["employment_type"] is None and "intern" in q:
        filters["employment_type"] = "intern"

    if any(w in q for w in [
        "not allocated", "unallocated", "on bench", "on the bench", "bench",
        "without a project", "no project", "not staffed", "not on a project",
        "not currently allocated",
    ]):
        filters["unallocated"] = True
    elif any(w in q for w in ["allocated", "staffed", "on a project", "assigned to a project"]):
        filters["unallocated"] = False

    if "non-billable" in q or "non billable" in q or "not billable" in q:
        filters["billing_status"] = "non_billable"
    elif "billable" in q:
        filters["billing_status"] = "billable"
    elif "training" in q:
        filters["billing_status"] = "training"
    elif "bench" in q and filters["billing_status"] is None:
        filters["billing_status"] = "bench"

    m = re.search(r"(?:on|for|working on)\s+(?:the\s+)?(?:project\s+)?['\"]?([A-Z][\w&.\- ]{2,40})['\"]?", nl_query)
    if m and "project" in q:
        filters["project_name"] = m.group(1).strip()

    found_skills = [s for s in _KNOWN_SKILLS if s.lower() in q]
    if found_skills:
        filters["skill_keywords"] = found_skills

    return filters


async def interpret_query(nl_query: str) -> tuple[dict, bool]:
    """Returns (filters, is_ai_interpreted)."""
    from app.config import settings

    if settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_DEPLOYMENT:
        try:
            import httpx, json

            prompt = _build_prompt(nl_query)
            url = (
                f"{settings.AZURE_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/"
                f"{settings.AZURE_OPENAI_DEPLOYMENT}/chat/completions"
                f"?api-version={settings.AZURE_OPENAI_API_VERSION}"
            )
            payload = {
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": 400,
            }
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(url, json=payload, headers={"api-key": settings.AZURE_OPENAI_API_KEY})
                resp.raise_for_status()
                raw = resp.json()["choices"][0]["message"]["content"]
                filters = json.loads(raw)
                return filters, True
        except Exception as exc:
            logger.warning(f"Azure OpenAI call failed, falling back to heuristic query parsing: {exc}")

    return _heuristic_interpret(nl_query), False


def _build_summary(filters: dict, count: int) -> str:
    descriptors = []
    if filters.get("employment_type"):
        descriptors.append(f"{filters['employment_type'].replace('_', ' ')}s")
    if filters.get("unallocated") is True:
        descriptors.append("not currently allocated to any project")
    elif filters.get("unallocated") is False:
        descriptors.append("currently allocated to a project")
    if filters.get("billing_status"):
        descriptors.append(f"marked {filters['billing_status'].replace('_', ' ')}")
    if filters.get("department"):
        descriptors.append(f"in {filters['department']}")
    if filters.get("project_name"):
        descriptors.append(f"on {filters['project_name']}")
    if filters.get("skill_keywords"):
        descriptors.append(f"with skills matching {', '.join(filters['skill_keywords'])}")
    if filters.get("search"):
        descriptors.append(f"matching \"{filters['search']}\"")

    noun = "associate" if count == 1 else "associates"
    if not descriptors:
        return f"Found {count} {noun}."
    return f"Found {count} {noun} who are " + ", ".join(descriptors) + "."


async def run_search(db: AsyncSession, nl_query: str) -> ResourceSearchResponse:
    filters, is_ai = await interpret_query(nl_query)

    project_id = None
    if filters.get("project_name"):
        project = (await db.execute(
            select(Project).where(Project.name.ilike(f"%{filters['project_name']}%"))
        )).scalars().first()
        if project:
            project_id = project.id

    skill = filters["skill_keywords"][0] if filters.get("skill_keywords") else None

    results = await resource_service.list_employee_profiles(
        db,
        project_id=project_id,
        billing_status=filters.get("billing_status"),
        employment_type=filters.get("employment_type"),
        department=filters.get("department"),
        unallocated=filters.get("unallocated"),
        skill=skill,
        search=filters.get("search"),
    )

    return ResourceSearchResponse(
        summary=_build_summary(filters, len(results)),
        count=len(results),
        interpreted_as=filters,
        is_ai_interpreted=is_ai,
        results=results[:100],
    )
