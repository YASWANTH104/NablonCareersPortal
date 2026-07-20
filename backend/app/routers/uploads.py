from fastapi import APIRouter, Depends, UploadFile, File
from pydantic import BaseModel

from app.dependencies import get_current_user
from app.services import storage_service

router = APIRouter(prefix="/uploads", tags=["uploads"])


class UploadResponse(BaseModel):
    url: str


@router.post("/resume", response_model=UploadResponse)
async def upload_resume(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    url = await storage_service.upload_resume(file, str(current_user.id))
    return {"url": url}


@router.post("/avatar", response_model=UploadResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    url = await storage_service.upload_avatar(file, str(current_user.id))
    return {"url": url}


@router.post("/parse-resume")
async def parse_resume(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Extract candidate fields from a resume so the apply form can be auto-filled."""
    from app.services import resume_parsing_service

    content = await file.read()
    return await resume_parsing_service.parse_resume(
        content, file.content_type or "", file.filename or ""
    )
