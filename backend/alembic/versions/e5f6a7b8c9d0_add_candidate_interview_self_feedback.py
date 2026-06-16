"""add_candidate_interview_self_feedback

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'candidate_interview_self_feedback',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('interview_id', UUID(as_uuid=True), sa.ForeignKey('interviews.id'), nullable=False, unique=True),
        sa.Column('candidate_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('overall_score', sa.Integer(), nullable=True),
        sa.Column('communication_score', sa.Integer(), nullable=True),
        sa.Column('technical_confidence', sa.Integer(), nullable=True),
        sa.Column('was_prepared', sa.Boolean(), nullable=True),
        sa.Column('would_recommend', sa.Boolean(), nullable=True),
        sa.Column('difficulty', sa.String(20), nullable=True),
        sa.Column('experience_rating', sa.String(20), nullable=True),
        sa.Column('comments', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('candidate_interview_self_feedback')
