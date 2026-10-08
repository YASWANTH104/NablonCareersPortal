import asyncio
import logging

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

DIGEST_MAX_ITEMS = 25


def _task_session():
    from app.tasks.email_tasks import _task_session as _shared
    return _shared()


@celery_app.task(name="send_action_center_digests")
def send_action_center_digests():
    """Weekday 9:00 IST: each active HR/TA user gets one email listing the
    Action Center items in THEIR queue (handler = them, plus unclaimed
    candidates on jobs they posted) that are due or overdue. Waiting and
    snoozed items are left out; nobody with an empty queue is emailed.

    Idempotent per IST day: each recipient is claimed with a conditional
    UPDATE on users.last_action_digest_on and committed BEFORE sending, the
    same claim-then-send shape as send_delayed_screening_rejection_emails —
    so a beat that double-fires during a deploy can't email anyone twice.
    The trade-off is deliberate: a send that fails after the claim means that
    person gets no digest that day rather than a duplicate."""
    from datetime import datetime, timezone
    from sqlalchemy import select, update, or_
    from app.config import settings
    from app.models.user import User
    from app.services import action_center_service as svc
    from app.services.email_service import send_email
    from app.utils.timezone import IST

    async def _run():
        today = datetime.now(timezone.utc).astimezone(IST).date()
        sent = 0
        async with _task_session() as db:
            items = [i for i in await svc.compute_actions(db) if not i["snoozed"] and i["severity"] != "waiting"]
            if not items:
                return 0
            users = (await db.execute(
                select(User).where(User.role.in_(("hr_manager", "admin", "super_admin")), User.is_active.is_(True))
            )).scalars().all()

            for u in users:
                mine = [i for i in items if svc.in_scope(i, "mine", u.id)]
                if not mine:
                    continue
                claimed = (await db.execute(
                    update(User)
                    .where(User.id == u.id, or_(User.last_action_digest_on.is_(None), User.last_action_digest_on < today))
                    .values(last_action_digest_on=today)
                    .returning(User.id)
                )).first()
                await db.commit()
                if not claimed:
                    continue

                overdue = [i for i in mine if i["severity"] == "overdue"]
                due = [i for i in mine if i["severity"] == "due"]
                shown = (overdue + due)[:DIGEST_MAX_ITEMS]
                for i in shown:
                    i["url"] = f"{settings.FRONTEND_URL}/hr/applicants/{i['application_id']}?tab={i['tab']}"
                ok = await send_email(
                    to_email=u.email,
                    subject=(
                        f"{len(overdue)} overdue, {len(due)} due today — your hiring actions"
                        if overdue else f"{len(due)} hiring action{'s' if len(due) != 1 else ''} for today"
                    ),
                    template_name="action_digest",
                    context={
                        "full_name": u.full_name.split(" ")[0] if u.full_name else "there",
                        "overdue_count": len(overdue),
                        "due_count": len(due),
                        "items": shown,
                        "hidden_count": len(mine) - len(shown),
                        "action_center_url": f"{settings.FRONTEND_URL}/hr/action-center",
                        "date_label": today.strftime("%A, %d %B"),
                    },
                )
                if ok:
                    sent += 1
                else:
                    logger.error(f"Action digest send failed for {u.email}")
        return sent

    count = asyncio.run(_run())
    return f"Sent {count} action digest email(s)"
