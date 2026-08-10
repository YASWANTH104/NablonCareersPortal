from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.screening import ScreeningResponseSubmit, PublicScreeningResponse
from app.services import screening_service

router = APIRouter(tags=["screening"])


@router.get("/screening/{token}", response_model=PublicScreeningResponse)
async def get_screening_form(token: str, db: AsyncSession = Depends(get_db)):
    return await screening_service.get_public_status(db, token)


@router.post("/screening/{token}", response_model=PublicScreeningResponse)
async def submit_screening_form(
    token: str, data: ScreeningResponseSubmit, db: AsyncSession = Depends(get_db)
):
    return await screening_service.submit(db, token, data)
