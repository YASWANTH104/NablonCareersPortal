"""widen current_ctc, expected_ctc and notice_period to 255

Real answers overflowed the 50-char cap on these free-text fields (e.g. a notice
period of "3 months, negotiable - currently serving until 15 September"), which
Postgres rejected at commit with StringDataRightTruncationError. That surfaced
to agencies as a bare 500 with no indication of which field was at fault.

Widening a varchar is metadata-only in Postgres 9.2+ — no table rewrite, no
lock beyond a brief ACCESS EXCLUSIVE, safe on a live table.

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-08-08

"""
from alembic import op
import sqlalchemy as sa

revision = 'a8b9c0d1e2f3'
down_revision = 'f7a8b9c0d1e2'
branch_labels = None
depends_on = None

_COLUMNS = ('current_ctc', 'expected_ctc', 'notice_period')


def upgrade() -> None:
    for column in _COLUMNS:
        op.alter_column(
            'applications', column,
            existing_type=sa.String(50),
            type_=sa.String(255),
            existing_nullable=True,
        )


def downgrade() -> None:
    # Narrowing would fail on any row already storing more than 50 characters,
    # so truncate first — the alternative is a downgrade that cannot run.
    for column in _COLUMNS:
        op.execute(
            f"UPDATE applications SET {column} = left({column}, 50) "
            f"WHERE {column} IS NOT NULL AND length({column}) > 50"
        )
        op.alter_column(
            'applications', column,
            existing_type=sa.String(255),
            type_=sa.String(50),
            existing_nullable=True,
        )
