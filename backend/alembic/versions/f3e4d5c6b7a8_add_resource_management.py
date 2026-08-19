"""add_resource_management

Revision ID: f3e4d5c6b7a8
Revises: e2f3a4b5c6d7
Create Date: 2026-08-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f3e4d5c6b7a8'
down_revision: Union[str, None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'employee_profiles',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('employee_code', sa.String(50), nullable=True),
        sa.Column('designation', sa.String(150), nullable=True),
        sa.Column('department', sa.String(100), nullable=True),
        sa.Column('employment_type', sa.String(20), nullable=False, server_default='full_time'),
        sa.Column('billing_status', sa.String(20), nullable=False, server_default='non_billable'),
        sa.Column('date_of_joining', sa.Date(), nullable=True),
        sa.Column('total_experience_years', sa.Numeric(4, 1), nullable=True),
        sa.Column('location', sa.String(150), nullable=True),
        sa.Column('bio', sa.Text(), nullable=True),
        sa.Column('skills', postgresql.JSONB(), nullable=True),
        sa.Column('resume_url', sa.Text(), nullable=True),
        sa.Column('resume_name', sa.String(255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('user_id', name='uq_employee_profile_user'),
        sa.UniqueConstraint('employee_code', name='uq_employee_profile_code'),
    )
    op.create_index('ix_employee_profiles_user_id', 'employee_profiles', ['user_id'], unique=True)

    op.create_table(
        'projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('client_name', sa.String(255), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )

    op.create_table(
        'project_allocations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('employee_profile_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('employee_profiles.id'), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('allocation_percent', sa.Integer(), nullable=False, server_default='100'),
        sa.Column('role_on_project', sa.String(150), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_project_allocations_employee_profile_id', 'project_allocations', ['employee_profile_id'])
    op.create_index('ix_project_allocations_project_id', 'project_allocations', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_project_allocations_project_id', table_name='project_allocations')
    op.drop_index('ix_project_allocations_employee_profile_id', table_name='project_allocations')
    op.drop_table('project_allocations')
    op.drop_table('projects')
    op.drop_index('ix_employee_profiles_user_id', table_name='employee_profiles')
    op.drop_table('employee_profiles')
