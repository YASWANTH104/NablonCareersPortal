export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  HR_MANAGER: 'hr_manager',
  INTERVIEWER: 'interviewer',
  EMPLOYEE: 'employee',
  APPLICANT: 'applicant',
};

export const HR_ROLES = [ROLES.HR_MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN];
export const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];
export const INTERNAL_ROLES = [...HR_ROLES, ROLES.INTERVIEWER, ROLES.EMPLOYEE];

export function canPostJobs(role) {
  return HR_ROLES.includes(role);
}

export function canViewAllApplicants(role) {
  return [...HR_ROLES, ROLES.INTERVIEWER].includes(role);
}

export function canManageUsers(role) {
  return ADMIN_ROLES.includes(role);
}

export function canSubmitReferrals(role) {
  return INTERNAL_ROLES.includes(role);
}

export function canGenerateOffers(role) {
  return HR_ROLES.includes(role);
}

export function canViewAnalytics(role) {
  return HR_ROLES.includes(role);
}

export function getHomeRoute(role) {
  if (HR_ROLES.includes(role)) return '/hr/dashboard';
  if (role === ROLES.INTERVIEWER) return '/hr/interviews';
  if (role === ROLES.EMPLOYEE) return '/employee/refer';
  return '/portal/applications';
}
