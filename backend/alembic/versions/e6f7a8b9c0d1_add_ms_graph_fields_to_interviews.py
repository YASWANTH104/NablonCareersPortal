"""add ms_graph_event_id and ms_graph_organizer_email to interviews

Revision ID: e6f7a8b9c0d1
Revises: d2e3f4a5b6c7
Create Date: 2026-08-05

"""
from alembic import op
import sqlalchemy as sa

revision = 'e6f7a8b9c0d1'
down_revision = 'd2e3f4a5b6c7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('interviews', sa.Column('ms_graph_event_id', sa.String(255), nullable=True))
    op.add_column('interviews', sa.Column('ms_graph_organizer_email', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('interviews', 'ms_graph_organizer_email')
    op.drop_column('interviews', 'ms_graph_event_id')
