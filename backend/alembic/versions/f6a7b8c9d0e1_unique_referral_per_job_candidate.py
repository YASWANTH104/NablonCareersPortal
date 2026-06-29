"""unique referral per job candidate

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-19

"""
from alembic import op

revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove duplicate referrals keeping the earliest created one per (job_id, candidate_email)
    op.execute("""
        DELETE FROM referrals
        WHERE id NOT IN (
            SELECT DISTINCT ON (job_id, candidate_email) id
            FROM referrals
            ORDER BY job_id, candidate_email, created_at ASC
        )
    """)
    op.create_unique_constraint(
        'uq_referral_job_candidate',
        'referrals',
        ['job_id', 'candidate_email'],
    )


def downgrade() -> None:
    op.drop_constraint('uq_referral_job_candidate', 'referrals', type_='unique')
