"""assessment_auto_send_and_decisions

Per-job assessment mapping (auto-sent when a candidate reaches the
assessment stage) and the AutoProctor result decision log.

Revision ID: e2f3a4b5c6d9
Revises: d1e2f3a4b5c7
Create Date: 2026-10-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e2f3a4b5c6d9'
down_revision: Union[str, None] = 'd1e2f3a4b5c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('jobs', sa.Column('assessment_link', sa.Text, nullable=True))
    op.add_column('jobs', sa.Column('assessment_title', sa.String(200), nullable=True))
    op.add_column('jobs', sa.Column('assessment_duration_mins', sa.Integer, nullable=True))
    op.add_column('jobs', sa.Column('assessment_deadline_days', sa.Integer, nullable=True))
    op.add_column('autoproctor_attempts', sa.Column('decision', sa.String(20), nullable=True))
    op.add_column('autoproctor_attempts', sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('autoproctor_sync_runs', sa.Column('candidates_advanced', sa.Integer, nullable=False, server_default='0'))
    op.add_column('autoproctor_sync_runs', sa.Column('candidates_rejected', sa.Integer, nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('autoproctor_sync_runs', 'candidates_rejected')
    op.drop_column('autoproctor_sync_runs', 'candidates_advanced')
    op.drop_column('autoproctor_attempts', 'decided_at')
    op.drop_column('autoproctor_attempts', 'decision')
    op.drop_column('jobs', 'assessment_deadline_days')
    op.drop_column('jobs', 'assessment_duration_mins')
    op.drop_column('jobs', 'assessment_title')
    op.drop_column('jobs', 'assessment_link')
