"""add_autoproctor_sync

AutoProctor nightly results sync: imported attempts, sync-run log, and the
assessment columns the reminder / auto-drop sweep needs.

Revision ID: d1e2f3a4b5c7
Revises: c8d9e0f1a2b3
Create Date: 2026-10-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = 'd1e2f3a4b5c7'
down_revision: Union[str, None] = 'c8d9e0f1a2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('assessments', sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('assessments', sa.Column('reminder_sent_at', sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        'autoproctor_attempts',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('attempt_label', sa.String(40), nullable=False, unique=True),
        sa.Column('test_label', sa.String(40), nullable=False),
        sa.Column('test_title', sa.String(300), nullable=False),
        sa.Column('candidate_email', sa.String(320), nullable=False),
        sa.Column('candidate_name', sa.String(300)),
        sa.Column('started_at', sa.DateTime(timezone=True)),
        sa.Column('finished_at', sa.DateTime(timezone=True)),
        sa.Column('duration_seconds', sa.Float),
        sa.Column('device_type', sa.String(100)),
        sa.Column('trust_score_pct', sa.Integer),
        sa.Column('percentage_scored', sa.Float),
        sa.Column('points_scored', sa.Float),
        sa.Column('points_available', sa.Float),
        sa.Column('graded', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('violations', JSONB, nullable=False, server_default='{}'),
        sa.Column('aux_device_verified', sa.Boolean),
        sa.Column('aux_video_url', sa.Text),
        sa.Column('responses', JSONB, nullable=False, server_default='[]'),
        sa.Column('responses_file_url', sa.Text),
        sa.Column('proctoring_report_url', sa.Text),
        sa.Column('aux_report_url', sa.Text),
        sa.Column('assessment_id', UUID(as_uuid=True), sa.ForeignKey('assessments.id')),
        sa.Column('application_id', UUID(as_uuid=True), sa.ForeignKey('applications.id')),
        sa.Column('match_method', sa.String(20)),
        sa.Column('raw', JSONB, nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_autoproctor_attempts_test_label', 'autoproctor_attempts', ['test_label'])
    op.create_index('ix_autoproctor_attempts_candidate_email', 'autoproctor_attempts', ['candidate_email'])
    op.create_index('ix_autoproctor_attempts_finished_at', 'autoproctor_attempts', ['finished_at'])
    op.create_index('ix_autoproctor_attempts_assessment_id', 'autoproctor_attempts', ['assessment_id'])
    op.create_index('ix_autoproctor_attempts_application_id', 'autoproctor_attempts', ['application_id'])

    op.create_table(
        'autoproctor_sync_runs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True)),
        sa.Column('status', sa.String(20), nullable=False, server_default='running'),
        sa.Column('trigger', sa.String(20), nullable=False, server_default='schedule'),
        sa.Column('range_from', sa.Date),
        sa.Column('range_to', sa.Date),
        sa.Column('attempts_seen', sa.Integer, nullable=False, server_default='0'),
        sa.Column('attempts_imported', sa.Integer, nullable=False, server_default='0'),
        sa.Column('attempts_matched', sa.Integer, nullable=False, server_default='0'),
        sa.Column('attempts_failed', sa.Integer, nullable=False, server_default='0'),
        sa.Column('attempts_skipped', sa.Integer, nullable=False, server_default='0'),
        sa.Column('reminders_sent', sa.Integer, nullable=False, server_default='0'),
        sa.Column('candidates_dropped', sa.Integer, nullable=False, server_default='0'),
        sa.Column('error', sa.Text),
    )
    op.create_index('ix_autoproctor_sync_runs_started_at', 'autoproctor_sync_runs', ['started_at'])


def downgrade() -> None:
    op.drop_index('ix_autoproctor_sync_runs_started_at', table_name='autoproctor_sync_runs')
    op.drop_table('autoproctor_sync_runs')
    for ix in ('application_id', 'assessment_id', 'finished_at', 'candidate_email', 'test_label'):
        op.drop_index(f'ix_autoproctor_attempts_{ix}', table_name='autoproctor_attempts')
    op.drop_table('autoproctor_attempts')
    op.drop_column('assessments', 'reminder_sent_at')
    op.drop_column('assessments', 'completed_at')
