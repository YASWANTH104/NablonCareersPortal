// Mirrors backend/app/schemas/resource.py — keep both in sync.

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'intern', label: 'Intern' },
  { value: 'contract', label: 'Contract' },
  { value: 'part_time', label: 'Part-time' },
];

export const BILLING_STATUSES = [
  { value: 'billable', label: 'Billable', dot: 'bg-green-500', badge: 'bg-green-50 text-green-700' },
  { value: 'non_billable', label: 'Non-Billable', dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600' },
  { value: 'bench', label: 'Bench', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700' },
  { value: 'training', label: 'Training', dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700' },
];

export const PROJECT_STATUSES = [
  { value: 'active', label: 'Active', badge: 'bg-green-50 text-green-700' },
  { value: 'on_hold', label: 'On Hold', badge: 'bg-amber-50 text-amber-700' },
  { value: 'completed', label: 'Completed', badge: 'bg-gray-100 text-gray-600' },
];

export const EXAMPLE_QUERIES = [
  'Show all associates who are not allocated',
  'How many interns do we have?',
  'List billable associates',
  'Who is on the bench?',
];

export function labelFor(list, value) {
  return list.find((i) => i.value === value)?.label ?? value ?? '—';
}

export function billingMeta(value) {
  return BILLING_STATUSES.find((b) => b.value === value) ?? BILLING_STATUSES[1];
}

export function projectStatusMeta(value) {
  return PROJECT_STATUSES.find((p) => p.value === value) ?? PROJECT_STATUSES[0];
}
