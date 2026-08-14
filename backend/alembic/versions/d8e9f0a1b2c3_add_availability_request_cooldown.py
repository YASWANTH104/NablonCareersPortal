"""add_availability_request_cooldown

Revision ID: d8e9f0a1b2c3
Revises: c6d7e8f9a0b1
Create Date: 2026-08-14 00:00:00.000000

HR can now nudge an interviewer to publish their free interview slots. This
column tracks when that interviewer was last nudged (by anyone on HR), so the
request endpoint can enforce a cooldown instead of letting several HR staff
spam the same interviewer with duplicate reminders.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, None] = 'c6d7e8f9a0b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('last_availability_request_sent_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'last_availability_request_sent_at')
