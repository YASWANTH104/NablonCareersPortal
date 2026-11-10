"""agency_slot_requests

Agencies can ask HR to open interview times for a role from their portal.
One row per request; it closes as fulfilled when HR publishes slots for the
same job and round, or HR dismisses it.

Revision ID: f9a0b1c2d3e6
Revises: e8f9a0b1c2d5
Create Date: 2026-11-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f9a0b1c2d3e6'
down_revision: Union[str, None] = 'e8f9a0b1c2d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'agency_slot_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('agency_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('agencies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('assignment_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('job_agency_assignments.id', ondelete='CASCADE'), nullable=False),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('jobs.id'), nullable=False),
        sa.Column('round_type', sa.String(20), nullable=False),
        sa.Column('candidates_count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('date_from', sa.Date(), nullable=False),
        sa.Column('date_to', sa.Date(), nullable=False),
        sa.Column('time_preference', sa.String(20), nullable=False, server_default='any'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='open'),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('resolution_note', sa.Text(), nullable=True),
        sa.Column('slots_published', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_agency_slot_requests_agency_id', 'agency_slot_requests', ['agency_id'])
    op.create_index('ix_agency_slot_requests_job_id', 'agency_slot_requests', ['job_id'])
    op.create_index('ix_agency_slot_requests_status', 'agency_slot_requests', ['status'])


def downgrade() -> None:
    op.drop_index('ix_agency_slot_requests_status', table_name='agency_slot_requests')
    op.drop_index('ix_agency_slot_requests_job_id', table_name='agency_slot_requests')
    op.drop_index('ix_agency_slot_requests_agency_id', table_name='agency_slot_requests')
    op.drop_table('agency_slot_requests')
