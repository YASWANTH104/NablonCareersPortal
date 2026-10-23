"""job_internal_title

HR's own name for a requisition, kept alongside the candidate-facing
(external) title. NULL = no separate internal name; HR screens fall back
to the external title.

Revision ID: b5c6d7e8f9a2
Revises: a4b5c6d7e8f1
Create Date: 2026-10-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b5c6d7e8f9a2'
down_revision: Union[str, None] = 'a4b5c6d7e8f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('jobs', sa.Column('internal_title', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('jobs', 'internal_title')
