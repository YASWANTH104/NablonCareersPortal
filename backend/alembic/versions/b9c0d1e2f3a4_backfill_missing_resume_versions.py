"""backfill application_resumes v1 rows missed since the original backfill

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-08-09

The f7a8b9c0d1e2 backfill only covered applications that existed at the time
it ran (2026-08-08). No submission path wrote an application_resumes row for
new applications after that, so anything submitted since then has resume_url
set on the application but zero rows in application_resumes — and the Resume
tab reads only application_resumes, so it reports "no resume on file" despite
a real resume being on file. Application code now seeds v1 at submission time
going forward; this migration closes the gap for everything submitted between
the original backfill and that fix shipping.
"""
from alembic import op

revision = 'b9c0d1e2f3a4'
down_revision = 'a8b9c0d1e2f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO application_resumes
            (id, application_id, version, file_url, file_name, uploaded_by, uploaded_by_role, created_at)
        SELECT gen_random_uuid(), a.id, 1, a.resume_url, NULL, a.applicant_id, 'applicant', a.applied_at
        FROM applications a
        WHERE a.resume_url IS NOT NULL AND a.resume_url <> ''
          AND NOT EXISTS (
              SELECT 1 FROM application_resumes ar WHERE ar.application_id = a.id
          )
    """)


def downgrade() -> None:
    pass
