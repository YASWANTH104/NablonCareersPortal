from datetime import datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def format_ist(dt: datetime | None, fallback: str = "TBD") -> str:
    """Format a stored UTC datetime as an IST wall-clock string for emails/notifications."""
    if dt is None:
        return fallback
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(IST).strftime("%A, %d %B %Y at %I:%M %p IST")
