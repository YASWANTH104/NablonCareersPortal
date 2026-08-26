"""backfill_round_type_scheduled_ahead

Attributes interviews.round_type for rows the four backfills in
b1c2d3e4f5a6 could not reach: interviews SCHEDULED BEFORE the application was
moved to that round's stage.

This is the normal way the team works — HR books the TR1 while the candidate is
still at `assessment`, then advances the stage minutes later. Backfill 2 looks
at the most recent stage-history row at-or-BEFORE the interview's created_at, so
for these it resolved to `assessment` (or `applied`), which is not one of the
four round stages, and the row stayed NULL.

A NULL round_type is invisible to the duplicate-booking gate
(get_booked_rounds requires round_type IS NOT NULL), so the same round can be
booked a second time for that candidate. On the prod DB this left 4 such rows,
two of them live `scheduled` TR1 interviews.

The fix is to look FORWARD instead: the first real stage move at-or-after the
interview was created is the round it was scheduled for. Verified against prod,
where all four rows' inferred round matches the interview title a human typed
("TR1: Nishant <> Venkat" -> tr1, "HR Screen call" -> screening).

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Only touches rows still NULL after b1c2d3e4f5a6, so it is safe to re-run
    # and safe on a fresh database (where it finds nothing left to do).
    #
    # LEFT(to_stage,1) <> '_' skips note rows — application_stage_history
    # doubles as the notes table, and a note is stored as to_stage = '_note'.
    #
    # The 30-day bound is deliberate: "booked just before the stage move" is a
    # matter of minutes or days in practice. Without it, an interview created
    # months earlier at `applied` would be attributed to whatever round the
    # candidate eventually reached, which is a guess rather than an inference.
    op.execute("""
        UPDATE interviews AS i
           SET round_type = sub.stage
          FROM (
            SELECT DISTINCT ON (iv.id) iv.id AS interview_id, h.to_stage AS stage
              FROM interviews AS iv
              JOIN application_stage_history AS h
                ON h.application_id = iv.application_id
               AND h.created_at >= iv.created_at
               AND h.created_at <= iv.created_at + INTERVAL '30 days'
             WHERE iv.round_type IS NULL
               AND LEFT(h.to_stage, 1) <> '_'
             ORDER BY iv.id, h.created_at ASC
          ) AS sub
         WHERE sub.interview_id = i.id
           AND sub.stage IN ('screening', 'tr1', 'tr2', 'hr')
    """)


def downgrade() -> None:
    # Non-destructive by design: this only ever filled in NULLs, and there is no
    # record of which rows it touched, so it cannot be selectively undone.
    # b1c2d3e4f5a6's downgrade drops the column outright if that is needed.
    pass
