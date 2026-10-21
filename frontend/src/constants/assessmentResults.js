// The bar the nightly sync acts on (backend autoproctor_service.SCORE_BAR /
// TRUST_BAR) and the candidate email states: score at least 75% AND trust at
// least 90%, inclusive. Meeting it advances the candidate; missing it rejects.
// Change all three together.
export const TRUST_BAR = 90;
export const SCORE_BAR = 75;

export const meetsBar = (a) =>
  a?.trust_score_pct != null && a?.percentage_scored != null
  && a.trust_score_pct >= TRUST_BAR && a.percentage_scored >= SCORE_BAR;

// What the sync did with the candidate based on their result.
export const DECISION_LABELS = {
  advanced: { label: 'Moved to next round', cls: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Rejected (below bar)', cls: 'bg-rose-50 text-rose-700' },
  skipped: { label: 'Already moved by HR', cls: 'bg-surface-100 text-gray-600' },
};

// Keys match autoproctor_scraper.VIOLATION_LABELS on the backend.
export const VIOLATIONS = [
  { key: 'tab_switched', label: 'Tab switches' },
  { key: 'no_face', label: 'No face detected' },
  { key: 'multiple_faces', label: 'Multiple faces' },
  { key: 'noise', label: 'Noise detected' },
  { key: 'exited_fullscreen', label: 'Exited full screen' },
  { key: 'multiple_monitors', label: 'Multiple monitors' },
];

export const ASSESSMENT_STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-700',
  submitted: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  evaluated: 'bg-green-100 text-green-700',
  expired: 'bg-gray-200 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
};

export function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
