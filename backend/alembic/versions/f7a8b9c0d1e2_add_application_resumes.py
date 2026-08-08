"""add application_resumes table for resume revision history

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-08-08

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'f7a8b9c0d1e2'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'application_resumes',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('application_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('applications.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('file_url', sa.Text(), nullable=False),
        sa.Column('file_name', sa.String(255), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('uploaded_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('uploaded_by_role', sa.String(30), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('application_id', 'version', name='uq_application_resume_version'),
    )

    # Backfill: every existing application's current resume becomes version 1,
    # credited to the applicant at the time they applied. Without this, history
    # would start empty and the original resume would look like it never existed.
    op.execute("""
        INSERT INTO application_resumes
            (id, application_id, version, file_url, file_name, uploaded_by, uploaded_by_role, created_at)
        SELECT gen_random_uuid(), a.id, 1, a.resume_url, NULL, a.applicant_id, 'applicant', a.applied_at
        FROM applications a
        WHERE a.resume_url IS NOT NULL AND a.resume_url <> ''
    """)


def downgrade() -> None:
    op.drop_table('application_resumes')
