"""job_assessment_pass_stage

Per-job choice of where a candidate goes after clearing the assessment
(TR1 or the HR screening call).

Revision ID: f3a4b5c6d7e0
Revises: e2f3a4b5c6d9
Create Date: 2026-10-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f3a4b5c6d7e0'
down_revision: Union[str, None] = 'e2f3a4b5c6d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('jobs', sa.Column('assessment_pass_stage', sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column('jobs', 'assessment_pass_stage')
