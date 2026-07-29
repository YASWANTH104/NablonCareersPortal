import logging
from jinja2 import Environment, FileSystemLoader, select_autoescape
import os

from app.config import settings

logger = logging.getLogger(__name__)

template_dir = os.path.join(os.path.dirname(__file__), "..", "templates", "email")
jinja_env = Environment(
    loader=FileSystemLoader(template_dir),
    autoescape=select_autoescape(["html"]),
)


async def send_email(
    to_email: str | list[str],
    subject: str,
    template_name: str,
    context: dict,
    db=None,
) -> bool:
    try:
        template = jinja_env.get_template(f"{template_name}.html")
        html_content = template.render(**context)

        if settings.AZURE_COMMUNICATION_CONNECTION_STRING and settings.AZURE_EMAIL_SENDER:
            return await _send_via_acs(to_email, subject, html_content)
        else:
            logger.info(f"[DEV] Email to {to_email}: {subject}")
            logger.debug(html_content[:200])
            return True
    except Exception as exc:
        logger.error(f"Failed to send email to {to_email}: {exc}")
        return False


async def _send_via_acs(
    to_email: str | list[str],
    subject: str,
    html_content: str,
    attachments: list[dict] | None = None,
) -> bool:
    import asyncio
    from azure.communication.email import EmailClient

    client = EmailClient.from_connection_string(settings.AZURE_COMMUNICATION_CONNECTION_STRING)

    recipients = [to_email] if isinstance(to_email, str) else to_email
    message = {
        "senderAddress": settings.AZURE_EMAIL_SENDER,
        "recipients": {"to": [{"address": addr} for addr in recipients]},
        "content": {
            "subject": subject,
            "html": html_content,
        },
    }
    if attachments:
        message["attachments"] = attachments

    def _sync_send():
        poller = client.begin_send(message)
        result = poller.result()
        return result.get("status", "").lower() == "succeeded"

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_send)


async def send_email_with_attachment(
    to_email: str | list[str],
    subject: str,
    template_name: str,
    context: dict,
    attachments: list[dict] | None = None,
) -> bool:
    """Send email with optional attachments. Each attachment: {name, contentType, contentInBase64} —
    contentType must be a real MIME type (e.g. "application/pdf"), not a bare
    extension; Azure Communication Services' Email API 400s with "Request body
    validation error. See property 'attachments[0].contentType'" otherwise, and
    also does not recognize a field named attachmentType at all."""
    try:
        template = jinja_env.get_template(f"{template_name}.html")
        html_content = template.render(**context)

        if settings.AZURE_COMMUNICATION_CONNECTION_STRING and settings.AZURE_EMAIL_SENDER:
            return await _send_via_acs(to_email, subject, html_content, attachments)
        else:
            logger.info(f"[DEV] Email+attachment to {to_email}: {subject} (attachments: {len(attachments or [])})")
            return True
    except Exception as exc:
        logger.error(f"Failed to send email+attachment to {to_email}: {exc}")
        return False


async def send_verification_email(to_email: str, full_name: str, token: str) -> bool:
    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    return await send_email(
        to_email=to_email,
        subject="Verify your Nablon AI Careers account",
        template_name="email_verify",
        context={"full_name": full_name, "verify_url": verify_url},
    )


async def send_password_reset_email(to_email: str, full_name: str, token: str) -> bool:
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    return await send_email(
        to_email=to_email,
        subject="Reset your Nablon AI Careers password",
        template_name="password_reset",
        context={"full_name": full_name, "reset_url": reset_url},
    )


async def send_team_invite_email(to_email: str, full_name: str, role_label: str, token: str) -> bool:
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    return await send_email(
        to_email=to_email,
        subject="You've been invited to Nablon AI Careers Portal",
        template_name="team_invite",
        context={"full_name": full_name, "role_label": role_label, "reset_url": reset_url},
    )
