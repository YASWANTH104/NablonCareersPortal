import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, Text, DateTime, Integer, ForeignKey, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class OfferSignatureRequest(Base):
    """One Zoho Sign envelope for an offer letter. Zoho requests can't be edited
    once sent, so a recall + resend creates a new row — the latest row per offer
    is the live one, older rows stay as history. The signed PDF and certificate
    stay in Zoho only; zoho_request_id is how we fetch them."""
    __tablename__ = "offer_signature_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    offer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("offer_letters.id", ondelete="CASCADE"), nullable=False, index=True)
    zoho_request_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    zoho_document_id: Mapped[str | None] = mapped_column(String(64))

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="inprogress")
    # inprogress | completed | declined | expired | recalled | failed

    is_sequential: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expiration_days: Mapped[int] = mapped_column(Integer, nullable=False, default=14)
    reminder_days: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)

    sent_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class OfferSigner(Base):
    __tablename__ = "offer_signers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    signature_request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("offer_signature_requests.id", ondelete="CASCADE"), nullable=False, index=True)

    role: Mapped[str] = mapped_column(String(30), nullable=False)
    # company_signatory | candidate | signer | approver | viewer
    action_type: Mapped[str] = mapped_column(String(20), nullable=False)  # SIGN | APPROVER | VIEW
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    signing_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    # zoho_user | manual | candidate | default

    zoho_action_id: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # pending | notified | viewed | signed | approved | declined
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decline_reason: Mapped[str | None] = mapped_column(Text)


class OfferSignatureEvent(Base):
    """Audit trail shown as the activity log in the signature tracker. dedupe_key
    makes webhook redelivery and the polling sync idempotent."""
    __tablename__ = "offer_signature_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    signature_request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("offer_signature_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # sent | viewed | signed | approved | declined | completed | expired | recalled | reminded
    actor_name: Mapped[str | None] = mapped_column(String(255))
    actor_email: Mapped[str | None] = mapped_column(String(255))
    detail: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class EsignSettings(Base):
    """Single-row defaults for the Send for signature dialog. Secrets stay in env."""
    __tablename__ = "esign_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    signatory_name: Mapped[str | None] = mapped_column(String(255))
    signatory_email: Mapped[str | None] = mapped_column(String(255))
    # [{name, email, role: signer|approver|viewer}] added to every new envelope
    default_parties: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    expiration_days: Mapped[int] = mapped_column(Integer, nullable=False, default=14, server_default="14")
    reminder_days: Mapped[int | None] = mapped_column(Integer, default=3, server_default="3")
    note: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (CheckConstraint("id = 1", name="ck_esign_settings_single_row"),)
