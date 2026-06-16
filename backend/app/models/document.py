import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


REQUIRED_DOCUMENT_TYPES = [
    {"type": "aadhaar",           "label": "Aadhaar Card"},
    {"type": "pan",               "label": "PAN Card"},
    {"type": "degree",            "label": "Degree Certificate"},
    {"type": "experience_letter", "label": "Experience Letter"},
    {"type": "payslip",           "label": "Latest Payslip"},
    {"type": "photo",             "label": "Passport Size Photo"},
]


class DocumentRequest(Base):
    __tablename__ = "document_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # pending | complete
    email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    documents: Mapped[list["ApplicationDocument"]] = relationship(
        "ApplicationDocument", back_populates="request", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("application_id", name="uq_document_request_application"),)


class ApplicationDocument(Base):
    __tablename__ = "application_documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("document_requests.id"), nullable=False)
    document_type: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    file_url: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    request: Mapped["DocumentRequest"] = relationship("DocumentRequest", back_populates="documents")
