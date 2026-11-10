"""zoho_sign_esign

Zoho Sign e-signature for offer letters: one envelope row per send
(offer_signature_requests), its parties (offer_signers), the activity trail
(offer_signature_events), single-row dialog defaults (esign_settings), and
offer_letters.esign_completed_at. Signed PDFs are not stored on our side —
they're fetched from Zoho on demand. The settings row is
seeded with no company signatory — the dialog falls back to DIRECTOR_NAME /
DIRECTOR_EMAIL until an admin sets one in Settings → Integrations.

Revision ID: e8f9a0b1c2d5
Revises: d7e8f9a0b1c4
Create Date: 2026-10-31

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e8f9a0b1c2d5'
down_revision: Union[str, None] = 'd7e8f9a0b1c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('offer_letters', sa.Column('esign_completed_at', sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        'offer_signature_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('offer_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('offer_letters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('zoho_request_id', sa.String(64), nullable=True, unique=True),
        sa.Column('zoho_document_id', sa.String(64), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='inprogress'),
        sa.Column('is_sequential', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('expiration_days', sa.Integer(), nullable=False, server_default='14'),
        sa.Column('reminder_days', sa.Integer(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('sent_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_offer_signature_requests_offer_id', 'offer_signature_requests', ['offer_id'])

    op.create_table(
        'offer_signers',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('signature_request_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('offer_signature_requests.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(30), nullable=False),
        sa.Column('action_type', sa.String(20), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('signing_order', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('source', sa.String(20), nullable=False, server_default='manual'),
        sa.Column('zoho_action_id', sa.String(64), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('viewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('signed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decline_reason', sa.Text(), nullable=True),
    )
    op.create_index('ix_offer_signers_signature_request_id', 'offer_signers', ['signature_request_id'])

    op.create_table(
        'offer_signature_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('signature_request_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('offer_signature_requests.id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_type', sa.String(40), nullable=False),
        sa.Column('actor_name', sa.String(255), nullable=True),
        sa.Column('actor_email', sa.String(255), nullable=True),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('payload', postgresql.JSONB(), nullable=True),
        sa.Column('dedupe_key', sa.String(255), nullable=False, unique=True),
        sa.Column('occurred_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_offer_signature_events_signature_request_id', 'offer_signature_events', ['signature_request_id'])

    op.create_table(
        'esign_settings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('signatory_name', sa.String(255), nullable=True),
        sa.Column('signatory_email', sa.String(255), nullable=True),
        sa.Column('default_parties', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('expiration_days', sa.Integer(), nullable=False, server_default='14'),
        sa.Column('reminder_days', sa.Integer(), nullable=True, server_default='3'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint('id = 1', name='ck_esign_settings_single_row'),
    )
    op.execute("INSERT INTO esign_settings (id) VALUES (1)")


def downgrade() -> None:
    op.drop_table('esign_settings')
    op.drop_index('ix_offer_signature_events_signature_request_id', table_name='offer_signature_events')
    op.drop_table('offer_signature_events')
    op.drop_index('ix_offer_signers_signature_request_id', table_name='offer_signers')
    op.drop_table('offer_signers')
    op.drop_index('ix_offer_signature_requests_offer_id', table_name='offer_signature_requests')
    op.drop_table('offer_signature_requests')
    op.drop_column('offer_letters', 'esign_completed_at')
