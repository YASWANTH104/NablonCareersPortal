"""One-off operational script: turn on the AI screening questionnaire for the
two roles below and send the screening-request email to every candidate
currently sitting in the 'applied' stage on them, regardless of source
(direct / referral / agency / talent_acquisition).

What this does, in order:
  1. Finds jobs whose title matches JOB_TITLES (case-insensitive exact match)
     and, unless already on, sets `screening_enabled = True` — this is what
     makes every FUTURE application to these jobs automatically get the
     screening email the moment it lands at 'applied'
     (see app/services/screening_service.create_and_queue_email, already
     wired into app/services/application_service.submit_application /
     submit_sourced_application). No code change needed for "next time
     onwards" — flipping this flag is the whole mechanism.
  2. For every existing Application already at stage == 'applied' on those
     jobs, calls the same create_and_queue_email() the app uses for new
     applicants. It is idempotent (skips anyone who already has a request
     with email_sent_at set) and applies uniformly regardless of
     source/referral/agency, matching the existing design.
  3. Each newly created ScreeningResponse gets `expires_at = now + 7 days`
     (screening_service.REQUEST_EXPIRY_DAYS) — the auto-reject task
     (app/tasks/screening_tasks.py::auto_reject_expired_screening_requests)
     picks up anyone still 'pending' and still sitting at 'applied' once that
     window closes. Anyone HR has since moved to a different stage manually
     is left alone (checked at auto-reject time, not here).

Defaults to DRY RUN — prints exactly what would happen and changes nothing.
Pass --execute to actually flip the flag / create requests / send emails.

Usage (from backend/, against whichever DB DATABASE_URL points at):
    ./myenv/bin/python scripts/backfill_screening_requests.py               # dry run
    ./myenv/bin/python scripts/backfill_screening_requests.py --execute     # for real

To target prod (same Azure Postgres host as dev, database name differs):
    DATABASE_URL='<prod-url-with-db-name-nablon_careers>' \\
        ./myenv/bin/python scripts/backfill_screening_requests.py --execute
This does NOT edit backend/.env — the env var only overrides for this one
process, same pattern already used for prior prod alembic runs.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

JOB_TITLES = ["Intern - AI Engineering", "Associate AI Engineer"]


async def run(execute: bool) -> None:
    from sqlalchemy import select, func
    from app.database import AsyncSessionLocal
    from app.models.job import Job
    from app.models.application import Application
    from app.services import screening_service

    async with AsyncSessionLocal() as db:
        jobs = (await db.execute(
            select(Job).where(func.lower(Job.title).in_([t.lower() for t in JOB_TITLES]))
        )).scalars().all()

        found_titles = {j.title for j in jobs}
        missing = [t for t in JOB_TITLES if t.lower() not in {f.lower() for f in found_titles}]

        print(f"{'EXECUTE' if execute else 'DRY RUN'} mode")
        print(f"Matched {len(jobs)} job(s):")
        for j in jobs:
            print(f"  - {j.title!r} (id={j.id}, status={j.status}, screening_enabled={j.screening_enabled})")
        if missing:
            print(f"WARNING: no job found matching: {missing!r} — check exact titles in prod before proceeding.")
        if not jobs:
            print("Nothing to do — no matching jobs found.")
            return

        for job in jobs:
            if not job.screening_enabled:
                print(f"  -> would enable screening_enabled on {job.title!r}" + ("" if not execute else " (enabling now)"))
                if execute:
                    job.screening_enabled = True

        if execute:
            await db.commit()

        job_ids = [j.id for j in jobs]
        applied_apps = (await db.execute(
            select(Application).where(Application.job_id.in_(job_ids), Application.stage == "applied")
        )).scalars().all()

        print(f"\nFound {len(applied_apps)} application(s) currently at stage 'applied' across matched job(s).")

        by_source: dict[str, int] = {}
        for app in applied_apps:
            by_source[app.source] = by_source.get(app.source, 0) + 1
        print(f"By source: {by_source}")

        if not execute:
            print("\nDry run only — no screening_enabled flag flipped, no requests created, no emails sent.")
            print("Re-run with --execute to actually do this.")
            return

        sent = 0
        already_had_request = 0
        for app in applied_apps:
            req = await screening_service.get_or_create_request(db, app.id)
            if req.email_sent_at:
                already_had_request += 1
                continue
            await screening_service.create_and_queue_email(db, app.id)
            sent += 1

        print(f"\nQueued {sent} new screening-request email(s).")
        print(f"Skipped {already_had_request} application(s) that already had a request sent (idempotent).")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--execute", action="store_true", help="Actually flip screening_enabled, create requests, and send emails. Omit for a dry run.")
    args = parser.parse_args()
    asyncio.run(run(execute=args.execute))


if __name__ == "__main__":
    main()
