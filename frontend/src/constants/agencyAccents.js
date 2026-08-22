// Purely decorative per-partner identity so a wall of agency cards doesn't read
// as one repeated grey block. Deliberately NOT a data encoding — nothing is
// measured by these, so they carry no meaning and need no CVD validation; the
// partner's name always sits right beside the tile.
const ACCENTS = [
  { tile: 'bg-brand-50 text-brand-600', bar: 'from-brand-400 to-brand-600' },
  { tile: 'bg-violet-50 text-violet-600', bar: 'from-violet-400 to-violet-600' },
  { tile: 'bg-teal-50 text-teal-600', bar: 'from-teal-400 to-teal-600' },
  { tile: 'bg-amber-50 text-amber-600', bar: 'from-amber-400 to-amber-600' },
  { tile: 'bg-sky-50 text-sky-600', bar: 'from-sky-400 to-sky-600' },
  { tile: 'bg-rose-50 text-rose-600', bar: 'from-rose-400 to-rose-600' },
];

const MUTED = { tile: 'bg-surface-100 text-gray-400', bar: 'from-surface-300 to-surface-300' };

/** Stable per-name accent, so a partner keeps the same colour across renders,
 *  sorts and filters. Deactivated partners always go grey. */
export function agencyAccent(name, isActive = true) {
  if (!isActive) return MUTED;
  let hash = 0;
  for (let i = 0; i < (name?.length ?? 0); i++) hash = (hash * 31 + name.charCodeAt(i)) % 9973;
  return ACCENTS[hash % ACCENTS.length];
}

export function agencyInitials(name) {
  return (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}
