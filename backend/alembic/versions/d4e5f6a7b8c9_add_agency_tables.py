"""add_agency_tables

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-12 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'agencies',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('contact_name', sa.String(255), nullable=True),
        sa.Column('contact_email', sa.String(255), nullable=False),
        sa.Column('portal_token', sa.String(64), unique=True, nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_agencies_portal_token', 'agencies', ['portal_token'])

    op.create_table(
        'job_agency_assignments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('job_id', UUID(as_uuid=True), sa.ForeignKey('jobs.id'), nullable=False),
        sa.Column('agency_id', UUID(as_uuid=True), sa.ForeignKey('agencies.id'), nullable=False),
        sa.Column('ref_token', sa.String(64), unique=True, nullable=False),
        sa.Column('max_submissions', sa.Integer(), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_job_agency_assignments_job_id', 'job_agency_assignments', ['job_id'])
    op.create_index('ix_job_agency_assignments_agency_id', 'job_agency_assignments', ['agency_id'])
    op.create_index('ix_job_agency_assignments_ref_token', 'job_agency_assignments', ['ref_token'])

    op.add_column('applications', sa.Column('agency_id', UUID(as_uuid=True), sa.ForeignKey('agencies.id'), nullable=True))


def downgrade() -> None:
    op.drop_column('applications', 'agency_id')
    op.drop_index('ix_job_agency_assignments_ref_token', table_name='job_agency_assignments')
    op.drop_index('ix_job_agency_assignments_agency_id', table_name='job_agency_assignments')
    op.drop_index('ix_job_agency_assignments_job_id', table_name='job_agency_assignments')
    op.drop_table('job_agency_assignments')
    op.drop_index('ix_agencies_portal_token', table_name='agencies')
    op.drop_table('agencies')
