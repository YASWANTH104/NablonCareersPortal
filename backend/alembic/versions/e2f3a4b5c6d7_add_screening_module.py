"""add_screening_module

Revision ID: e2f3a4b5c6d7
Revises: d8e9f0a1b2c3
Create Date: 2026-08-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, None] = 'd8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'jobs',
        sa.Column('screening_enabled', sa.Boolean(), nullable=False, server_default='false'),
    )

    op.create_table(
        'screening_responses',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('application_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('applications.id'), nullable=False),
        sa.Column('token', sa.String(64), nullable=False, unique=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('college_name', sa.String(255), nullable=True),
        sa.Column('cgpa', sa.Numeric(4, 2), nullable=True),
        sa.Column('relevant_experience', sa.Text(), nullable=True),
        sa.Column('skills', postgresql.JSONB(), nullable=True),
        sa.Column('projects', postgresql.JSONB(), nullable=True),
        sa.Column('achievements', sa.Text(), nullable=True),
        sa.Column('github_profile_url', sa.Text(), nullable=True),
        sa.Column('college_tier', sa.Integer(), nullable=True),
        sa.Column('college_score', sa.Numeric(5, 2), nullable=True),
        sa.Column('cgpa_score', sa.Numeric(5, 2), nullable=True),
        sa.Column('skills_score', sa.Numeric(5, 2), nullable=True),
        sa.Column('project_score', sa.Numeric(5, 2), nullable=True),
        sa.Column('overall_score', sa.Numeric(5, 2), nullable=True),
        sa.Column('recommendation', sa.String(30), nullable=True),
        sa.Column('auto_reject', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('auto_reject_reason', sa.Text(), nullable=True),
        sa.Column('ai_reasoning', postgresql.JSONB(), nullable=True),
        sa.Column('is_ai_scored', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('email_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('scored_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('application_id', name='uq_screening_response_application'),
    )
    op.create_index('ix_screening_responses_token', 'screening_responses', ['token'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_screening_responses_token', table_name='screening_responses')
    op.drop_table('screening_responses')
    op.drop_column('jobs', 'screening_enabled')
