"""add attachment_url and attachment_name to interview_feedback

Revision ID: b4c5d6e7f8a9
Revises: d1e2f3a4b5c6
Create Date: 2026-08-12

"""
from alembic import op
import sqlalchemy as sa

revision = 'b4c5d6e7f8a9'
down_revision = 'd1e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('interview_feedback', sa.Column('attachment_url', sa.Text(), nullable=True))
    op.add_column('interview_feedback', sa.Column('attachment_name', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('interview_feedback', 'attachment_name')
    op.drop_column('interview_feedback', 'attachment_url')
