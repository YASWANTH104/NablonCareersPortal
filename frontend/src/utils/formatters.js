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
  const istMs = d.getTime() + IST_OFFSET_MS;
  const tzOffsetMin = new Date(istMs).getTimezoneOffset();
  return new Date(istMs + tzOffsetMin * 60000);
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
export function fromISTDateTime(dateStr, timeStr) {
  return new Date(istInputValueToUTCISOString(`${dateStr}T${timeStr}`));
}

export function titleCase(str) {
  if (!str) return '';
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
