"""add_interview_round_type

Adds interviews.round_type so a booked interview can be attributed to a
specific pipeline round (screening / tr1 / tr2 / hr) without guessing from
round_number — which defaults to 1 on every manually scheduled interview and
therefore can't tell an HR screening call apart from a TR1.

This is what the agency portal's "already booked this round" rule reads: a
candidate with a live (non-cancelled) interview for a round disappears from
that round's booking list, and reappears the moment it's cancelled.

Revision ID: b1c2d3e4f5a6
Revises: a2b3c4d5e6f7
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('interviews', sa.Column('round_type', sa.String(length=20), nullable=True))

    # Backfill 1: interviews that came from a published slot — the slot already
    # records the round authoritatively, so this is exact, not a guess.
    op.execute("""
        UPDATE interviews AS i
           SET round_type = s.round_type
          FROM interview_slots AS s
         WHERE s.interview_id = i.id
           AND s.round_type IS NOT NULL
    """)

    # Backfill 2: everything else, attributed by the stage the application was
    # sitting at when the interview row was created — the same inference
    # app/tasks/email_tasks.py already uses to decide which round a given
    # interview's feedback belongs to. Only the four round stages are mapped;
    # an interview created at applied/assessment/offer stays NULL rather than
    # being forced into a round it didn't belong to.
    op.execute("""
        UPDATE interviews AS i
           SET round_type = sub.stage
          FROM (
            SELECT DISTINCT ON (iv.id) iv.id AS interview_id, h.to_stage AS stage
              FROM interviews AS iv
              JOIN application_stage_history AS h
                ON h.application_id = iv.application_id
               AND h.created_at <= iv.created_at
             WHERE iv.round_type IS NULL
               -- application_stage_history doubles as the notes table: a note
               -- is stored as a row with to_stage = '_note'. Those are not
               -- stages and must not win the DISTINCT ON, or an interview
               -- created just after someone left a note would resolve to
               -- '_note' and get no round_type at all.
               AND LEFT(h.to_stage, 1) <> '_'
             ORDER BY iv.id, h.created_at DESC
          ) AS sub
         WHERE sub.interview_id = i.id
           AND sub.stage IN ('screening', 'tr1', 'tr2', 'hr')
    """)

    # Backfill 3: the same attribution for stage-history rows that predate the
    # interview_1/interview_2/interview_3/final_interview -> tr1/tr2/hr rename
    # (app/constants/stages.py documents that those old names are still in the
    # table). Without this, any legacy interview keeps round_type NULL and is
    # invisible to the duplicate-booking gate, so a candidate still sitting at
    # such a round could be booked into it a second time.
    #
    # ASSUMPTION: the rename collapsed four stages into three, so both
    # interview_3 and final_interview map to 'hr'. If that's wrong for your
    # data the only cost is a candidate being hidden from a round they could
    # in principle be rebooked into — the conservative direction.
    op.execute("""
        UPDATE interviews AS i
           SET round_type = sub.mapped
          FROM (
            SELECT DISTINCT ON (iv.id)
                   iv.id AS interview_id,
                   CASE h.to_stage
                     WHEN 'interview_1'     THEN 'tr1'
                     WHEN 'interview_2'     THEN 'tr2'
                     WHEN 'interview_3'     THEN 'hr'
                     WHEN 'final_interview' THEN 'hr'
                   END AS mapped
              FROM interviews AS iv
              JOIN application_stage_history AS h
                ON h.application_id = iv.application_id
               AND h.created_at <= iv.created_at
             WHERE iv.round_type IS NULL
               AND LEFT(h.to_stage, 1) <> '_'
             ORDER BY iv.id, h.created_at DESC
          ) AS sub
         WHERE sub.interview_id = i.id
           AND sub.mapped IS NOT NULL
    """)

    # Backfill 4: applications with NO usable stage history at all (real in the
    # dev data — the history table only gets a row on a *move*, so an
    # application that has never moved has none). The two backfills above can
    # never attribute those, which would leave a live interview invisible to
    # the duplicate-booking gate and let the same round be booked twice.
    #
    # Using the application's CURRENT stage is exact here rather than a guess:
    # no history means it has never moved, so its stage at the time the
    # interview was created is necessarily the stage it still has. The
    # NOT EXISTS is what keeps that reasoning true — an application with any
    # history is left to backfill 2/3.
    op.execute("""
        UPDATE interviews AS i
           SET round_type = a.stage
          FROM applications AS a
         WHERE a.id = i.application_id
           AND i.round_type IS NULL
           AND a.stage IN ('screening', 'tr1', 'tr2', 'hr')
           AND NOT EXISTS (
                 SELECT 1 FROM application_stage_history AS h
                  WHERE h.application_id = i.application_id
                    AND LEFT(h.to_stage, 1) <> '_'
               )
    """)


def downgrade() -> None:
    op.drop_column('interviews', 'round_type')
