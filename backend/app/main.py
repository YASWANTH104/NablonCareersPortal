from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from app.config import settings
from app.routers import auth, users, jobs, applications, referrals, interviews, assessments, offers, dashboard, notifications, uploads, reports, documents, agencies


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="Nablon AI Careers API",
    version="1.0.0",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.is_production:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["careers.nablon.ai", "*.nablon.ai", "careers-backend.calmwater-2ad5117a.centralindia.azurecontainerapps.io"],
    )

prefix = settings.API_V1_PREFIX

app.include_router(auth.router, prefix=prefix)
app.include_router(users.router, prefix=prefix)
app.include_router(jobs.router, prefix=prefix)
app.include_router(applications.router, prefix=prefix)
app.include_router(referrals.router, prefix=prefix)
app.include_router(interviews.router, prefix=prefix)
app.include_router(assessments.router, prefix=prefix)
app.include_router(offers.router, prefix=prefix)
app.include_router(dashboard.router, prefix=prefix)
app.include_router(notifications.router, prefix=prefix)
app.include_router(reports.router, prefix=prefix)
app.include_router(uploads.router, prefix=prefix)
app.include_router(documents.router, prefix=prefix)
app.include_router(agencies.router, prefix=prefix)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


# Serve locally uploaded files in development
_uploads_dir = Path(__file__).resolve().parent.parent.parent / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")
