"""add_director_approval_to_offers

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-07-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('offer_letters', 'status', type_=sa.String(30))
    op.add_column(
        'offer_letters',
        sa.Column('director_token', sa.Text(), nullable=True, unique=True)
    )
    op.add_column(
        'offer_letters',
        sa.Column('director_signature', sa.Text(), nullable=True)
    )
    op.add_column(
        'offer_letters',
        sa.Column('director_approved_at', sa.DateTime(timezone=True), nullable=True)
    )
    op.create_unique_constraint(
        'uq_offer_letters_director_token',
        'offer_letters',
        ['director_token']
    )


def downgrade() -> None:
    op.drop_constraint('uq_offer_letters_director_token', 'offer_letters', type_='unique')
    op.drop_column('offer_letters', 'director_approved_at')
    op.drop_column('offer_letters', 'director_signature')
    op.drop_column('offer_letters', 'director_token')
    op.alter_column('offer_letters', 'status', type_=sa.String(20))
