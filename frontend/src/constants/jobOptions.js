// Single source for the job option vocabularies. These lists were previously
// duplicated (and had drifted — the public board's employment-type filter was
// missing `freelance`, which JobEditPage can set, so freelance roles were
// unfilterable) across public/JobsPage, hr/JobEditPage and the referral pages.

export const LOCATION_TYPES = [
  { value: 'remote', label: 'Remote' },
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
];

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
  { value: 'freelance', label: 'Freelance' },
];

// Mirrors the backend's Criticality literal.
export const CRITICALITY_STYLES = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-surface-100 text-gray-500 border-surface-200',
};

export function formatEmploymentType(val) {
  return val?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '';
}

// "10.0L – 18.0L" style compact range, matching what JobCard already renders.
export function formatSalaryLakhs(job) {
  if (!job?.show_salary || !job.salary_min) return null;
  const min = (job.salary_min / 100000).toFixed(1);
  const max = job.salary_max ? (job.salary_max / 100000).toFixed(1) : null;
  return `${job.salary_currency ?? 'INR'} ${min}L${max ? ` – ${max}L` : '+'}`;
}
