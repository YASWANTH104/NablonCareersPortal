"""add jd_pdf_url and jd_pdf_name to jobs

Revision ID: a1b2c3d4e5f7
Revises: d5e6f7a8b9c0
Create Date: 2026-07-22

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('jobs', sa.Column('jd_pdf_url', sa.Text(), nullable=True))
    op.add_column('jobs', sa.Column('jd_pdf_name', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('jobs', 'jd_pdf_name')
    op.drop_column('jobs', 'jd_pdf_url')
