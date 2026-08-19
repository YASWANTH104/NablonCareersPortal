import uuid
from datetime import date, datetime
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.resource import EmployeeProfile, Project, ProjectAllocation
from app.models.user import User
from app.schemas.resource import (
    EmployeeProfileCreate, EmployeeProfileUpdate, EmployeeProfileResponse, AllocationSummary,
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectDetailResponse, RosterMember,
    ProjectAllocationCreate, ProjectAllocationUpdate, ProjectAllocationResponse,
    OnboardableUser, ResourceStatsResponse,
    EMPLOYMENT_TYPES, BILLING_STATUSES, PROJECT_STATUSES,
)

_INTERNAL_ROLES = ("employee", "interviewer", "hr_manager", "admin", "super_admin")


def _validate_choice(value: str | None, allowed: tuple[str, ...], field: str) -> None:
    if value is not None and value not in allowed:
        raise HTTPException(400, f"Invalid {field} '{value}'. Must be one of: {', '.join(allowed)}")


# ── Onboarding ────────────────────────────────────────────────────────────────

async def list_onboardable_users(db: AsyncSession) -> list[OnboardableUser]:
    """Internal-role users who don't have a resource profile yet."""
    existing = (await db.execute(select(EmployeeProfile.user_id))).scalars().all()
    rows = (await db.execute(
        select(User)
        .where(User.role.in_(_INTERNAL_ROLES), User.is_active == True)
        .where(User.id.notin_(existing) if existing else True)
        .order_by(User.full_name)
    )).scalars().all()
    return [
        OnboardableUser(id=u.id, full_name=u.full_name, email=u.email, role=u.role, department=u.department)
        for u in rows
    ]


# ── Employee profile CRUD ────────────────────────────────────────────────────

async def _active_allocations_by_profile(db: AsyncSession, profile_ids: list[uuid.UUID]) -> dict:
    if not profile_ids:
        return {}
    rows = (await db.execute(
        select(ProjectAllocation, Project.name.label("project_name"))
        .join(Project, Project.id == ProjectAllocation.project_id)
        .where(ProjectAllocation.employee_profile_id.in_(profile_ids), ProjectAllocation.end_date.is_(None))
        .order_by(ProjectAllocation.created_at)
    )).all()
    grouped: dict = {}
    for alloc, project_name in rows:
        grouped.setdefault(alloc.employee_profile_id, []).append(
            AllocationSummary(
                id=alloc.id,
                project_id=alloc.project_id,
                project_name=project_name,
                allocation_percent=alloc.allocation_percent,
                role_on_project=alloc.role_on_project,
                start_date=alloc.start_date,
                end_date=alloc.end_date,
            )
        )
    return grouped


def _to_response(profile: EmployeeProfile, user: User, allocations: list[AllocationSummary]) -> EmployeeProfileResponse:
    return EmployeeProfileResponse(
        id=profile.id,
        user_id=profile.user_id,
        full_name=user.full_name,
        email=user.email,
        avatar_url=user.avatar_url,
        role=user.role,
        employee_code=profile.employee_code,
        designation=profile.designation,
        department=profile.department,
        employment_type=profile.employment_type,
        billing_status=profile.billing_status,
        date_of_joining=profile.date_of_joining,
        total_experience_years=float(profile.total_experience_years) if profile.total_experience_years is not None else None,
        location=profile.location,
        bio=profile.bio,
        skills=profile.skills or [],
        resume_url=profile.resume_url,
        resume_name=profile.resume_name,
        is_active=profile.is_active,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
        current_allocations=allocations,
        total_allocated_percent=sum(a.allocation_percent for a in allocations),
    )


