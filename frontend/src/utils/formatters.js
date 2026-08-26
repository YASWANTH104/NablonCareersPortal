import { format, formatDistanceToNow, parseISO } from 'date-fns';

export function formatDate(date, fmt = 'MMM d, yyyy') {
  if (!date) return '—';
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, fmt);
}

export function formatRelativeTime(date) {
  if (!date) return '—';
  const d = typeof date === 'string' ? parseISO(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatCurrency(amount, currency = 'INR') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatSalaryRange(min, max, currency = 'INR', show = true) {
  if (!show || (!min && !max)) return 'Not disclosed';
  if (min && max) return `${formatCurrency(min, currency)} – ${formatCurrency(max, currency)}`;
  if (min) return `From ${formatCurrency(min, currency)}`;
  return `Up to ${formatCurrency(max, currency)}`;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// datetime-local inputs read/write a bare "wall clock" string with no timezone,
// so round-tripping through new Date(...).toISOString() silently swaps in the
// browser's own zone (or UTC). These pin the round-trip to IST regardless of
// the browser's zone, matching the backend's Asia/Kolkata conversion.
export function utcToISTInputValue(utcDateStr) {
  if (!utcDateStr) return '';
  const istMs = new Date(utcDateStr).getTime() + IST_OFFSET_MS;
  return new Date(istMs).toISOString().slice(0, 16);
}

export function istInputValueToUTCISOString(localValue) {
  const istMs = new Date(`${localValue}:00Z`).getTime();
  return new Date(istMs - IST_OFFSET_MS).toISOString();
}

// date-fns (format/isSameDay/parseISO consumers, etc.) reads a Date's *local*
// getters, which reflect the viewer's own OS/browser timezone, not IST. Every
// interview/slot time is stored and transmitted as UTC, so any component that
// calls format()/isSameDay() directly on it renders correctly only by
// coincidence, when the viewer's machine happens to be set to IST. toIST()
// shifts the instant so those local getters read as IST wall-clock instead —
// pass its result wherever scheduled_at/start_time is displayed or bucketed
// by day, everywhere, regardless of the viewer's own system timezone.
export function toIST(date) {
  if (date == null) return null;
  const d = typeof date === 'string' ? parseISO(date) : (date instanceof Date ? date : new Date(date));
  if (Number.isNaN(d.getTime())) return null;

  // Read the IST wall-clock fields off the instant, then build a local Date
  // carrying exactly those fields — so getHours()/getDate() return IST values.
  //
  // This used to shift by IST_OFFSET_MS and then correct by
  // new Date(istMs).getTimezoneOffset(). That samples the viewer's UTC offset
  // at a *different* instant from the one it then applies it to (they differ by
  // the offset itself, 5-10 hours), so any time within that window of the
  // viewer's own DST transition came out an hour wrong. A viewer in New York
  // saw 2026-10-31T23:00Z as 03:30 instead of 04:30 IST. Building from fields
  // has no such window: the engine resolves the local offset for the exact
  // wall-clock time being constructed.
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  const out = new Date(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    shifted.getUTCSeconds(),
    shifted.getUTCMilliseconds(),
  );
  // new Date(yy, ...) maps 0-99 onto 1900-1999; irrelevant for real data but
  // cheap to be exact about.
  out.setFullYear(shifted.getUTCFullYear());
  return out;
}

export function formatIST(date, fmt = 'h:mm a') {
  const d = toIST(date);
  return d ? format(d, fmt) : '—';
}

// yyyy-MM-dd / HH:mm read off a real instant's IST wall clock — for feeding
// <input type="date"/"time"> controls that must show/collect IST regardless
// of the viewer's own system timezone (companion to utcToISTInputValue above,
// which does the same for a single combined datetime-local input).
export function istDateKey(date) {
  const d = toIST(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function istTimeKey(date) {
  const d = toIST(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Inverse of istDateKey/istTimeKey: given a yyyy-MM-dd and an HH:mm that
// together represent an IST wall-clock moment, return the real UTC instant.
// Inverse of toIST(): takes a Date that carries IST wall-clock fields in the
// viewer's local space and returns the real UTC instant it stands for. Needed
// wherever an IST-space Date has to leave the browser — a range boundary sent
// to the API, say — because .toISOString() on an IST-space Date is off by the
// viewer's own UTC offset.
export function istToInstant(d) {
  if (d == null) return null;
  const p2 = (n) => String(n).padStart(2, '0');
  return fromISTDateTime(
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    `${p2(d.getHours())}:${p2(d.getMinutes())}`,
  );
}

export function fromISTDateTime(dateStr, timeStr) {
  return new Date(istInputValueToUTCISOString(`${dateStr}T${timeStr}`));
}

export function titleCase(str) {
  if (!str) return '';
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
