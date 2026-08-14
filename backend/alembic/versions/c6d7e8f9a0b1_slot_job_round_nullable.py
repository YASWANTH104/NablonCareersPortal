"""slot_job_round_nullable

Revision ID: c6d7e8f9a0b1
Revises: b4c5d6e7f8a9
Create Date: 2026-08-14 00:00:00.000000

Interviewers now publish raw free time with no job/round attached at all —
HR assigns a job+round to an open slot afterwards (making it visible to that
job's agencies). job_id/round_type on interview_slots become nullable to
represent "not yet assigned". Default duration_mins flips to 60 to match the
new interviewer-facing publish flow, which no longer offers a duration
choice at all.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c6d7e8f9a0b1'
down_revision: Union[str, None] = 'b4c5d6e7f8a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('interview_slots', 'job_id', nullable=True)
    op.alter_column('interview_slots', 'round_type', nullable=True)
    op.alter_column('interview_slots', 'duration_mins', server_default='60')


def downgrade() -> None:
    op.alter_column('interview_slots', 'duration_mins', server_default='30')
    op.alter_column('interview_slots', 'round_type', nullable=False)
    op.alter_column('interview_slots', 'job_id', nullable=False)
