"""add current_ctc and expected_ctc to applications

Revision ID: b2c3d4e5f8a9
Revises: a1b2c3d4e5f7
Create Date: 2026-07-22

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c3d4e5f8a9'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('applications', sa.Column('current_ctc', sa.String(length=50), nullable=True))
    op.add_column('applications', sa.Column('expected_ctc', sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column('applications', 'expected_ctc')
    op.drop_column('applications', 'current_ctc')
