"""add_sourced_by_to_applications

Records WHICH internal user uploaded a sourced candidate.

`source` already said HOW a candidate arrived ("talent_acquisition", "agency",
"direct", "referral") and `agency_id` said WHICH agency — but for a TA upload
there was nothing recording WHO, so the pipeline could not show which recruiter
sourced a profile.

Backfills from the resume blob path: every HR/TA upload stores its file under
`resumes/hr-<uploader_uuid>/...` (see routers/applications.py, which passes
f"hr-{user.id}" to storage_service.upload_resume), so the uploader is
recoverable for historical rows. Bulk uploads used a fixed "hr-bulk" prefix
with no user id in it and stay NULL — there is genuinely no record of who ran
those, and inventing one would be worse than leaving it blank.

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'applications',
        sa.Column('sourced_by', sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_applications_sourced_by_users', 'applications', 'users', ['sourced_by'], ['id'],
    )
    op.create_index('ix_applications_sourced_by', 'applications', ['sourced_by'])

    # Recover the uploader from the blob path. The regex only matches a full
    # 36-char UUID, so the "hr-bulk" prefix cannot accidentally match, and the
    # join to users drops any id that no longer exists.
    op.execute("""
        UPDATE applications AS a
           SET sourced_by = u.id
          FROM users AS u
         WHERE a.sourced_by IS NULL
           AND u.id::text = substring(a.resume_url from 'hr-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
    """)


def downgrade() -> None:
    op.drop_index('ix_applications_sourced_by', table_name='applications')
    op.drop_constraint('fk_applications_sourced_by_users', 'applications', type_='foreignkey')
    op.drop_column('applications', 'sourced_by')
