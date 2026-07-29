"""add notice_period to applications

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-07-29

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('applications', sa.Column('notice_period', sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column('applications', 'notice_period')
