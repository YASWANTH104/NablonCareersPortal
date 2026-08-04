"""add allow_referrals, allow_outsiders, criticality to jobs

Revision ID: c1d2e3f4a5b6
Revises: 49c5bd999d3d
Create Date: 2026-08-04 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = '49c5bd999d3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('jobs', sa.Column('allow_referrals', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('jobs', sa.Column('allow_outsiders', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('jobs', sa.Column('criticality', sa.String(length=10), server_default='medium', nullable=False))


def downgrade() -> None:
    op.drop_column('jobs', 'criticality')
    op.drop_column('jobs', 'allow_outsiders')
    op.drop_column('jobs', 'allow_referrals')
