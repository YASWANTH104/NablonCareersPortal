"""add feedback_token to interview_panelists

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-07-20
"""
import secrets
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'interview_panelists',
        sa.Column('feedback_token', sa.String(length=64), nullable=True),
    )

    # Backfill unique tokens for existing panelist rows
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT interview_id, user_id FROM interview_panelists WHERE feedback_token IS NULL"
    )).fetchall()
    for interview_id, user_id in rows:
        conn.execute(
            sa.text(
                "UPDATE interview_panelists SET feedback_token = :token "
                "WHERE interview_id = :iid AND user_id = :uid"
            ),
            {"token": secrets.token_urlsafe(32), "iid": interview_id, "uid": user_id},
        )

    op.create_index(
        'ix_interview_panelists_feedback_token',
        'interview_panelists',
        ['feedback_token'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_interview_panelists_feedback_token', table_name='interview_panelists')
    op.drop_column('interview_panelists', 'feedback_token')
