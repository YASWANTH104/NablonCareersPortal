"""add hiring_manager_id to jobs, on_hold to applications

Revision ID: 49c5bd999d3d
Revises: a3b4c5d6e7f8
Create Date: 2026-08-02 14:58:32.382377

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '49c5bd999d3d'
down_revision: Union[str, None] = 'a3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('applications', sa.Column('on_hold', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('applications', sa.Column('hold_reason', sa.Text(), nullable=True))
    op.add_column('jobs', sa.Column('hiring_manager_id', sa.UUID(), nullable=True))
    op.create_foreign_key('jobs_hiring_manager_id_fkey', 'jobs', 'users', ['hiring_manager_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('jobs_hiring_manager_id_fkey', 'jobs', type_='foreignkey')
    op.drop_column('jobs', 'hiring_manager_id')
    op.drop_column('applications', 'hold_reason')
    op.drop_column('applications', 'on_hold')
