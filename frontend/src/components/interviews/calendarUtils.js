import { parseISO, addMinutes, differenceInMinutes, startOfDay } from 'date-fns';
import { Video, Phone, MapPin, Users, Calendar } from 'lucide-react';

/* Visual language shared by every interview surface — month chips, week blocks,
   agenda cards and the detail drawer all read status from here so a "cancelled"
   interview looks the same wherever it appears. */
export const STATUS_STYLES = {
  scheduled: {
    label: 'Scheduled',
    dot:   'bg-brand-500',
    bar:   'bg-brand-500',
    block: 'bg-brand-50 border-brand-200 text-brand-900 hover:bg-brand-100',
    chip:  'bg-brand-50 text-brand-700 border-brand-100 hover:bg-brand-100',
    badge: 'bg-brand-50 text-brand-700',
  },
  rescheduled: {
    label: 'Rescheduled',
    dot:   'bg-amber-500',
    bar:   'bg-amber-500',
    block: 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100',
    chip:  'bg-amber-50 text-amber-800 border-amber-100 hover:bg-amber-100',
    badge: 'bg-amber-50 text-amber-700',
  },
  completed: {
    label: 'Completed',
    dot:   'bg-emerald-500',
    bar:   'bg-emerald-500',
    block: 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100',
    chip:  'bg-emerald-50 text-emerald-800 border-emerald-100 hover:bg-emerald-100',
    badge: 'bg-emerald-50 text-emerald-700',
  },
  cancelled: {
    label: 'Cancelled',
    dot:   'bg-gray-400',
    bar:   'bg-gray-400',
    block: 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 line-through decoration-gray-400',
    chip:  'bg-gray-50 text-gray-500 border-gray-200 line-through decoration-gray-300 hover:bg-gray-100',
    badge: 'bg-gray-100 text-gray-600',
  },
  no_show: {
    label: 'No show',
    dot:   'bg-rose-500',
    bar:   'bg-rose-500',
    block: 'bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100',
    chip:  'bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100',
    badge: 'bg-rose-50 text-rose-700',
  },
};

export const statusStyle = (status) => STATUS_STYLES[status] ?? STATUS_STYLES.scheduled;

export const TYPE_ICONS = {
  video:     Video,
  phone:     Phone,
  onsite:    MapPin,
  technical: Users,
  hr:        Users,
  panel:     Users,
};

export const typeIcon = (type) => TYPE_ICONS[type] ?? Calendar;

export const ACTIVE_STATUSES = ['scheduled', 'rescheduled'];
export const isActive = (interview) => ACTIVE_STATUSES.includes(interview.status);

/** Start/end instants for an interview, defaulting to a 60-minute block. */
export function interviewRange(interview) {
  const start = parseISO(interview.scheduled_at);
  return { start, end: addMinutes(start, interview.duration_mins || 60) };
}

/** Minutes from midnight — the vertical coordinate system of the week grid. */
export const minutesIntoDay = (date) => differenceInMinutes(date, startOfDay(date));

/**
 * Side-by-side placement for interviews that overlap in time.
 *
 * Events are swept in start order and collected into clusters of mutually
 * overlapping blocks; every event in a cluster is given a column index and the
 * cluster's total column count, which the week grid turns into a width and a
 * left offset. Columns are reused as soon as an earlier event has ended, so
 * three back-to-back interviews stay full width while two genuinely concurrent
 * ones split the day in half.
 */
export function layoutOverlaps(events) {
  const sorted = events
    .map((event) => ({ event, ...interviewRange(event) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const placed = [];
  let cluster = [];
  let clusterEnd = null;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const columnEnds = [];
    cluster.forEach((item) => {
      const free = columnEnds.findIndex((end) => end <= item.start);
      if (free === -1) {
        item.column = columnEnds.length;
        columnEnds.push(item.end);
      } else {
        item.column = free;
        columnEnds[free] = item.end;
      }
    });
    cluster.forEach((item) => placed.push({ ...item, columnCount: columnEnds.length }));
    cluster = [];
    clusterEnd = null;
  };

  sorted.forEach((item) => {
    if (clusterEnd !== null && item.start >= clusterEnd) flushCluster();
    cluster.push(item);
    clusterEnd = clusterEnd === null ? item.end : new Date(Math.max(clusterEnd, item.end));
  });
  flushCluster();

  return placed;
}

/** Bucket interviews by local calendar day (`yyyy-MM-dd`) for grid lookup. */
export function groupByDayKey(interviews) {
  const map = new Map();
  interviews.forEach((interview) => {
    const key = dayKey(parseISO(interview.scheduled_at));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(interview);
  });
  map.forEach((list) => list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
  return map;
}

/** Local-time day key. Avoids toISOString(), which would shift days for
    anyone east or west of UTC and drop interviews into the wrong cell. */
export function dayKey(date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