async def create_employee_profile(db: AsyncSession, data: EmployeeProfileCreate) -> EmployeeProfileResponse:
    _validate_choice(data.employment_type, EMPLOYMENT_TYPES, "employment_type")
    _validate_choice(data.billing_status, BILLING_STATUSES, "billing_status")

    user = await db.get(User, data.user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.role not in _INTERNAL_ROLES:
        raise HTTPException(400, "Only internal staff (employee/interviewer/HR/admin) can have a resource profile")

    existing = (await db.execute(
        select(EmployeeProfile).where(EmployeeProfile.user_id == data.user_id)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "This person already has a resource profile")

    if data.employee_code:
        code_taken = (await db.execute(
            select(EmployeeProfile).where(EmployeeProfile.employee_code == data.employee_code)
        )).scalar_one_or_none()
        if code_taken:
            raise HTTPException(409, f"Employee code '{data.employee_code}' is already in use")

    profile = EmployeeProfile(**data.model_dump())
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return _to_response(profile, user, [])


async def list_employee_profiles(
    db: AsyncSession,
    *,
    project_id: uuid.UUID | None = None,
    billing_status: str | None = None,
    employment_type: str | None = None,
    department: str | None = None,
    unallocated: bool | None = None,
    skill: str | None = None,
    search: str | None = None,
    include_inactive: bool = False,
) -> list[EmployeeProfileResponse]:
    query = select(EmployeeProfile, User).join(User, User.id == EmployeeProfile.user_id)
    if not include_inactive:
        query = query.where(EmployeeProfile.is_active == True)
    if billing_status:
        query = query.where(EmployeeProfile.billing_status == billing_status)
    if employment_type:
        query = query.where(EmployeeProfile.employment_type == employment_type)
    if department:
        query = query.where(EmployeeProfile.department.ilike(f"%{department}%"))

    rows = (await db.execute(query.order_by(User.full_name))).all()
    profile_ids = [p.id for p, _ in rows]
    allocations_by_profile = await _active_allocations_by_profile(db, profile_ids)

    results = []
    for profile, user in rows:
        allocations = allocations_by_profile.get(profile.id, [])

        if unallocated is True and allocations:
            continue
        if unallocated is False and not allocations:
            continue
        if project_id and not any(a.project_id == project_id for a in allocations):
            continue

        if skill and not any(skill.lower() in (s or "").lower() for s in (profile.skills or [])):
            continue

        if search:
            haystack = " ".join(filter(None, [
                user.full_name, profile.designation, profile.department,
                *(profile.skills or []),
            ])).lower()
            if search.lower() not in haystack:
                continue

        results.append(_to_response(profile, user, allocations))

    return results


async def get_employee_profile(db: AsyncSession, profile_id: uuid.UUID) -> EmployeeProfileResponse:
    row = (await db.execute(
        select(EmployeeProfile, User).join(User, User.id == EmployeeProfile.user_id)
        .where(EmployeeProfile.id == profile_id)
    )).first()
    if not row:
        raise HTTPException(404, "Resource profile not found")
    profile, user = row
    allocations_by_profile = await _active_allocations_by_profile(db, [profile.id])
    return _to_response(profile, user, allocations_by_profile.get(profile.id, []))


async def update_employee_profile(db: AsyncSession, profile_id: uuid.UUID, data: EmployeeProfileUpdate) -> EmployeeProfileResponse:
    _validate_choice(data.employment_type, EMPLOYMENT_TYPES, "employment_type")
    _validate_choice(data.billing_status, BILLING_STATUSES, "billing_status")

    profile = await db.get(EmployeeProfile, profile_id)
    if not profile:
        raise HTTPException(404, "Resource profile not found")

    updates = data.model_dump(exclude_unset=True)
    if "employee_code" in updates and updates["employee_code"] and updates["employee_code"] != profile.employee_code:
        code_taken = (await db.execute(
            select(EmployeeProfile).where(
                EmployeeProfile.employee_code == updates["employee_code"],
                EmployeeProfile.id != profile_id,
            )
        )).scalar_one_or_none()
        if code_taken:
            raise HTTPException(409, f"Employee code '{updates['employee_code']}' is already in use")

    for field, val in updates.items():
        setattr(profile, field, val)
    profile.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(profile)

    user = await db.get(User, profile.user_id)
    allocations_by_profile = await _active_allocations_by_profile(db, [profile.id])
    return _to_response(profile, user, allocations_by_profile.get(profile.id, []))


async def set_resume(db: AsyncSession, profile_id: uuid.UUID, resume_url: str, resume_name: str) -> EmployeeProfileResponse:
    profile = await db.get(EmployeeProfile, profile_id)
    if not profile:
        raise HTTPException(404, "Resource profile not found")
    profile.resume_url = resume_url
    profile.resume_name = resume_name
    profile.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(profile)
    user = await db.get(User, profile.user_id)
    allocations_by_profile = await _active_allocations_by_profile(db, [profile.id])
    return _to_response(profile, user, allocations_by_profile.get(profile.id, []))


# ── Projects ─────────────────────────────────────────────────────────────────

async def create_project(db: AsyncSession, data: ProjectCreate) -> ProjectResponse:
    _validate_choice(data.status, PROJECT_STATUSES, "status")
    project = Project(**data.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return ProjectResponse.model_validate(project, from_attributes=True)


async def _headcounts(db: AsyncSession, project_ids: list[uuid.UUID]) -> dict:
    if not project_ids:
        return {}
    rows = (await db.execute(
        select(ProjectAllocation.project_id, func.count().label("cnt"))
        .where(ProjectAllocation.project_id.in_(project_ids), ProjectAllocation.end_date.is_(None))
        .group_by(ProjectAllocation.project_id)
    )).all()
    return {pid: cnt for pid, cnt in rows}


async def list_projects(db: AsyncSession, status: str | None = None) -> list[ProjectResponse]:
    query = select(Project)
    if status:
        query = query.where(Project.status == status)
    projects = (await db.execute(query.order_by(Project.name))).scalars().all()
    headcounts = await _headcounts(db, [p.id for p in projects])
    return [
        ProjectResponse(**{**ProjectResponse.model_validate(p, from_attributes=True).model_dump(), "headcount": headcounts.get(p.id, 0)})
        for p in projects
    ]


async def get_project_detail(db: AsyncSession, project_id: uuid.UUID) -> ProjectDetailResponse:
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    rows = (await db.execute(
        select(ProjectAllocation, EmployeeProfile, User)
        .join(EmployeeProfile, EmployeeProfile.id == ProjectAllocation.employee_profile_id)
        .join(User, User.id == EmployeeProfile.user_id)
        .where(ProjectAllocation.project_id == project_id)
        .order_by(ProjectAllocation.end_date.is_(None).desc(), ProjectAllocation.start_date.desc().nullslast())
    )).all()

    roster = [
        RosterMember(
            allocation_id=alloc.id,
            employee_profile_id=profile.id,
            full_name=user.full_name,
            designation=profile.designation,
            allocation_percent=alloc.allocation_percent,
            role_on_project=alloc.role_on_project,
            start_date=alloc.start_date,
            end_date=alloc.end_date,
        )
        for alloc, profile, user in rows
    ]
    headcount = sum(1 for m in roster if m.end_date is None)

    return ProjectDetailResponse(
        **ProjectResponse.model_validate(project, from_attributes=True).model_dump(exclude={"headcount"}),
        headcount=headcount,
        roster=roster,
    )


async def update_project(db: AsyncSession, project_id: uuid.UUID, data: ProjectUpdate) -> ProjectResponse:
    _validate_choice(data.status, PROJECT_STATUSES, "status")
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(project, field, val)
    project.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(project)
    headcounts = await _headcounts(db, [project.id])
    return ProjectResponse(**{**ProjectResponse.model_validate(project, from_attributes=True).model_dump(), "headcount": headcounts.get(project.id, 0)})


# ── Allocations ──────────────────────────────────────────────────────────────

async def _active_allocation_total(db: AsyncSession, employee_profile_id: uuid.UUID, exclude_allocation_id: uuid.UUID | None = None) -> int:
    query = select(func.coalesce(func.sum(ProjectAllocation.allocation_percent), 0)).where(
        ProjectAllocation.employee_profile_id == employee_profile_id,
        ProjectAllocation.end_date.is_(None),
    )
    if exclude_allocation_id:
        query = query.where(ProjectAllocation.id != exclude_allocation_id)
    return (await db.execute(query)).scalar_one()


async def _allocation_to_response(db: AsyncSession, alloc: ProjectAllocation) -> ProjectAllocationResponse:
    project = await db.get(Project, alloc.project_id)
    profile = await db.get(EmployeeProfile, alloc.employee_profile_id)
    user = await db.get(User, profile.user_id) if profile else None
    return ProjectAllocationResponse(
        id=alloc.id,
        employee_profile_id=alloc.employee_profile_id,
        project_id=alloc.project_id,
        project_name=project.name if project else None,
        employee_name=user.full_name if user else None,
        allocation_percent=alloc.allocation_percent,
        role_on_project=alloc.role_on_project,
        start_date=alloc.start_date,
        end_date=alloc.end_date,
        notes=alloc.notes,
        created_at=alloc.created_at,
    )


async def create_allocation(db: AsyncSession, employee_profile_id: uuid.UUID, data: ProjectAllocationCreate) -> ProjectAllocationResponse:
    profile = await db.get(EmployeeProfile, employee_profile_id)
    if not profile:
        raise HTTPException(404, "Resource profile not found")
    project = await db.get(Project, data.project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    if data.allocation_percent <= 0 or data.allocation_percent > 100:
        raise HTTPException(400, "Allocation percent must be between 1 and 100")

    current_total = await _active_allocation_total(db, employee_profile_id)
    if current_total + data.allocation_percent > 100:
        raise HTTPException(
            400,
            f"This would put {profile.employee_code or 'this associate'} at "
            f"{current_total + data.allocation_percent}% allocation (currently {current_total}%). "
            f"End or reduce an existing allocation first.",
        )

    allocation = ProjectAllocation(employee_profile_id=employee_profile_id, **data.model_dump())
    db.add(allocation)
    await db.commit()
    await db.refresh(allocation)
    return await _allocation_to_response(db, allocation)


async def update_allocation(db: AsyncSession, allocation_id: uuid.UUID, data: ProjectAllocationUpdate) -> ProjectAllocationResponse:
    allocation = await db.get(ProjectAllocation, allocation_id)
    if not allocation:
        raise HTTPException(404, "Allocation not found")

    updates = data.model_dump(exclude_unset=True)
    new_percent = updates.get("allocation_percent", allocation.allocation_percent)
    if allocation.end_date is None and updates.get("end_date") is None:
        other_total = await _active_allocation_total(db, allocation.employee_profile_id, exclude_allocation_id=allocation_id)
        if other_total + new_percent > 100:
            raise HTTPException(400, f"This would put the associate at {other_total + new_percent}% allocation")

    for field, val in updates.items():
        setattr(allocation, field, val)
    allocation.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(allocation)
    return await _allocation_to_response(db, allocation)


async def end_allocation(db: AsyncSession, allocation_id: uuid.UUID, end_date: date | None = None) -> ProjectAllocationResponse:
    allocation = await db.get(ProjectAllocation, allocation_id)
    if not allocation:
        raise HTTPException(404, "Allocation not found")
    allocation.end_date = end_date or date.today()
    allocation.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(allocation)
    return await _allocation_to_response(db, allocation)


async def delete_allocation(db: AsyncSession, allocation_id: uuid.UUID) -> None:
    allocation = await db.get(ProjectAllocation, allocation_id)
    if not allocation:
        raise HTTPException(404, "Allocation not found")
    await db.delete(allocation)
    await db.commit()


# ── Stats ────────────────────────────────────────────────────────────────────

async def get_stats(db: AsyncSession) -> ResourceStatsResponse:
    profiles = (await db.execute(
        select(EmployeeProfile).where(EmployeeProfile.is_active == True)
    )).scalars().all()

    profile_ids = [p.id for p in profiles]
    allocations_by_profile = await _active_allocations_by_profile(db, profile_ids)

    by_billing = {s: 0 for s in BILLING_STATUSES}
    by_employment = {t: 0 for t in EMPLOYMENT_TYPES}
    by_department: dict[str, int] = {}
    unallocated = 0

    for p in profiles:
        by_billing[p.billing_status] = by_billing.get(p.billing_status, 0) + 1
        by_employment[p.employment_type] = by_employment.get(p.employment_type, 0) + 1
        dept = p.department or "Unassigned"
        by_department[dept] = by_department.get(dept, 0) + 1
        if not allocations_by_profile.get(p.id):
            unallocated += 1

    return ResourceStatsResponse(
        total=len(profiles),
        billable=by_billing.get("billable", 0),
        non_billable=by_billing.get("non_billable", 0),
        bench=by_billing.get("bench", 0),
        training=by_billing.get("training", 0),
        interns=by_employment.get("intern", 0),
        unallocated=unallocated,
        by_department=by_department,
        by_employment_type=by_employment,
    )
