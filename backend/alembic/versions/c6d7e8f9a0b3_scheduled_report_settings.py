"""scheduled_report_settings

Single-row config for the weekly/monthly hiring summary emails: shared
recipient list, per-cadence on/off, and the last-sent dates the beat tasks
claim before sending. Seeded with an empty recipient list, so nothing is
emailed until someone adds recipients in Settings.

Revision ID: c6d7e8f9a0b3
Revises: b5c6d7e8f9a2
Create Date: 2026-10-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'c6d7e8f9a0b3'
down_revision: Union[str, None] = 'b5c6d7e8f9a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'scheduled_report_settings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('recipients', postgresql.ARRAY(sa.String(255)), nullable=False, server_default='{}'),
        sa.Column('weekly_enabled', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('monthly_enabled', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('last_weekly_sent_on', sa.Date(), nullable=True),
        sa.Column('last_monthly_sent_on', sa.Date(), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint('id = 1', name='ck_scheduled_report_settings_single_row'),
    )
    op.execute("INSERT INTO scheduled_report_settings (id) VALUES (1)")


def downgrade() -> None:
    op.drop_table('scheduled_report_settings')
