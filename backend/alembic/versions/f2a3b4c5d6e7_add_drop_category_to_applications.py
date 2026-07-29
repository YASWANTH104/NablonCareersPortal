"""add drop_category to applications

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-29

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('applications', sa.Column('drop_category', sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column('applications', 'drop_category')
