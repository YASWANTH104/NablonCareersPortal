"""internship_offer_templates

Per-offer letter fields the internship letters need (letter date, internship
end date, reporting manager, candidate postal address), and seeds the India
and US internship templates from app/templates/offer_letters. Seeding skips a
template whose name already exists, so HR edits made in Manage Templates are
never overwritten.

Revision ID: d7e8f9a0b1c4
Revises: c6d7e8f9a0b3
Create Date: 2026-10-29

"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd7e8f9a0b1c4'
down_revision: Union[str, None] = 'c6d7e8f9a0b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / 'app' / 'templates' / 'offer_letters'
_TEMPLATES = [
    ('Internship Letter - India', 'internship_india.html'),
    ('Internship Letter - US', 'internship_us.html'),
]


def upgrade() -> None:
    op.add_column('offer_letters', sa.Column('letter_date', sa.Date(), nullable=True))
    op.add_column('offer_letters', sa.Column('end_date', sa.Date(), nullable=True))
    op.add_column('offer_letters', sa.Column('reporting_manager', sa.String(255), nullable=True))
    op.add_column('offer_letters', sa.Column('candidate_address', sa.Text(), nullable=True))

    conn = op.get_bind()
    for name, filename in _TEMPLATES:
        exists = conn.execute(
            sa.text("SELECT 1 FROM offer_templates WHERE name = :name"), {'name': name}
        ).first()
        if exists:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO offer_templates (id, name, body_html, is_default, created_at) "
                "VALUES (gen_random_uuid(), :name, :body_html, false, now())"
            ),
            {
                'name': name,
                'body_html': (_TEMPLATE_DIR / filename).read_text(encoding='utf-8'),
            },
        )


def downgrade() -> None:
    # Offers may still point at the seeded templates, so they are left in place
    op.drop_column('offer_letters', 'candidate_address')
    op.drop_column('offer_letters', 'reporting_manager')
    op.drop_column('offer_letters', 'end_date')
    op.drop_column('offer_letters', 'letter_date')
