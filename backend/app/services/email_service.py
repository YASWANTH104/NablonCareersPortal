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
    to_email: str,
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


async def _send_via_acs(to_email: str, subject: str, html_content: str) -> bool:
    from azure.communication.email import EmailClient

    client = EmailClient.from_connection_string(settings.AZURE_COMMUNICATION_CONNECTION_STRING)

    message = {
        "senderAddress": settings.AZURE_EMAIL_SENDER,
        "recipients": {"to": [{"address": to_email}]},
        "content": {
            "subject": subject,
            "html": html_content,
        },
    }

    poller = client.begin_send(message)
    result = poller.result()
    return result.get("status", "").lower() == "succeeded"


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
