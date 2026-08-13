// Single source of truth for the applications pipeline on the frontend —
// mirrors backend/app/constants/stages.py. Both ApplicantsPage (Kanban) and
// ApplicationDetailPage import from here instead of keeping their own copies.

export const PIPELINE_STAGES = [
  { key: 'applied',         label: 'Applied',         color: 'bg-blue-100 text-blue-800' },
  { key: 'screening',       label: 'Screening',       color: 'bg-purple-100 text-purple-800' },
  { key: 'assessment',      label: 'Assessment',      color: 'bg-orange-100 text-orange-800' },
  { key: 'tr1',             label: 'TR1',             color: 'bg-indigo-100 text-indigo-800' },
  { key: 'tr2',             label: 'TR2',             color: 'bg-indigo-100 text-indigo-800' },
  { key: 'hr',              label: 'HR',              color: 'bg-violet-100 text-violet-800' },
  { key: 'offer',           label: 'Offer',           color: 'bg-emerald-100 text-emerald-800' },
  { key: 'hired',           label: 'Hired',           color: 'bg-green-100 text-green-800' },
  { key: 'interview_drop',  label: 'Interview Drop',  color: 'bg-amber-100 text-amber-800' },
  { key: 'offer_drop',      label: 'Offer Drop',      color: 'bg-rose-100 text-rose-800' },
  { key: 'rejected',        label: 'Rejected',        color: 'bg-red-100 text-red-800' },
  { key: 'withdrawn',       label: 'Withdrawn',       color: 'bg-gray-100 text-gray-600' },
];

export const STAGE_MAP = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s]));

export const VALID_TRANSITIONS = {
  applied:         ['screening', 'rejected'],
  screening:       ['assessment', 'tr1', 'rejected'],
  assessment:      ['tr1', 'rejected', 'interview_drop'],
  tr1:             ['tr2', 'hr', 'offer', 'rejected', 'interview_drop'],
  tr2:             ['hr', 'offer', 'rejected', 'interview_drop'],
  hr:              ['offer', 'rejected', 'interview_drop'],
  offer:           ['hired', 'rejected', 'offer_drop'],
  hired:           [],
  rejected:        [],
  withdrawn:       [],
  interview_drop:  [],
  offer_drop:      [],
};

export const REASON_REQUIRED_STAGES = new Set(['rejected', 'interview_drop', 'offer_drop']);

export const MOVE_JOB_ALLOWED_STAGES = new Set(['applied', 'screening']);

export const DROP_REASON_CATEGORIES = [
  { value: 'got_another_offer', label: 'Got another offer' },
  { value: 'not_aligned_with_expectations', label: 'Not aligned with expectations' },
  { value: 'assessment_too_long', label: 'Assessment takes too long' },
  { value: 'compensation_mismatch', label: 'Compensation mismatch' },
  { value: 'communication_gap', label: 'Communication gap' },
  { value: 'profile_mismatch', label: 'Profile mismatch' },
  { value: 'other', label: 'Other' },
];
