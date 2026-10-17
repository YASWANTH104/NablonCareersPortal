from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    SECRET_KEY: str = "changeme-256-bit-secret"
    ENVIRONMENT: str = "development"
    FRONTEND_URL: str = "http://localhost:5173"
    EXTRA_CORS_ORIGINS: str = ""
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str = "postgresql+asyncpg://nablon:secret@localhost:5432/nablon_careers"

    REDIS_URL: str = "redis://localhost:6379/0"

    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_STORAGE_CONTAINER: str = "nabloncareers"

    EMAIL_FROM_NAME: str = "Nablon AI Careers"

    DIRECTOR_EMAIL: str = ""
    DIRECTOR_NAME: str = "Director"
    HR_NOTIFICATION_EMAIL: str = "hr@nablon.ai"

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_DEPLOYMENT: str = ""
    AZURE_OPENAI_API_VERSION: str = "2024-02-01"

    MS_GRAPH_TENANT_ID: str = ""
    MS_GRAPH_CLIENT_ID: str = ""
    MS_GRAPH_CLIENT_SECRET: str = ""
    MS_GRAPH_MAIL_SENDER: str = "noreply@nablon.ai"

    # AutoProctor results sync (tasks/autoproctor_tasks.py). The admin account
    # logs in with an emailed 6-digit code, which we read from this same
    # mailbox through MS Graph (needs the Mail.Read application permission).
    # Tests must be shared with this account, or their attempts never show
    # up on its Latest attempts page.
    AUTOPROCTOR_ENABLED: bool = True
    AUTOPROCTOR_LOGIN_EMAIL: str = ""
    AUTOPROCTOR_OTP_SENDER: str = ""
    # Attempts finished before this IST date are never imported — the sync
    # starts clean from go-live instead of back-filling the whole history.
    AUTOPROCTOR_SYNC_START: str = "2026-10-17"

    @property
    def ms_graph_configured(self) -> bool:
        return bool(self.MS_GRAPH_TENANT_ID and self.MS_GRAPH_CLIENT_ID and self.MS_GRAPH_CLIENT_SECRET)

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def cors_origins(self) -> List[str]:
        extras = [o.strip() for o in self.EXTRA_CORS_ORIGINS.split(",") if o.strip()]
        return [self.FRONTEND_URL, *extras]


settings = Settings()
