"""assessment_reminder_count

Two reminders per assessment (day 3 and day 6 after sending) need a count,
not just a "sent" timestamp.

Revision ID: a4b5c6d7e8f1
Revises: f3a4b5c6d7e0
Create Date: 2026-10-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a4b5c6d7e8f1'
down_revision: Union[str, None] = 'f3a4b5c6d7e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('assessments', sa.Column('reminder_count', sa.Integer, nullable=False, server_default='0'))
    # An assessment that already got the old single reminder counts as one.
    op.execute("UPDATE assessments SET reminder_count = 1 WHERE reminder_sent_at IS NOT NULL")


def downgrade() -> None:
    op.drop_column('assessments', 'reminder_count')
