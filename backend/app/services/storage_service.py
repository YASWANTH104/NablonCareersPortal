import uuid
from pathlib import Path
from fastapi import UploadFile, HTTPException

from app.config import settings


ALLOWED_RESUME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_RESUME_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_IMAGE_SIZE = 5 * 1024 * 1024    # 5 MB


def _azure_configured() -> bool:
    return bool(settings.AZURE_STORAGE_CONNECTION_STRING)


async def upload_resume(file: UploadFile, user_id: str) -> str:
    content = await file.read()

    if len(content) > MAX_RESUME_SIZE:
        raise HTTPException(400, "File too large. Max 10 MB allowed.")

    if file.content_type not in ALLOWED_RESUME_TYPES:
        raise HTTPException(400, "Invalid file type. Only PDF and Word documents are allowed.")

    ext = Path(file.filename or "resume.pdf").suffix or ".pdf"
    blob_name = f"resumes/{user_id}/{uuid.uuid4()}{ext}"

    if _azure_configured():
        return await _upload_to_azure(content, blob_name, file.content_type)
    return await _save_locally(content, blob_name)


async def upload_avatar(file: UploadFile, user_id: str) -> str:
    content = await file.read()

    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(400, "File too large. Max 5 MB allowed.")

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Invalid file type. Only images are allowed.")

    ext = Path(file.filename or "avatar.jpg").suffix or ".jpg"
    blob_name = f"avatars/{user_id}/{uuid.uuid4()}{ext}"

    if _azure_configured():
        return await _upload_to_azure(content, blob_name, file.content_type)
    return await _save_locally(content, blob_name)


async def _upload_to_azure(content: bytes, blob_name: str, content_type: str) -> str:
    from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions, ContentSettings
    from azure.core.exceptions import AzureError
    from datetime import datetime, timedelta, timezone

    try:
        client = BlobServiceClient.from_connection_string(settings.AZURE_STORAGE_CONNECTION_STRING)
        container = client.get_container_client(settings.AZURE_STORAGE_CONTAINER)
        if not container.exists():
            container.create_container()
        blob = container.get_blob_client(blob_name)

        blob.upload_blob(content, overwrite=True, content_settings=ContentSettings(content_type=content_type))

        # Parse account name and key from connection string for SAS URL generation
        conn_parts = dict(
            part.split("=", 1)
            for part in settings.AZURE_STORAGE_CONNECTION_STRING.split(";")
            if "=" in part
        )
        account_name = conn_parts.get("AccountName", "")
        account_key = conn_parts.get("AccountKey", "")

        sas_token = generate_blob_sas(
            account_name=account_name,
            container_name=settings.AZURE_STORAGE_CONTAINER,
            blob_name=blob_name,
            account_key=account_key,
            permission=BlobSasPermissions(read=True),
            expiry=datetime.now(timezone.utc) + timedelta(days=7),
        )

        return f"https://{account_name}.blob.core.windows.net/{settings.AZURE_STORAGE_CONTAINER}/{blob_name}?{sas_token}"

    except AzureError as exc:
        raise HTTPException(500, f"Azure upload failed: {exc}") from exc


async def _save_locally(content: bytes, relative_path: str) -> str:
    file_path = Path("/app/uploads") / relative_path
    file_path.parent.mkdir(parents=True, exist_ok=True)

    with open(file_path, "wb") as fh:
        fh.write(content)

    return f"/uploads/{relative_path}"
