"""One-off operational script: re-queue the Teams meeting + "Interview Scheduled"
emails for interviews created while the Celery worker was down.

Why this exists: the 2026-11-10 ~11:33 UTC rebuild pulled an unpinned kombu 5.7,
which refuses redis-py < 6.1. The worker and beat crash-looped from then until
the kombu pin shipped, and the API's .delay() calls failed silently (swallowed in
dispatch_interview_created_tasks). Every interview scheduled in that window has
no Teams meeting, no meeting_link, and its candidate/panelists were never emailed.

What it re-dispatches. An interview qualifies only if ALL of these hold:
  - status = 'scheduled'
  - created at or after --since (default: the outage start)
  - scheduled_at is still in the future (no point inviting people to the past)
  - ms_graph_event_id IS NULL (no Teams event was ever created for it)

For each one it calls interview_service.dispatch_interview_created_tasks, the
same function the create path uses, so behaviour is identical to a fresh
schedule: Teams meeting first (when there's no manual link and there are
panelists), then the notification email with the join link. Slot-booked
interviews get the same SLOT_BOOKING_CC as a live booking.

Run it ONLY after the fixed worker is up and has drained its queue (give it a
few minutes). A task that was queued during the outage and processed late will
already have set ms_graph_event_id, so that interview drops out of the list.
Interviews where HR typed a manual meeting link can't be told apart from ones
whose email went out, so those are listed separately and skipped unless you
pass --include-manual-links.

Dry run by default. Pass --execute to queue tasks.
"""
import argparse
import asyncio
from datetime import datetime, timezone

OUTAGE_START = "2026-11-10T11:30:00+00:00"


async def run(execute: bool, since: datetime, include_manual: bool) -> None:
    from sqlalchemy import select, func
    from app.tasks.email_tasks import _task_session
    import app.models  # noqa: F401  register every mapper before querying
    from app.models.interview import Interview, InterviewPanelist
    from app.models.interview_slot import InterviewSlot
    from app.services.interview_service import dispatch_interview_created_tasks
    from app.services.interview_slot_service import SLOT_BOOKING_CC

    now = datetime.now(timezone.utc)
    async with _task_session() as db:
        rows = (await db.execute(
            select(Interview)
            .where(
                Interview.status == "scheduled",
                Interview.created_at >= since,
                Interview.scheduled_at > now,
                Interview.ms_graph_event_id.is_(None),
            )
            .order_by(Interview.scheduled_at)
        )).scalars().all()

        if not rows:
            print("Nothing to backfill.")
            return

        ids = [iv.id for iv in rows]
        panel_counts = dict((await db.execute(
            select(InterviewPanelist.interview_id, func.count())
            .where(InterviewPanelist.interview_id.in_(ids))
            .group_by(InterviewPanelist.interview_id)
        )).all())
        slot_booked = set((await db.execute(
            select(InterviewSlot.interview_id).where(InterviewSlot.interview_id.in_(ids))
        )).scalars().all())

    queued = skipped = 0
    for iv in rows:
        has_panel = panel_counts.get(iv.id, 0) > 0
        manual = bool(iv.meeting_link)
        tag = "slot" if iv.id in slot_booked else "manual-schedule"
        line = (f"{iv.id}  at={iv.scheduled_at.isoformat()}  {tag}  "
                f"panelists={panel_counts.get(iv.id, 0)}  manual_link={'yes' if manual else 'no'}")
        if manual and not include_manual:
            print(f"SKIP  {line}")
            skipped += 1
            continue
        print(f"{'QUEUE' if execute else 'WOULD'} {line}")
        if execute:
            dispatch_interview_created_tasks(
                iv, SLOT_BOOKING_CC if iv.id in slot_booked else None, has_panelists=has_panel,
            )
        queued += 1

    verb = "Queued" if execute else "Would queue"
    print(f"\n{verb} {queued}, skipped {skipped} (manual link). "
          + ("" if execute else "Re-run with --execute to queue."))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--execute", action="store_true", help="actually queue the tasks")
    parser.add_argument("--since", default=OUTAGE_START, help=f"ISO timestamp (default {OUTAGE_START})")
    parser.add_argument("--include-manual-links", action="store_true",
                        help="also re-send emails for interviews that have a manual meeting link")
    args = parser.parse_args()
    asyncio.run(run(
        execute=args.execute,
        since=datetime.fromisoformat(args.since),
        include_manual=args.include_manual_links,
    ))


if __name__ == "__main__":
    main()
