"""add_screening_responses

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-08-10 00:00:00.000000

One-off screening table for the Intern - AI Engineering / Associate AI
Engineer applicant backlog — college/CGPA/certifications/projects, collected
via a public token link emailed to each candidate. Meant to be dropped later
via `alembic downgrade` once this screening pass is done.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'c0d1e2f3a4b5'
down_revision: Union[str, None] = 'b9c0d1e2f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'screening_responses',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('application_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('applications.id'), nullable=False),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('jobs.id'), nullable=False),
        sa.Column('token', sa.String(128), nullable=False, unique=True),
        sa.Column('college_name', sa.String(255), nullable=True),
        sa.Column('degree', sa.String(100), nullable=True),
        sa.Column('branch', sa.String(100), nullable=True),
        sa.Column('graduation_year', sa.Integer(), nullable=True),
        sa.Column('cgpa', sa.String(20), nullable=True),
        sa.Column('key_skills', sa.Text(), nullable=True),
        sa.Column('certifications', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('projects', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('email_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('application_id', name='uq_screening_response_application'),
    )
    op.create_index('ix_screening_responses_token', 'screening_responses', ['token'], unique=True)
    op.create_index('ix_screening_responses_job_id', 'screening_responses', ['job_id'])


def downgrade() -> None:
    op.drop_index('ix_screening_responses_job_id', table_name='screening_responses')
    op.drop_index('ix_screening_responses_token', table_name='screening_responses')
    op.drop_table('screening_responses')
