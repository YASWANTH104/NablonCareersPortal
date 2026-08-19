"""add_note_attachments

Revision ID: a2b3c4d5e6f7
Revises: e2f3a4b5c6d7
Create Date: 2026-08-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'application_stage_history',
        sa.Column('attachments', postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('application_stage_history', 'attachments')
