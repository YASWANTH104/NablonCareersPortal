import uuid
from datetime import datetime, date
from sqlalchemy import String, Text, DateTime, Date, Integer, Numeric, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class EmployeeProfile(Base):
    """Resource-management record for an internal associate — one per `users`
    row with role in (employee, interviewer, hr_manager, admin, super_admin).
    Separate from the auth/role concern on User: this only exists for people
    HR has actually onboarded into the resourcing system (see
    resource_service.list_onboardable_users for who still needs one)."""

    __tablename__ = "employee_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, unique=True, index=True)

    employee_code: Mapped[str | None] = mapped_column(String(50), unique=True)
    designation: Mapped[str | None] = mapped_column(String(150))
    department: Mapped[str | None] = mapped_column(String(100))
    employment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="full_time")
    # full_time | intern | contract | part_time

    billing_status: Mapped[str] = mapped_column(String(20), nullable=False, default="non_billable")
    # billable | non_billable | bench | training

    date_of_joining: Mapped[date | None] = mapped_column(Date)
    total_experience_years: Mapped[float | None] = mapped_column(Numeric(4, 1))
    location: Mapped[str | None] = mapped_column(String(150))
    bio: Mapped[str | None] = mapped_column(Text)

    skills: Mapped[list | None] = mapped_column(JSONB)  # ["Python", "React", ...]

    resume_url: Mapped[str | None] = mapped_column(Text)
    resume_name: Mapped[str | None] = mapped_column(String(255))

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Soft flag for someone who has exited — profile/history kept, excluded
    # from default resourcing views.

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_name: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    # active | on_hold | completed
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class ProjectAllocation(Base):
    """A percentage-of-time allocation of one employee profile to one project.
    `end_date IS NULL` means the allocation is currently active — an employee
    with zero rows where end_date is null is 'unallocated' (bench candidate)."""

    __tablename__ = "project_allocations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_profile_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employee_profiles.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)

    allocation_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    role_on_project: Mapped[str | None] = mapped_column(String(150))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
