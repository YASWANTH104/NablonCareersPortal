// Mirrors backend/app/constants/stages.py's tr1/tr2/hr vocabulary — an
// interview slot's round_type is one of these, not a separate naming scheme.
export const ROUND_TYPES = [
  { key: 'tr1', label: 'Technical Round 1', color: 'bg-indigo-100 text-indigo-800' },
  { key: 'tr2', label: 'Technical Round 2', color: 'bg-indigo-100 text-indigo-800' },
  { key: 'hr', label: 'HR Interview', color: 'bg-violet-100 text-violet-800' },
];

export const ROUND_MAP = Object.fromEntries(ROUND_TYPES.map((r) => [r.key, r]));
