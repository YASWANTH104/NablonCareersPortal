"""add_interview_slots

Revision ID: d1e2f3a4b5c6
Revises: b9c0d1e2f3a4
Create Date: 2026-08-10 00:00:00.000000

Interviewer-published free/busy slots that agencies (anonymized) and HR
(full detail) can book directly, creating a real Interview on booking.

Chained directly on b9c0d1e2f3a4 (not the screening_responses migration this
was originally built alongside) — the screening feature was reverted out of
the deploy path, so this shouldn't depend on it ever existing in prod.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, None] = 'b9c0d1e2f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'interview_slots',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('interviewer_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('jobs.id'), nullable=False),
        sa.Column('round_type', sa.String(20), nullable=False),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('duration_mins', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('status', sa.String(20), nullable=False, server_default='open'),
        sa.Column('interview_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('interviews.id'), nullable=True),
        sa.Column('booked_by_agency_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('agencies.id'), nullable=True),
        sa.Column('booked_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('interviewer_id', 'start_time', name='uq_interview_slot_interviewer_time'),
    )
    op.create_index(
        'ix_interview_slots_job_round_status_time',
        'interview_slots',
        ['job_id', 'round_type', 'status', 'start_time'],
    )
    op.create_index('ix_interview_slots_interviewer_id', 'interview_slots', ['interviewer_id'])


def downgrade() -> None:
    op.drop_index('ix_interview_slots_interviewer_id', table_name='interview_slots')
    op.drop_index('ix_interview_slots_job_round_status_time', table_name='interview_slots')
    op.drop_table('interview_slots')
