"""add delayed rejection notification fields and NIRF college columns

Revision ID: e7f8a9b0c1d2
Revises: d3e4f5a6b7c8
Create Date: 2026-09-27

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('applications', sa.Column('rejection_notify_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('applications', sa.Column('rejection_notify_from_stage', sa.String(length=50), nullable=True))
    op.add_column('applications', sa.Column('rejection_email_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('screening_responses', sa.Column('college_nirf_rank', sa.Integer(), nullable=True))
    op.add_column('screening_responses', sa.Column('college_nirf_band', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('screening_responses', 'college_nirf_band')
    op.drop_column('screening_responses', 'college_nirf_rank')
    op.drop_column('applications', 'rejection_email_sent_at')
    op.drop_column('applications', 'rejection_notify_from_stage')
    op.drop_column('applications', 'rejection_notify_at')
