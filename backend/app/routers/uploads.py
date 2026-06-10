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
