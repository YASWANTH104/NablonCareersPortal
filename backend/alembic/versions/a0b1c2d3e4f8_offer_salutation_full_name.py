"""offer_salutation_full_name

Offer letters greet the candidate by full name. Swaps {{candidate_first_name}}
for {{candidate_name}} in every stored offer template. Letters render live
from the template, so existing drafts pick this up without a re-save.

Revision ID: a0b1c2d3e4f8
Revises: f9a0b1c2d3e6
Create Date: 2026-11-13

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a0b1c2d3e4f8'
down_revision: Union[str, None] = 'f9a0b1c2d3e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE offer_templates "
        "SET body_html = REPLACE(body_html, '{{candidate_first_name}}', '{{candidate_name}}') "
        "WHERE body_html LIKE '%{{candidate_first_name}}%'"
    )


def downgrade() -> None:
    # Not reversible: we can't tell which {{candidate_name}} used to be first-name only
    pass
