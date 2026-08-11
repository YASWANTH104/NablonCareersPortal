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

        from app.services import ms_graph_service

        if ms_graph_service.is_configured():
            return await _send_via_graph(to_email, subject, html_content)
        else:
            logger.info(f"[DEV] Email to {to_email}: {subject}")
            logger.debug(html_content[:200])
            return True
    except Exception as exc:
        logger.error(f"Failed to send email to {to_email}: {exc}")
        return False


async def _send_via_graph(
    to_email: str | list[str],
    subject: str,
    html_content: str,
    attachments: list[dict] | None = None,
) -> bool:
    """Sends via Microsoft Graph's sendMail, as the noreply@nablon.ai shared
    mailbox — the sole email transport now; ACS has been fully retired.
    Reuses the same app-only token/app registration as the Teams calendar
    integration (ms_graph_service), which already has Mail.Send consented
    alongside Calendars.ReadWrite.

    `attachments`, when given, use the same {name, contentType, contentInBase64}
    shape callers already built for the old ACS path — translated here into
    Graph's fileAttachment shape so nothing upstream (offer letters, report
    exports) had to change."""
    import httpx
    from app.services import ms_graph_service

    token = await ms_graph_service._get_app_token()
    recipients = [to_email] if isinstance(to_email, str) else to_email
    message = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": html_content},
        "toRecipients": [{"emailAddress": {"address": addr}} for addr in recipients],
    }
    if attachments:
        message["attachments"] = [
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": a["name"],
                "contentType": a["contentType"],
                "contentBytes": a["contentInBase64"],
            }
            for a in attachments
        ]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://graph.microsoft.com/v1.0/users/{settings.MS_GRAPH_MAIL_SENDER}/sendMail",
            headers={"Authorization": f"Bearer {token}"},
            json={"message": message, "saveToSentItems": "true"},
        )

    if resp.status_code == 202:
        return True
    logger.error(f"Graph sendMail failed ({resp.status_code}): {resp.text[:300]}")
    return False


async def send_email_with_attachment(
    to_email: str | list[str],
    subject: str,
    template_name: str,
    context: dict,
    attachments: list[dict] | None = None,
) -> bool:
    """Send email with optional attachments. Each attachment: {name, contentType, contentInBase64}."""
    try:
        template = jinja_env.get_template(f"{template_name}.html")
        html_content = template.render(**context)

        from app.services import ms_graph_service

        if ms_graph_service.is_configured():
            return await _send_via_graph(to_email, subject, html_content, attachments)
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
