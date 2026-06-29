from celery import Celery
from app.config import settings

celery_app = Celery(
    "nablon_careers",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.tasks.email_tasks", "app.tasks.pdf_tasks", "app.tasks.interview_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    beat_schedule={
        "auto-complete-past-interviews": {
            "task": "auto_complete_past_interviews",
            "schedule": 900,  # every 15 minutes
        },
        "send-feedback-reminders": {
            "task": "send_feedback_reminders",
            "schedule": 900,  # every 15 minutes
        },
    },
)
