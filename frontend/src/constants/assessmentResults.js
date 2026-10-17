// The shortlist bar candidates are told in the assessment email
// (backend templates/email/assessment_scheduled.html): Trust Score above 90%
// and Technical Score above 75%. Change both together.
export const TRUST_BAR = 90;
export const SCORE_BAR = 75;

export const meetsBar = (a) =>
  a?.trust_score_pct != null && a?.percentage_scored != null
  && a.trust_score_pct > TRUST_BAR && a.percentage_scored > SCORE_BAR;

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
