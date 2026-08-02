import ssl

from celery import Celery
from app.config import settings

celery_app = Celery(
    "nablon_careers",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.tasks.email_tasks", "app.tasks.pdf_tasks", "app.tasks.interview_tasks"],
)

conf = dict(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    beat_schedule={
        "auto-complete-past-interviews": {
            "task": "auto_complete_past_interviews",
            "schedule": 300,  # every 5 minutes
        },
        "send-feedback-reminders": {
            "task": "send_feedback_reminders",
            "schedule": 900,  # every 15 minutes
        },
    },
)

# rediss:// (TLS, e.g. Azure Cache for Redis's SSL port) requires ssl_cert_reqs to be
# set explicitly or celery's redis transport refuses to start at all — it doesn't
# infer anything from the URL alone. Setting it here means this works regardless of
# whether the URL itself carries a ?ssl_cert_reqs= query param.
if settings.CELERY_BROKER_URL.startswith("rediss://"):
    conf["broker_use_ssl"] = {"ssl_cert_reqs": ssl.CERT_REQUIRED}
if settings.CELERY_RESULT_BACKEND.startswith("rediss://"):
    conf["redis_backend_use_ssl"] = {"ssl_cert_reqs": ssl.CERT_REQUIRED}

celery_app.conf.update(**conf)
