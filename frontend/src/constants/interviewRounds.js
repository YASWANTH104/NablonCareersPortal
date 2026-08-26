// Mirrors backend/app/constants/stages.py's SLOT_ROUND_TYPES / ROUND_ELIGIBLE_STAGE
// / ROUND_LABELS — an interview slot's round_type is one of these, not a
// separate naming scheme. Keep the two files in step.
//
// `screening` is the HR screening call: the first conversation, booked while
// the application is still at the screening stage. It is deliberately coloured
// and labelled nothing like `hr` (the late-stage HR interview) — agencies were
// reading "HR" on both and booking the wrong one.
export const ROUND_TYPES = [
  {
    key: 'screening',
    label: 'HR Screening Call',
    short: 'Screening',
    color: 'bg-purple-100 text-purple-800',
    // Agency-portal palette: border + tint + solid, used for the round tabs,
    // slot chips and badges so one round reads the same everywhere.
    accent: {
      badge: 'bg-purple-50 text-purple-700 border-purple-200',
      chip: 'border-purple-200 hover:border-purple-400 hover:bg-purple-50/60',
      tab: 'bg-purple-500 border-purple-500 text-white',
      dot: 'bg-purple-500',
    },
    blurb: 'First conversation with HR — candidates at the Screening stage only.',
  },
  {
    key: 'tr1',
    label: 'Technical Round 1',
    short: 'TR1',
    color: 'bg-indigo-100 text-indigo-800',
    accent: {
      badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      chip: 'border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/60',
      tab: 'bg-indigo-500 border-indigo-500 text-white',
      dot: 'bg-indigo-500',
    },
    blurb: 'First technical round — candidates at the Technical Round 1 stage only.',
  },
  {
    key: 'tr2',
    label: 'Technical Round 2',
    short: 'TR2',
    color: 'bg-sky-100 text-sky-800',
    accent: {
      badge: 'bg-sky-50 text-sky-700 border-sky-200',
      chip: 'border-sky-200 hover:border-sky-400 hover:bg-sky-50/60',
      tab: 'bg-sky-500 border-sky-500 text-white',
      dot: 'bg-sky-500',
    },
    blurb: 'Second technical round — candidates at the Technical Round 2 stage only.',
  },
  {
    key: 'hr',
    label: 'HR Interview',
    short: 'HR',
    color: 'bg-violet-100 text-violet-800',
    accent: {
      badge: 'bg-violet-50 text-violet-700 border-violet-200',
      chip: 'border-violet-200 hover:border-violet-400 hover:bg-violet-50/60',
      tab: 'bg-violet-500 border-violet-500 text-white',
      dot: 'bg-violet-500',
    },
    blurb: 'Final HR round — candidates at the HR Interview stage only.',
  },
];

export const ROUND_MAP = Object.fromEntries(ROUND_TYPES.map((r) => [r.key, r]));

// The stage a candidate must be sitting at to be booked into a given round.
// Strict 1:1, matching the backend gate exactly — the UI filters on this, the
// backend enforces it, and the two must agree or the portal shows candidates
// whose booking then gets rejected.
export const ROUND_ELIGIBLE_STAGE = {
  screening: 'screening',
  tr1: 'tr1',
  tr2: 'tr2',
  hr: 'hr',
};

export const roundLabel = (key) => ROUND_MAP[key]?.label ?? key;

// Mirrors backend/app/utils/rounds.py's round_display_label. Never print
// round_number on its own: a slot-booked HR screening call is round 0 ("Round
// 0"), and a manually scheduled one is round 1 — the same number as TR1. The
// round's identity is round_type; the number is a last-resort fallback for
// legacy rows that carry neither a title nor a type.
export function interviewRoundLabel(iv) {
  if (!iv) return 'Interview';
  const title = iv.title ?? iv.interview_title;
  if (title) return title;
  const label = ROUND_MAP[iv.round_type]?.label;
  if (label) return label;
  return iv.round_number ? `Round ${iv.round_number}` : 'Interview';
}

// Heading for the "previous round feedback" panel, where naming the round
// matters more than the interview's own title — an interviewer wants to know
// they're reading the screening call, not "Deep dive with Priya".
export function roundContextHeading(round) {
  const label = ROUND_MAP[round?.round_type]?.label;
  const title = round?.interview_title ?? round?.title;
  if (label) return title && title !== label ? `${label} — ${title}` : label;
  return interviewRoundLabel(round);
}

// A candidate is bookable into a round when they're at that round's stage AND
// don't already have a live interview for it. `booked_rounds` comes from the
// agency portal payload and empties out again when an interview is cancelled,
// which is what makes a cancelled candidate reappear in the list unprompted.
export function isBookableForRound(candidate, roundType) {
  if (!candidate || !roundType) return false;
  if (candidate.stage !== ROUND_ELIGIBLE_STAGE[roundType]) return false;
  return !(candidate.booked_rounds ?? []).includes(roundType);
}
