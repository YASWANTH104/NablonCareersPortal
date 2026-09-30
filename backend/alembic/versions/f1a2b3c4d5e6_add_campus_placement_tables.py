"""add_campus_placement_tables

Revision ID: f1a2b3c4d5e6
Revises: e7f8a9b0c1d2
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'e7f8a9b0c1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'campuses',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('contact_name', sa.String(255), nullable=True),
        sa.Column('contact_email', sa.String(255), nullable=False),
        sa.Column('portal_token', sa.String(64), unique=True, nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_campuses_portal_token', 'campuses', ['portal_token'])

    op.create_table(
        'job_campus_assignments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('job_id', UUID(as_uuid=True), sa.ForeignKey('jobs.id'), nullable=False),
        sa.Column('campus_id', UUID(as_uuid=True), sa.ForeignKey('campuses.id'), nullable=False),
        sa.Column('ref_token', sa.String(64), unique=True, nullable=False),
        sa.Column('drive_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('max_submissions', sa.Integer(), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_job_campus_assignments_job_id', 'job_campus_assignments', ['job_id'])
    op.create_index('ix_job_campus_assignments_campus_id', 'job_campus_assignments', ['campus_id'])
    op.create_index('ix_job_campus_assignments_ref_token', 'job_campus_assignments', ['ref_token'])

    op.add_column('applications', sa.Column('campus_id', UUID(as_uuid=True), sa.ForeignKey('campuses.id'), nullable=True))


def downgrade() -> None:
    op.drop_column('applications', 'campus_id')
    op.drop_index('ix_job_campus_assignments_ref_token', table_name='job_campus_assignments')
    op.drop_index('ix_job_campus_assignments_campus_id', table_name='job_campus_assignments')
    op.drop_index('ix_job_campus_assignments_job_id', table_name='job_campus_assignments')
    op.drop_table('job_campus_assignments')
    op.drop_index('ix_campuses_portal_token', table_name='campuses')
    op.drop_table('campuses')
