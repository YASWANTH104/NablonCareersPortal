import re
import uuid


def generate_slug(title: str) -> str:
    slug = title.lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    slug = slug.strip("-")
    unique_suffix = str(uuid.uuid4())[:8]
    return f"{slug}-{unique_suffix}"
