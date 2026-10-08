"""One-off operational script: move CAMPUS PLACEMENT candidates who already
have an assessment scheduled, but are still at "applied", to "assessment".

Why this exists: until 2026-10-08, scheduling an assessment (single or bulk,
HR or campus portal) created the Assessment row but never moved the stage —
HR had to move every candidate by hand, and for bulk campus drives most were
left at "applied". New scheduling now moves the stage automatically
(assessment_service.advance_to_assessment); this script repairs the rows
created before that.

Scope is campus only, on purpose: bulk assessments have only ever been run
for campus drives, so that is where the stuck candidates are. Every other
source is ignored entirely.

What it moves — a campus application qualifies only if ALL hold:
  - it has at least one assessment that isn't cancelled
  - it is not on hold and not in a terminal stage
  - it is at "applied". Campus candidates take the assessment before the HR
    screening call (applied -> assessment -> screening), so one already at
    screening or later has cleared the assessment and is never dragged back.

How it moves them — deliberately NOT through application_service.move_stage:
  - no candidate in-app notifications and no agency stage emails (move_stage
    would fire one per row — a flood of stale "your application moved" pings)
  - the move is BACKDATED to when the earliest assessment was scheduled, and
    attributed to whoever scheduled it, so the timeline, the Recruiters
    report and the Action Center's day counts reflect what really happened
    instead of "everyone moved today"
  - ownership is claimed for that scheduler only if nobody owns the
    application yet (same first-mover rule as move_stage). Campus-portal
    scheduling (created_by NULL) is a system move and claims nothing.
  - each row is a conditional UPDATE ... WHERE stage = <stage we read>, so if
    HR moves a candidate while this runs, HR's move wins and the row is
    reported as skipped.

Requires migration c8d9e0f1a2b3 (applications.owner_id) — deploy the
action-center release first; the script refuses to run without it.

Idempotent: once moved, a candidate is at "assessment" and no longer
qualifies, so re-running finds nothing.

Defaults to DRY RUN — prints exactly what would change and changes nothing.

Usage (from backend/, against whichever DB DATABASE_URL points at):
    ./myenv/bin/python scripts/backfill_assessment_stage.py              # dry run
    ./myenv/bin/python scripts/backfill_assessment_stage.py --execute    # for real

On prod, inside the running backend container (no local DB access needed):
    az containerapp exec -n careers-backend -g <rg> --command "python /app/scripts/backfill_assessment_stage.py"
    az containerapp exec -n careers-backend -g <rg> --command "python /app/scripts/backfill_assessment_stage.py --execute"
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

NOTE = "Backfilled: moved to Assessment because an assessment was scheduled on {when}"


async def run(execute: bool) -> None:
    from sqlalchemy import select, func, update, text
    from sqlalchemy.orm import aliased
    from app.database import AsyncSessionLocal, engine
    from app.models.application import Application, ApplicationStageHistory
    from app.models.assessment import Assessment
    from app.models.job import Job
    from app.models.user import User
    from app.constants.stages import TERMINAL_STAGES, STAGE_LABELS, valid_transitions_for

    engine.echo = False  # dev settings echo every SQL statement; keep the report readable

    async with AsyncSessionLocal() as db:
        has_owner = (await db.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'applications' AND column_name = 'owner_id'"
        ))).first()
        if not has_owner:
            print("ABORT: applications.owner_id is missing — migration c8d9e0f1a2b3 hasn't run on this "
                  "database. Deploy the action-center release first, then re-run.")
            return

        # Earliest live assessment per application, and who scheduled it.
        first = (
            select(
                Assessment.application_id,
                Assessment.created_at,
                Assessment.created_by,
                Assessment.title,
                func.row_number().over(
                    partition_by=Assessment.application_id, order_by=Assessment.created_at,
                ).label("rn"),
            )
            .where(Assessment.status != "cancelled")
            .subquery()
        )
        Candidate, Scheduler = aliased(User), aliased(User)
        rows = (await db.execute(
            select(
                Application.id, Application.stage, Application.source, Application.on_hold,
                Application.owner_id,
                first.c.created_at.label("scheduled_at"), first.c.created_by.label("scheduled_by"),
                first.c.title.label("assessment_title"),
                Candidate.full_name.label("candidate"), Job.title.label("job"),
                Scheduler.full_name.label("scheduler"),
            )
            .join(first, (first.c.application_id == Application.id) & (first.c.rn == 1))
            .join(Candidate, Candidate.id == Application.applicant_id)
            .join(Job, Job.id == Application.job_id)
            .join(Scheduler, Scheduler.id == first.c.created_by, isouter=True)
            .where(Application.source == "campus", Application.stage != "assessment")
            .order_by(Job.title, Candidate.full_name)
        )).all()

        to_move, skipped = [], []
        for r in rows:
            if r.stage in TERMINAL_STAGES:
                skipped.append((r, f"closed ({STAGE_LABELS.get(r.stage, r.stage)})"))
            elif r.on_hold:
                skipped.append((r, "on hold"))
            elif "assessment" not in valid_transitions_for(r.source).get(r.stage, []):
                skipped.append((r, f"already past it ({STAGE_LABELS.get(r.stage, r.stage)})"))
            else:
                to_move.append(r)

        print(f"{'EXECUTE' if execute else 'DRY RUN'} mode · campus placement candidates only")
        print(f"{len(rows)} campus application(s) have an assessment but aren't at the Assessment stage.\n")

        print(f"WILL MOVE to Assessment: {len(to_move)}")
        by_stage: dict[str, int] = {}
        for r in to_move:
            by_stage[r.stage] = by_stage.get(r.stage, 0) + 1
            print(f"  - {r.candidate:<30} {r.job[:32]:<32} {r.stage:<10} "
                  f"scheduled {r.scheduled_at:%d %b %Y} by {r.scheduler or 'campus portal'}")
        if to_move:
            print(f"  by current stage: {by_stage}")

        print(f"\nLEFT ALONE: {len(skipped)}")
        reasons: dict[str, int] = {}
        for r, why in skipped:
            key = why.split(" (")[0]
            reasons[key] = reasons.get(key, 0) + 1
        for why, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
            print(f"  - {why}: {n}")

        if not execute:
            print("\nDry run only — nothing changed. Re-run with --execute to apply.")
            return
        if not to_move:
            print("\nNothing to do.")
            return

        moved, raced = 0, 0
        for r in to_move:
            when = r.scheduled_at
            claimed = (await db.execute(
                update(Application)
                .where(Application.id == r.id, Application.stage == r.stage, Application.on_hold.is_(False))
                .values(stage="assessment", stage_updated_at=when)
                .returning(Application.id)
            )).first()
            if not claimed:
                raced += 1
                continue
            db.add(ApplicationStageHistory(
                application_id=r.id,
                from_stage=r.stage,
                to_stage="assessment",
                changed_by=r.scheduled_by,
                notes=NOTE.format(when=f"{when:%d %b %Y}"),
                created_at=when,
            ))
            if r.scheduled_by is not None:
                await db.execute(
                    update(Application)
                    .where(Application.id == r.id, Application.owner_id.is_(None))
                    .values(
                        owner_id=r.scheduled_by,
                        owned_at=when,
                        assigned_to=func.coalesce(Application.assigned_to, r.scheduled_by),
                    )
                )
            moved += 1

        await db.commit()
        print(f"\nMoved {moved} application(s) to Assessment.")
        if raced:
            print(f"Skipped {raced} that changed stage while this ran (someone moved them first).")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--execute", action="store_true", help="Apply the moves. Omit for a dry run.")
    args = parser.parse_args()
    asyncio.run(run(execute=args.execute))


if __name__ == "__main__":
    main()
