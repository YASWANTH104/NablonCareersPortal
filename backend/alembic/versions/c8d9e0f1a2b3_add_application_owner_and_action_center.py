"""add_application_owner_and_action_center

Application ownership (first human stage mover), Action Center snoozes, and
the morning-digest send guard.

Revision ID: c8d9e0f1a2b3
Revises: f1a2b3c4d5e6
Create Date: 2026-10-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'c8d9e0f1a2b3'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('applications', sa.Column('owner_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True))
    op.add_column('applications', sa.Column('owned_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_applications_owner_id', 'applications', ['owner_id'])
    op.create_index('ix_applications_assigned_to', 'applications', ['assigned_to'])

    # Backfill ownership from history: the earliest REAL stage move made by a
    # person. Same "real move" definition the reports use — not a note
    # ('_note'), and not a same-stage record (move-job / resume-swap rows set
    # from_stage == to_stage). changed_by IS NULL is a system move
    # (screening auto-reject) and never claims.
    op.execute("""
        UPDATE applications a
        SET owner_id = f.changed_by, owned_at = f.created_at
        FROM (
            SELECT DISTINCT ON (h.application_id) h.application_id, h.changed_by, h.created_at
            FROM application_stage_history h
            WHERE h.changed_by IS NOT NULL
              AND h.to_stage <> '_note'
              AND h.from_stage IS NOT NULL
              AND h.from_stage <> h.to_stage
            ORDER BY h.application_id, h.created_at
        ) f
        WHERE a.id = f.application_id AND a.owner_id IS NULL
    """)
    # assigned_to was never set from the UI; seed it with the owner so the
    # Action Center's "mine" scope works for existing candidates on day one.
    op.execute("UPDATE applications SET assigned_to = owner_id WHERE assigned_to IS NULL AND owner_id IS NOT NULL")

    op.create_table(
        'action_snoozes',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('application_id', UUID(as_uuid=True), sa.ForeignKey('applications.id', ondelete='CASCADE'), nullable=False),
        sa.Column('action_type', sa.String(50), nullable=False),
        sa.Column('stage', sa.String(50), nullable=False),
        sa.Column('snoozed_until', sa.DateTime(timezone=True), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('snoozed_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_action_snoozes_lookup', 'action_snoozes', ['application_id', 'action_type', 'stage'])

    op.add_column('users', sa.Column('last_action_digest_on', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'last_action_digest_on')
    op.drop_index('ix_action_snoozes_lookup', table_name='action_snoozes')
    op.drop_table('action_snoozes')
    op.drop_index('ix_applications_assigned_to', table_name='applications')
    op.drop_index('ix_applications_owner_id', table_name='applications')
    op.drop_column('applications', 'owned_at')
    op.drop_column('applications', 'owner_id')
