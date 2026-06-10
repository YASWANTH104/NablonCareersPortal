"""add_candidate_token_to_offer_letters

Revision ID: a1b2c3d4e5f6
Revises: 315360e2b678
Create Date: 2026-06-07 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '315360e2b678'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'offer_letters',
        sa.Column('candidate_token', sa.Text(), nullable=True, unique=True)
    )
    op.create_unique_constraint(
        'uq_offer_letters_candidate_token',
        'offer_letters',
        ['candidate_token']
    )


def downgrade() -> None:
    op.drop_constraint('uq_offer_letters_candidate_token', 'offer_letters', type_='unique')
    op.drop_column('offer_letters', 'candidate_token')
