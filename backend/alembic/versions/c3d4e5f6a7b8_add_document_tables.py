"""add_document_tables

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-11 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'document_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('application_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('applications.id'), nullable=False),
        sa.Column('token', sa.String(128), nullable=False, unique=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('email_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('application_id', name='uq_document_request_application'),
    )
    op.create_index('ix_document_requests_token', 'document_requests', ['token'], unique=True)

    op.create_table(
        'application_documents',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('application_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('applications.id'), nullable=False),
        sa.Column('request_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('document_requests.id'), nullable=False),
        sa.Column('document_type', sa.String(50), nullable=False),
        sa.Column('label', sa.String(100), nullable=False),
        sa.Column('file_url', sa.Text(), nullable=False),
        sa.Column('file_name', sa.String(255), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_application_documents_request_id', 'application_documents', ['request_id'])
    op.create_index('ix_application_documents_application_id', 'application_documents', ['application_id'])


def downgrade() -> None:
    op.drop_index('ix_application_documents_application_id', table_name='application_documents')
    op.drop_index('ix_application_documents_request_id', table_name='application_documents')
    op.drop_table('application_documents')

    op.drop_index('ix_document_requests_token', table_name='document_requests')
    op.drop_table('document_requests')
