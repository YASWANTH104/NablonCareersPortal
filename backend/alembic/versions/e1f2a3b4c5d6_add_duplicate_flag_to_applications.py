"""add duplicate detection fields to applications

Revision ID: e1f2a3b4c5d6
Revises: b2c3d4e5f8a9
Create Date: 2026-07-24

"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'b2c3d4e5f8a9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('applications', sa.Column('duplicate_flag', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('applications', sa.Column('duplicate_reason', sa.Text(), nullable=True))
    op.add_column('applications', sa.Column('duplicate_reviewed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('applications', sa.Column('duplicate_reviewed_by', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_applications_duplicate_reviewed_by_users',
        'applications', 'users', ['duplicate_reviewed_by'], ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_applications_duplicate_reviewed_by_users', 'applications', type_='foreignkey')
    op.drop_column('applications', 'duplicate_reviewed_by')
    op.drop_column('applications', 'duplicate_reviewed_at')
    op.drop_column('applications', 'duplicate_reason')
    op.drop_column('applications', 'duplicate_flag')
