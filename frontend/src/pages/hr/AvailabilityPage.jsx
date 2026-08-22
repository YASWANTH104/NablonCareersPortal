import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  startOfWeek, addDays, addWeeks, subWeeks, addMonths, subMonths, format, isSameDay,
  startOfMonth, eachDayOfInterval, isSameMonth, isWeekend,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, ChevronDown, X, Loader2, Search, CalendarClock, Copy,
  Maximize2, Minimize2, BellRing, Trash2, Repeat, Users, User, CalendarCheck, Send,
  CalendarDays, CalendarRange, LayoutGrid, MousePointerClick, Eraser, MoveVertical,
  Check, RotateCcw, Clock, CalendarX, Hourglass, Sparkles, ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { interviewSlotsApi } from '@/api/interviewSlots';
import { applicationsApi } from '@/api/applications';
import { usersApi } from '@/api/users';
import { useAuthStore } from '@/store/authStore';
import { HR_ROLES } from '@/utils/permissions';
import { ROUND_TYPES, ROUND_MAP } from '@/constants/interviewRounds';
import { toIST, fromISTDateTime, istDateKey, istTimeKey } from '@/utils/formatters';
import { Modal, Segmented, StatTile, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';

const SLOT_MINUTES = 30;
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 20; // exclusive — 8am–8pm default window
const FULL_START_HOUR = 0;
const FULL_END_HOUR = 24; // exclusive

// Interviewers no longer choose a duration when publishing — raw availability
// is always in fixed 60-min blocks. HR later assigns a job+round without
// touching duration.
const PUBLISH_DURATION_MINS = 60;

// Grid row height in px — used both for the CSS grid template and for
// pixel-positioning the current-time indicator line, so the two never drift
// out of sync with each other. Sized for Teams/Google-Calendar-style event
// chips (roomy enough to read a label + time range inside a 30-min block),
// not a cramped spreadsheet grid.
const ROW_PX = 40;
const HEADER_PX = 62; // day-header row — tall enough for weekday + date + count
const GUTTER_PX = 62; // time-of-day ruler column
const MIN_COL_PX = 108; // narrowest a day column gets before the grid scrolls
// Drag-to-resize is capped at 60 min (2 rows) — matches the backend's
// SlotRescheduleRequest, which only accepts {30, 60} so a resized slot stays
// bookable by the agency self-book path (it only ever queries those two).
const RESIZE_MAX_SPAN = Math.round(60 / SLOT_MINUTES);

// ── IST grid space ────────────────────────────────────────────────────────────
//
// Slot instants are stored and transmitted as UTC. date-fns reads a Date's
// *local* getters, so laying the calendar out straight off `new Date(start_time)`
// only renders correct hours when the viewer's own machine happens to be set to
// IST — and disagreed with every other scheduling surface in the app
// (InterviewsPage, ApplicationDetailPage, WeekCalendar all already go through
// toIST). Everything inside this page therefore works in one consistent
// "IST wall-clock" space: `gridTime` converts an instant in, `gridToInstant`
// converts a grid Date back out, and nothing else touches raw start_time.
const pad2 = (n) => String(n).padStart(2, '0');
const gridTime = (instant) => toIST(instant);
const gridNow = () => toIST(new Date());
function gridToInstant(d) {
  return fromISTDateTime(
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

// Distinct-per-round colors for the grid only (kept local, not touching the
// shared ROUND_MAP badge colors used elsewhere — tr1/tr2 share one color
// there, but a calendar you're scanning benefits from telling them apart at a
// glance). "Booked" always wins and stays emerald regardless of round, so the
// existing open/booked mental model never breaks.
const GRID_ROUND_COLORS = {
  tr1: { bg: 'bg-sky-50', bar: 'bg-sky-400', hover: 'hover:bg-sky-100', text: 'text-sky-900', dot: 'bg-sky-400', swatch: 'bg-sky-200' },
  tr2: { bg: 'bg-teal-50', bar: 'bg-teal-400', hover: 'hover:bg-teal-100', text: 'text-teal-900', dot: 'bg-teal-400', swatch: 'bg-teal-200' },
  hr: { bg: 'bg-violet-50', bar: 'bg-violet-400', hover: 'hover:bg-violet-100', text: 'text-violet-900', dot: 'bg-violet-400', swatch: 'bg-violet-200' },
};
const DEFAULT_GRID_COLOR = { bg: 'bg-brand-50', bar: 'bg-brand-400', hover: 'hover:bg-brand-100', text: 'text-brand-900', dot: 'bg-brand-400', swatch: 'bg-brand-200' };
// Raw, interviewer-published availability with no job/round attached yet —
// deliberately neutral (not one of the round colors, not booked-green) so it
// reads as "needs attention" rather than "ready to book". Only ever shown to
// HR (job/round is their concept, not the interviewer's).
const UNASSIGNED_COLOR = { bg: 'bg-slate-100', bar: 'bg-slate-400', hover: 'hover:bg-slate-200', text: 'text-slate-700', dot: 'bg-slate-400', swatch: 'bg-slate-300' };
// What an interviewer sees on their OWN calendar for any not-yet-booked slot,
// whether or not HR has quietly attached a job/round behind the scenes — an
// interviewer never needs to know "Technical Round 1" until it's a real,
// booked interview; showing that label on a slot HR might still reassign or
// an agency might never book is confusing, not informative. One calm color,
// one word: "Available". The round-by-round breakdown stays exclusive to
// HR's own management views, where it's an actual decision they're making.
const AVAILABLE_COLOR = { bg: 'bg-brand-50', bar: 'bg-brand-500', hover: 'hover:bg-brand-100', text: 'text-brand-900', dot: 'bg-brand-500', swatch: 'bg-brand-200' };
const BOOKED_COLOR = { bg: 'bg-emerald-50', bar: 'bg-emerald-500', hover: 'hover:bg-emerald-100', text: 'text-emerald-900', dot: 'bg-emerald-500', swatch: 'bg-emerald-200' };

function timeSlotsForDay(day, startHour, rows) {
  return Array.from({ length: rows }, (_, i) => {
    const d = new Date(day);
    d.setHours(startHour, i * SLOT_MINUTES, 0, 0);
    return d;
  });
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

// ── Small shared bits ─────────────────────────────────────────────────────────

function Avatar({ name, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold shrink-0',
        'w-7 h-7 text-[11px]',
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

function IconButton({ icon: Icon, label, onClick, disabled, active, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'w-8 h-8 inline-flex items-center justify-center rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        active
          ? 'border-brand-300 bg-brand-50 text-brand-600'
          : 'border-surface-200 bg-white text-gray-500 hover:bg-surface-50 hover:text-gray-700',
        className
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function Hint({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      {children}
    </span>
  );
}

function useClickOutside(onOutside, enabled) {
  const ref = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    }
    function onKey(e) {
      if (e.key === 'Escape') onOutside();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onOutside, enabled]);
  return ref;
}

// A searchable person picker — a bare <select> of every interviewer on the
// panel is unusable past a dozen people, and gave no hint of who you were
// looking at once chosen.
function InterviewerPicker({ value, onChange, people, allLabel, placeholder }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useClickOutside(() => setOpen(false), open);

  const selected = people?.find((p) => p.id === value);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people ?? [];
    return (people ?? []).filter(
      (p) => p.full_name?.toLowerCase().includes(needle) || p.email?.toLowerCase().includes(needle)
    );
  }, [people, q]);

  function pick(id) {
    onChange(id);
    setOpen(false);
    setQ('');
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full sm:w-[248px] flex items-center gap-2.5 px-2.5 py-2 rounded-xl border bg-white text-left transition-colors',
          open ? 'border-brand-400 ring-2 ring-brand-100' : 'border-surface-200 hover:border-surface-300'
        )}
      >
        {selected ? (
          <Avatar name={selected.full_name} />
        ) : (
          <span className="w-7 h-7 rounded-full bg-surface-100 text-gray-400 inline-flex items-center justify-center shrink-0">
            <Users className="w-3.5 h-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-gray-800 truncate">
            {selected ? selected.full_name : allLabel ?? placeholder}
          </span>
          <span className="block text-[11px] text-gray-400 truncate">
            {selected ? selected.email : 'Interview panel'}
          </span>
        </span>
        <ChevronDown className={cn('w-4 h-4 text-gray-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1.5 w-full sm:w-[300px] bg-white rounded-xl border border-surface-200 shadow-modal overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="p-2 border-b border-surface-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search the panel…"
                className="w-full pl-8 pr-2 py-1.5 text-sm bg-surface-50 border border-transparent rounded-lg focus:outline-none focus:bg-white focus:border-brand-300"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {allLabel && (
              <button
                type="button"
                onClick={() => pick('')}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-surface-50',
                  !value && 'bg-brand-50'
                )}
              >
                <span className="w-7 h-7 rounded-full bg-surface-100 text-gray-400 inline-flex items-center justify-center">
                  <Users className="w-3.5 h-3.5" />
                </span>
                <span className="text-sm font-medium text-gray-700 flex-1">{allLabel}</span>
                {!value && <Check className="w-4 h-4 text-brand-500" />}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No one matches “{q}”</p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-surface-50',
                    p.id === value && 'bg-brand-50'
                  )}
                >
                  <Avatar name={p.full_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-800 truncate">{p.full_name}</span>
                    <span className="block text-[11px] text-gray-400 truncate">{p.email}</span>
                  </span>
                  {p.id === value && <Check className="w-4 h-4 text-brand-500 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Application picker (HR booking a slot) ────────────────────────────────────

function ApplicationPickerModal({ jobId, slot, onCancel, onPick, isPending }) {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['availability-job-applications', jobId, search],
    queryFn: () =>
      applicationsApi.list({ job_id: jobId, search: search || undefined, limit: 50 }).then((r) => r.data),
  });
  const applications = data?.items ?? [];
  const start = slot ? gridTime(slot.start_time) : null;

  return (
    <Modal
      onClose={onCancel}
      title="Who is this interview for?"
      description={
        start
          ? `${format(start, 'EEE, MMM d')} · ${format(start, 'h:mm a')} IST · ${slot.duration_mins} min`
          : 'Pick the candidate to book into this slot.'
      }
      icon={CalendarCheck}
      size="md"
    >
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search candidates in this job…"
          className="w-full pl-9 pr-3 py-2.5 border border-surface-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <div className="max-h-72 overflow-y-auto -mx-1 px-1">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : applications.length === 0 ? (
          <EmptyState
            compact
            icon={Users}
            title={search ? 'No matching candidates' : 'No candidates in this pipeline yet'}
            description={
              search
                ? 'Try a different name or email.'
                : 'Once someone applies to this job they will show up here, ready to book.'
            }
          />
        ) : (
          <div className="space-y-1">
            {applications.map((app) => (
              <button
                key={app.id}
                disabled={isPending}
                onClick={() => onPick(app.id)}
                className="w-full flex items-center gap-3 text-left px-2.5 py-2 rounded-xl border border-transparent hover:border-brand-200 hover:bg-brand-50/50 disabled:opacity-50 transition-colors group"
              >
                <Avatar name={app.applicant?.full_name} className="w-8 h-8 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900 truncate">
                    {app.applicant?.full_name ?? 'Unknown'}
                  </span>
                  <span className="block text-xs text-gray-400 truncate">{app.applicant?.email}</span>
                </span>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-brand-500 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Assign-to-job modal (HR turning raw availability into a bookable slot) ────

// Step 1 of HR booking a still-unassigned slot directly for an internal
// candidate (the "Book for an interviewer" tab) — this is NOT the "publish
// for agencies" flow. It only needs a job/round because the candidate picker
// and the interview record both require one; picking one here never touches
// the slot's job_id/round_type until a candidate is actually chosen and
// book_unassigned_slot claims everything atomically (see the backend
// docstring) — so this slot never becomes visible to agencies as a side
// effect of HR just browsing candidates.
function PickJobRoundForBookingModal({ slot, jobsData, onCancel, onContinue }) {
  const [jobId, setJobId] = useState('');
  const [roundType, setRoundType] = useState('tr1');
  const start = gridTime(slot.start_time);

  return (
    <Modal
      onClose={onCancel}
      title="Book this slot"
      description={`${format(start, 'EEE, MMM d')} · ${format(start, 'h:mm a')} IST · ${slot.duration_mins} min`}
      icon={CalendarCheck}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            disabled={!jobId}
            onClick={() => onContinue({ job_id: jobId, round_type: roundType })}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Choose candidate <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      }
    >
      <p className="text-sm text-gray-500 mb-4">
        Which job and round is this interview for? You’ll pick the candidate next — nothing is published to
        agencies along the way.
      </p>
      <div className="space-y-3.5">
        <label className="block">
          <span className="block text-xs font-semibold text-gray-600 mb-1.5">Job</span>
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Select a job…</option>
            {jobsData?.map((job) => (
              <option key={job.id} value={job.id}>{job.title}</option>
            ))}
          </select>
        </label>
        <div>
          <span className="block text-xs font-semibold text-gray-600 mb-1.5">Round</span>
          <div className="grid grid-cols-3 gap-1.5">
            {ROUND_TYPES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRoundType(r.key)}
                className={cn(
                  'px-2 py-2 rounded-lg border text-xs font-medium transition-colors',
                  roundType === r.key
                    ? 'border-brand-400 bg-brand-50 text-brand-700'
                    : 'border-surface-200 bg-white text-gray-600 hover:bg-surface-50'
                )}
              >
                {r.label.replace('Technical Round', 'TR')}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Publish-to-agencies panel (pick a job, tick several slots, publish) ───────
//
// The calendar grid is great for browsing a week, but picking a job once and
// then hand-clicking each slot one at a time to publish it is exactly the
// kind of repetitive flow the drag-to-paint work earlier was meant to kill —
// this is that same fix applied to the "assign" side instead of "create".
// A flat, chronological, checkbox list of every still-unassigned open slot
// (not paged week-by-week like the grid) is what actually lets HR select
// across an interviewer's whole upcoming availability in one pass.

function PublishSlotsPanel({
  slots, jobsData, onPublish, isPending, onUnassign, unassigningId, isLoading,
}) {
  const [jobId, setJobId] = useState('');
  const [roundType, setRoundType] = useState('tr1');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const available = useMemo(() => {
    const now = new Date();
    return (slots ?? [])
      .filter((s) => s.status === 'open' && !s.job_id && new Date(s.start_time) >= now)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }, [slots]);

  // Already published for a job but no agency has booked it yet — shown
  // separately so HR can tell "still needs a job" apart from "waiting on a
  // booking", and can free one back up (reuse) if it's gone stale.
  const awaitingBooking = useMemo(() => {
    const now = new Date();
    return (slots ?? [])
      .filter((s) => s.status === 'open' && !!s.job_id && new Date(s.start_time) >= now)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }, [slots]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const s of available) {
      const key = format(gridTime(s.start_time), 'EEEE, MMM d');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return map;
  }, [available]);

  // A selection made before a poll refetch can contain slots that have since
  // been booked elsewhere — only ever publish what is still on screen.
  const selectedVisible = useMemo(
    () => available.filter((s) => selectedIds.has(s.id)),
    [available, selectedIds]
  );

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleMany(ids, on) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  const allSelected = available.length > 0 && available.every((s) => selectedIds.has(s.id));
  const selectedJob = jobsData?.find((j) => String(j.id) === String(jobId));

  async function handlePublish() {
    const ok = await onPublish({
      slot_ids: selectedVisible.map((s) => s.id),
      job_id: jobId,
      round_type: roundType,
    });
    if (ok) setSelectedIds(new Set());
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-surface-200 flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
      {/* ── Selection list ── */}
      <div className="bg-white rounded-2xl border border-surface-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-200">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-gray-900 text-sm">Needs a job</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Raw availability interviewers have opened up, not yet visible to any agency.
            </p>
          </div>
          {available.length > 0 && (
            <button
              type="button"
              onClick={() => toggleMany(available.map((s) => s.id), !allSelected)}
              className="shrink-0 text-xs font-semibold text-brand-600 hover:text-brand-700 whitespace-nowrap"
            >
              {allSelected ? 'Clear all' : `Select all ${available.length}`}
            </button>
          )}
        </div>

        {available.length === 0 ? (
          <EmptyState
            icon={awaitingBooking.length > 0 ? Check : CalendarX}
            title={awaitingBooking.length > 0 ? 'All caught up' : 'No unpublished availability'}
            description={
              awaitingBooking.length > 0
                ? 'Every open slot already has a job attached. Anything waiting on a booking is listed on the right.'
                : 'Once an interviewer marks time as free it lands here, ready for you to attach a job and round.'
            }
          />
        ) : (
          <div className="max-h-[30rem] overflow-y-auto">
            {Array.from(groups.entries()).map(([day, daySlots]) => {
              const dayIds = daySlots.map((s) => s.id);
              const dayAllSelected = dayIds.every((id) => selectedIds.has(id));
              return (
                <div key={day}>
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface-50/95 backdrop-blur-sm px-4 py-1.5 border-y border-surface-100">
                    <span className="text-xs font-semibold text-gray-600">{day}</span>
                    <button
                      type="button"
                      onClick={() => toggleMany(dayIds, !dayAllSelected)}
                      className="text-[11px] font-medium text-gray-400 hover:text-brand-600"
                    >
                      {dayAllSelected ? 'Deselect day' : 'Select day'}
                    </button>
                  </div>
                  {daySlots.map((s) => {
                    const st = gridTime(s.start_time);
                    const en = new Date(st.getTime() + s.duration_mins * 60000);
                    const checked = selectedIds.has(s.id);
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-surface-100 last:border-0 transition-colors',
                          checked ? 'bg-brand-50/60' : 'hover:bg-surface-50'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(s.id)}
                          className="w-4 h-4 rounded border-surface-300 text-brand-500 focus:ring-brand-500"
                        />
                        <span className="text-sm font-medium text-gray-800 tabular-nums w-[9.5rem] shrink-0">
                          {format(st, 'h:mm a')} – {format(en, 'h:mm a')}
                        </span>
                        <span className="text-xs text-gray-400 shrink-0">{s.duration_mins} min</span>
                        {s.interviewer_name && (
                          <span className="ml-auto flex items-center gap-1.5 min-w-0">
                            <Avatar name={s.interviewer_name} className="w-5 h-5 text-[9px]" />
                            <span className="text-xs text-gray-500 truncate">{s.interviewer_name}</span>
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Publish action card ── */}
      <div className="space-y-4 lg:sticky lg:top-0">
        <div className="bg-white rounded-2xl border border-surface-200 p-4">
          <h3 className="font-display font-semibold text-gray-900 text-sm flex items-center gap-1.5">
            <Send className="w-4 h-4 text-brand-500" /> Publish to agencies
          </h3>
          <p className="text-xs text-gray-500 mt-1 mb-4">
            Attaching a job and round makes these times bookable by that job’s recruitment partners.
          </p>

          <div className="space-y-3.5">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1.5">Job</span>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">Select a job…</option>
                {jobsData?.map((job) => (
                  <option key={job.id} value={job.id}>{job.title}</option>
                ))}
              </select>
            </label>
            <div>
              <span className="block text-xs font-semibold text-gray-600 mb-1.5">Round</span>
              <div className="grid grid-cols-3 gap-1.5">
                {ROUND_TYPES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setRoundType(r.key)}
                    className={cn(
                      'px-2 py-2 rounded-lg border text-xs font-medium transition-colors',
                      roundType === r.key
                        ? 'border-brand-400 bg-brand-50 text-brand-700'
                        : 'border-surface-200 bg-white text-gray-600 hover:bg-surface-50'
                    )}
                  >
                    {r.label.replace('Technical Round', 'TR')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-surface-100">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-xs text-gray-500">Selected</span>
              <span className="font-display text-lg font-bold text-gray-900">
                {selectedVisible.length}
                <span className="text-xs font-medium text-gray-400"> / {available.length}</span>
              </span>
            </div>
            <button
              disabled={!jobId || selectedVisible.length === 0 || isPending}
              onClick={handlePublish}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-brand-500 text-white rounded-xl hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Publishing…</>
              ) : (
                <><Send className="w-4 h-4" /> Publish {selectedVisible.length || ''} slot{selectedVisible.length === 1 ? '' : 's'}</>
              )}
            </button>
            {!jobId && selectedVisible.length > 0 && (
              <p className="text-[11px] text-amber-600 mt-2 text-center">Pick a job to publish these into.</p>
            )}
            {selectedJob && selectedVisible.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-2 text-center leading-relaxed">
                {selectedVisible.length} slot{selectedVisible.length === 1 ? '' : 's'} → {selectedJob.title} ·{' '}
                {ROUND_MAP[roundType]?.label}
              </p>
            )}
          </div>
        </div>

        {/* Awaiting a booking */}
        <div className="bg-white rounded-2xl border border-surface-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-200">
            <h3 className="font-display font-semibold text-gray-900 text-sm flex items-center gap-1.5">
              <Hourglass className="w-4 h-4 text-amber-500" /> Awaiting a booking
              {awaitingBooking.length > 0 && (
                <span className="ml-auto text-xs font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                  {awaitingBooking.length}
                </span>
              )}
            </h3>
          </div>
          {awaitingBooking.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-7 px-4">
              Nothing published is sitting idle right now.
            </p>
          ) : (
            <div className="max-h-[18rem] overflow-y-auto divide-y divide-surface-100">
              {awaitingBooking.map((s) => {
                const st = gridTime(s.start_time);
                return (
                  <div key={s.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-800 tabular-nums">
                        {format(st, 'EEE, MMM d · h:mm a')}
                      </span>
                      <button
                        type="button"
                        disabled={unassigningId === s.id}
                        onClick={() => onUnassign(s)}
                        title="No agency has booked this — free it up to publish for a different job"
                        className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-brand-600 disabled:opacity-60"
                      >
                        {unassigningId === s.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        {unassigningId === s.id ? 'Freeing…' : 'Free up'}
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[11px] font-medium text-brand-700 bg-brand-50 rounded-full px-2 py-0.5 max-w-full truncate">
                        {s.job_title ?? 'Job'} · {ROUND_MAP[s.round_type]?.label ?? s.round_type}
                      </span>
                      {s.interviewer_name && (
                        <span className="text-[11px] text-gray-400 truncate">{s.interviewer_name}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Week grid ──────────────────────────────────────────────────────────────────

// Slots can span more than one 30-min row (30 or 60 min), so placement is
// explicit (gridRow/gridColumn) rather than relying on DOM-order auto-flow —
// a spanning block occupies its start row plus N-1 "covered" rows that render
// nothing, and every other row still gets its own clickable empty cell.
function buildDayLayout(day, slots, startHour, rows) {
  const startRowMap = new Map(); // rowIdx -> { slot, span }
  const covered = new Set();

  (slots ?? [])
    .filter((s) => isSameDay(gridTime(s.start_time), day))
    .forEach((s) => {
      const st = gridTime(s.start_time);
      const minutesFromStart = (st.getHours() - startHour) * 60 + st.getMinutes();
      const rowIdx = Math.round(minutesFromStart / SLOT_MINUTES);
      const span = Math.max(1, Math.round(s.duration_mins / SLOT_MINUTES));
      if (rowIdx < 0 || rowIdx >= rows) return; // outside the visible window
      startRowMap.set(rowIdx, { slot: s, span });
      for (let r = rowIdx; r < rowIdx + span && r < rows; r++) covered.add(r);
    });

  return { startRowMap, covered };
}

// Given a drag spanning [loRow, hiRow] inclusive on `day`, split it into
// contiguous, non-overlapping slot start-times of `durationMins` each,
// skipping any step whose rows are already occupied. This is what turns a
// single mouse drag into a real batch — one publish call for the whole
// dragged range instead of one call per 30-min cell.
function computeDragStartTimes(day, loRow, hiRow, durationMins, covered, startHour) {
  const stepRows = Math.max(1, Math.round(durationMins / SLOT_MINUTES));
  const times = [];

  // A plain click (or any drag shorter than one full duration step) still
  // means "give me one slot starting here" — matches the old single-click
  // behavior instead of silently doing nothing when e.g. duration=60min but
  // only one 30-min cell was clicked.
  if (hiRow - loRow + 1 < stepRows) {
    const d = new Date(day);
    d.setHours(startHour, loRow * SLOT_MINUTES, 0, 0);
    return [d];
  }

  for (let r = loRow; r + stepRows - 1 <= hiRow; r += stepRows) {
    let free = true;
    for (let k = 0; k < stepRows; k++) {
      if (covered.has(r + k)) { free = false; break; }
    }
    if (!free) continue;
    const d = new Date(day);
    d.setHours(startHour, r * SLOT_MINUTES, 0, 0);
    times.push(d);
  }
  return times;
}

function WeekGrid({
  days, slots, editable, startHour, rows, nowTick, showFullDay,
  onPublishRange, onSlotClick, onRemoveRange, onCopyDay, copyingDay, onResizeSlot,
}) {
  const now = gridNow();
  const scrollRef = useRef(null);

  // Drag state: which day column, the row range touched so far, and which of
  // three things this drag is doing — painting new slots ('create'), sweeping
  // open slots for bulk removal ('remove'), or dragging a single open slot's
  // bottom edge to change its duration ('resize') — decided by what the mouse
  // went down on.
  const [drag, setDrag] = useState(null); // { dayIndex, startRow, endRow, mode, ... }
  const draggingRef = useRef(null);
  draggingRef.current = drag;

  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      const d = draggingRef.current;
      draggingRef.current = null;
      setDrag(null);
      if (!d) return;
      if (d.mode === 'create') {
        const lo = Math.min(d.startRow, d.endRow);
        const hi = Math.max(d.startRow, d.endRow);
        onPublishRange(days[d.dayIndex], lo, hi);
      } else if (d.mode === 'resize') {
        const span = d.previewSpan ?? d.originalSpan;
        if (span * SLOT_MINUTES !== d.originalDuration) onResizeSlot(d.slotId, span * SLOT_MINUTES);
      } else if (d.removedIds.size > 0) onRemoveRange(d.removedIds);
      // A 'remove'-mode drag that never left its starting cell (removedIds
      // stays empty — see startRemoveDrag) removes nothing, which is what
      // lets a plain click fall through to onClick/onSlotClick below instead
      // of instantly deleting the slot.
    };
    window.addEventListener('mouseup', finish, { once: true });
    return () => window.removeEventListener('mouseup', finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  // Resize tracks the raw mouse Y position rather than which grid cell the
  // pointer happens to be over — a 60-min slot is a SINGLE DOM element
  // spanning both its rows, so it only ever fires one mouseenter no matter
  // where inside it the pointer moves, which made cell-based tracking unable
  // to register a shrink at all (and made a plain click on the handle
  // register as an instant, unintended shrink to the minimum). Registered
  // once for the component's lifetime — reading the live drag off the ref
  // avoids tearing the listener down and rebuilding it on every pixel of
  // movement.
  useEffect(() => {
    function handleMove(e) {
      const d = draggingRef.current;
      if (!d || d.mode !== 'resize') return;
      const deltaRows = Math.round((e.clientY - d.startClientY) / ROW_PX);
      const previewSpan = Math.min(RESIZE_MAX_SPAN, Math.max(1, d.originalSpan + deltaRows));
      if (previewSpan !== d.previewSpan) {
        draggingRef.current = { ...d, previewSpan };
        setDrag(draggingRef.current);
      }
    }
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  // Opening the full 24h view otherwise dumps you at midnight, several
  // screens above anything anyone actually publishes.
  useEffect(() => {
    if (!scrollRef.current) return;
    const target = showFullDay
      ? ((WORK_START_HOUR - startHour) * 60) / SLOT_MINUTES * ROW_PX
      : 0;
    scrollRef.current.scrollTop = target;
  }, [showFullDay, startHour]);

  function startCreateDrag(dayIndex, rowIdx) {
    if (!editable) return;
    setDrag({ dayIndex, startRow: rowIdx, endRow: rowIdx, mode: 'create' });
  }
  // Seeds an EMPTY removedIds set — the origin slot is only added once the
  // mouse actually moves to a different row (see enterCell), so a plain
  // click (mousedown+mouseup with no movement) removes nothing and is free
  // to be treated as a click that opens the detail popover instead.
  function startRemoveDrag(dayIndex, rowIdx, slotId) {
    if (!editable) return;
    setDrag({ dayIndex, startRow: rowIdx, endRow: rowIdx, mode: 'remove', removedIds: new Set(), originSlotId: slotId });
  }
  // originalSpan is the slot's CURRENT span (not always 1) — anchoring the
  // drag to that instead of assuming a fresh 1-row start is what makes a
  // plain click (zero mouse movement) a true no-op on an already-60-min slot.
  function startResizeDrag(dayIndex, rowIdx, slot, span, clientY) {
    if (!editable) return;
    setDrag({
      dayIndex, startRow: rowIdx, mode: 'resize', slotId: slot.id,
      originalDuration: slot.duration_mins, originalSpan: span,
      startClientY: clientY, previewSpan: span,
    });
  }
  function enterCell(dayIndex, rowIdx, coveredHere, slotAtRow) {
    setDrag((d) => {
      if (!d || d.dayIndex !== dayIndex || d.mode === 'resize') return d;
      const next = { ...d, endRow: rowIdx };
      if (d.mode === 'remove' && rowIdx !== d.startRow) {
        next.removedIds = new Set(d.removedIds);
        if (d.originSlotId) next.removedIds.add(d.originSlotId);
        if (slotAtRow && slotAtRow.status === 'open') next.removedIds.add(slotAtRow.id);
      }
      return next;
    });
  }

  const todayIdx = days.findIndex((d) => isSameDay(d, now));
  const nowRowFloat = ((now.getHours() - startHour) * 60 + now.getMinutes()) / SLOT_MINUTES;
  const showNowLine = todayIdx !== -1 && nowRowFloat >= 0 && nowRowFloat <= rows;
  void nowTick; // re-renders this component every tick so the line above stays live

  const hourCount = Math.ceil(rows / 2);

  return (
    <div
      ref={scrollRef}
      className="relative overflow-auto select-none rounded-xl border border-surface-200 bg-white"
      style={{ maxHeight: 'min(62vh, 40rem)' }}
    >
      <div
        className="grid relative"
        style={{
          gridTemplateColumns: `${GUTTER_PX}px repeat(${days.length}, minmax(${MIN_COL_PX}px, 1fr))`,
          gridTemplateRows: `${HEADER_PX}px repeat(${rows}, ${ROW_PX}px)`,
        }}
      >
        {/* Column washes — today and weekends, behind everything else */}
        {days.map((day, di) => {
          const tint = isSameDay(day, now)
            ? 'bg-brand-50/50'
            : isWeekend(day)
            ? 'bg-surface-50/80'
            : null;
          if (!tint) return null;
          return (
            <div
              key={`wash-${day.toISOString()}`}
              style={{ gridRow: `2 / span ${rows}`, gridColumn: di + 2 }}
              className={cn('pointer-events-none z-0', tint)}
            />
          );
        })}

        {/* Sticky corner */}
        <div
          style={{ gridRow: 1, gridColumn: 1 }}
          className="sticky top-0 left-0 z-[35] bg-white border-b border-r border-surface-200"
        />

        {/* Day headers */}
        {days.map((day, di) => {
          const { covered } = buildDayLayout(day, slots, startHour, rows);
          const daySlots = (slots ?? []).filter((s) => isSameDay(gridTime(s.start_time), day));
          const openCount = daySlots.filter((s) => s.status === 'open').length;
          const bookedCount = daySlots.filter((s) => s.status === 'booked').length;
          const today = isSameDay(day, now);
          return (
            <div
              key={`head-${day.toISOString()}`}
              style={{ gridRow: 1, gridColumn: di + 2 }}
              className={cn(
                'sticky top-0 z-30 flex flex-col items-center justify-center gap-0.5 px-1 border-b border-surface-200 group/head',
                today ? 'bg-brand-50' : 'bg-white'
              )}
            >
              <p className={cn('text-[10px] font-semibold uppercase tracking-wider', today ? 'text-brand-500' : 'text-gray-400')}>
                {format(day, 'EEE')}
              </p>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'font-display text-sm font-bold w-6 h-6 inline-flex items-center justify-center rounded-full',
                    today ? 'bg-brand-500 text-white' : 'text-gray-800'
                  )}
                >
                  {format(day, 'd')}
                </span>
                {editable && openCount > 0 && covered.size > 0 && (
                  <button
                    onClick={() => onCopyDay(day)}
                    disabled={copyingDay}
                    title="Copy this day's open slots to the same day next week"
                    aria-label="Copy this day to next week"
                    className="opacity-0 group-hover/head:opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-gray-400 hover:text-brand-600 disabled:opacity-40"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 h-3">
                {openCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand-600">
                    <span className={cn('w-1.5 h-1.5 rounded-full', AVAILABLE_COLOR.dot)} />
                    {openCount}
                  </span>
                )}
                {bookedCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600">
                    <span className={cn('w-1.5 h-1.5 rounded-full', BOOKED_COLOR.dot)} />
                    {bookedCount}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Hour ruler — one sticky cell per hour, spanning its two half-hour rows */}
        {Array.from({ length: hourCount }).map((_, h) => (
          <div
            key={`ruler-${h}`}
            style={{ gridRow: `${h * 2 + 2} / span 2`, gridColumn: 1 }}
            className="sticky left-0 z-[25] bg-white border-r border-surface-200 border-t border-surface-200 pr-2 pt-1 text-right"
          >
            <span className="text-[11px] font-medium text-gray-400 tabular-nums">
              {format(new Date(2000, 0, 1, startHour + h), 'h a')}
            </span>
          </div>
        ))}

        {/* Now indicator — pill in the ruler + line across today's column */}
        {showNowLine && (
          <>
            <div
              style={{ gridRow: `2 / span ${rows}`, gridColumn: 1 }}
              className="sticky left-0 z-[26] pointer-events-none"
            >
              <span
                className="absolute right-1 -translate-y-1/2 text-[10px] font-bold text-white bg-rose-500 rounded px-1 py-px tabular-nums"
                style={{ top: `${nowRowFloat * ROW_PX}px` }}
              >
                {format(now, 'h:mm')}
              </span>
            </div>
            <div
              style={{ gridRow: `2 / span ${rows}`, gridColumn: todayIdx + 2 }}
              className="relative pointer-events-none z-20"
            >
              <div className="absolute left-0 right-0 border-t-2 border-rose-500" style={{ top: `${nowRowFloat * ROW_PX}px` }}>
                <span className="absolute -left-1 -top-[5px] w-2 h-2 rounded-full bg-rose-500" />
              </div>
            </div>
          </>
        )}

        {drag?.mode === 'resize' && (
          <div
            style={{
              gridRow: `${drag.startRow + 2} / span ${drag.previewSpan ?? drag.originalSpan}`,
              gridColumn: drag.dayIndex + 2,
            }}
            className="m-[2px] rounded-lg ring-2 ring-brand-500 bg-brand-500/10 pointer-events-none z-10"
          />
        )}

        {days.map((day, di) => {
          const { startRowMap, covered } = buildDayLayout(day, slots, startHour, rows);
          const cellTimes = timeSlotsForDay(day, startHour, rows);
          const dragHere = drag && drag.dayIndex === di ? drag : null;
          const dragLo = dragHere ? Math.min(dragHere.startRow, dragHere.endRow) : null;
          const dragHi = dragHere ? Math.max(dragHere.startRow, dragHere.endRow) : null;

          return Array.from({ length: rows }, (_, rowIdx) => {
            const gridRow = rowIdx + 2;
            const gridColumn = di + 2;
            const isPast = cellTimes[rowIdx] < now;
            const inCreateDrag = dragHere?.mode === 'create' && rowIdx >= dragLo && rowIdx <= dragHi;
            const isHourLine = rowIdx % 2 === 0;

            if (startRowMap.has(rowIdx)) {
              const { slot, span } = startRowMap.get(rowIdx);
              const isBooked = slot.status === 'booked';
              const isUnassigned = !slot.job_id;
              // An interviewer's own calendar never shows the job/round
              // breakdown for a not-yet-booked slot — HR may still reassign
              // or an agency may never book it, so "Technical Round 1" would
              // just be a confusing, possibly-wrong preview. Only a real,
              // booked interview is worth surfacing round detail for.
              const color = isBooked
                ? BOOKED_COLOR
                : editable
                ? AVAILABLE_COLOR
                : isUnassigned ? UNASSIGNED_COLOR : (GRID_ROUND_COLORS[slot.round_type] ?? DEFAULT_GRID_COLOR);
              const inRemoveDrag = dragHere?.removedIds?.has(slot.id);
              const isResizingThis = dragHere?.mode === 'resize' && dragHere.slotId === slot.id;
              // Boxes are now big enough (ROW_PX=40) to always carry a label;
              // the time range only fits as a second line once the block is
              // at least an hour tall.
              const showTimeRange = span >= 2;
              const start = gridTime(slot.start_time);
              const slotEnd = new Date(start.getTime() + slot.duration_mins * 60000);
              // Every slot is clickable now (opens the detail popover) —
              // booked ones just can't be dragged (real interviews aren't
              // cancelled from this grid), so clicking them is read-only.
              const showResizeHandle = editable && !isBooked && !isPast;
              const label = isBooked
                ? (slot.candidate_name ?? 'Booked')
                : editable
                ? 'Available'
                : isUnassigned ? 'Needs a job' : (ROUND_MAP[slot.round_type]?.label ?? slot.round_type);
              return (
                <button
                  key={`slot-${slot.id}`}
                  disabled={isPast}
                  onMouseDown={(e) => {
                    if (!editable || isBooked) return;
                    e.preventDefault();
                    startRemoveDrag(di, rowIdx, slot.id);
                  }}
                  onMouseEnter={() => enterCell(di, rowIdx, true, slot)}
                  onClick={(e) => { if (!drag) onSlotClick(slot, e.currentTarget); }}
                  style={{ gridRow: `${gridRow} / span ${span}`, gridColumn }}
                  className={cn(
                    'relative m-[2px] rounded-lg overflow-hidden flex flex-col items-start justify-center pl-2.5 pr-2 py-1 transition-colors',
                    isPast
                      ? 'bg-surface-100/70 cursor-not-allowed'
                      : inRemoveDrag
                      ? 'bg-rose-100 ring-2 ring-inset ring-rose-400 cursor-pointer'
                      : isResizingThis
                      ? cn(color.bg, 'ring-2 ring-inset ring-brand-500 cursor-pointer')
                      : cn(color.bg, color.hover, 'shadow-sm cursor-pointer')
                  )}
                  title={
                    isBooked
                      ? `Booked · ${slot.candidate_name ?? 'candidate'} (${ROUND_MAP[slot.round_type]?.label}, ${slot.duration_mins} min) — click for details`
                      : editable
                      ? `Available · ${slot.duration_mins} min — click for details, drag to remove`
                      : isUnassigned
                      ? `Not published yet · ${slot.duration_mins} min — click to book it for a candidate`
                      : `Open · ${ROUND_MAP[slot.round_type]?.label} · ${slot.duration_mins} min`
                  }
                >
                  <span
                    className={cn(
                      'absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg',
                      isPast ? 'bg-surface-300' : color.bar
                    )}
                  />
                  <span className={cn('text-[11px] font-semibold leading-tight truncate w-full', isPast ? 'text-gray-400' : color.text)}>
                    {label}
                  </span>
                  {showTimeRange && (
                    <span className={cn('text-[10px] leading-tight truncate w-full tabular-nums', isPast ? 'text-gray-400' : cn(color.text, 'opacity-70'))}>
                      {format(start, 'h:mm')}–{format(slotEnd, 'h:mm a')}
                    </span>
                  )}
                  {showResizeHandle && (
                    <span
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startResizeDrag(di, rowIdx, slot, span, e.clientY);
                      }}
                      title="Drag up/down to resize (30/60 min)"
                      className="absolute left-1 right-1 bottom-0 h-2.5 cursor-ns-resize flex items-center justify-center group"
                    >
                      <span className="w-6 h-1 rounded-full bg-black/10 group-hover:bg-black/30" />
                    </span>
                  )}
                </button>
              );
            }
            if (covered.has(rowIdx)) return null;

            return (
              <button
                key={`empty-${di}-${rowIdx}`}
                disabled={isPast || !editable}
                onMouseDown={(e) => { if (editable && !isPast) { e.preventDefault(); startCreateDrag(di, rowIdx); } }}
                onMouseEnter={() => enterCell(di, rowIdx, false, null)}
                style={{ gridRow, gridColumn }}
                className={cn(
                  'group relative flex items-center justify-center border-l border-l-surface-100 border-t transition-colors',
                  isHourLine ? 'border-t-surface-200' : 'border-t-surface-100',
                  isPast
                    ? 'bg-surface-100/60 cursor-not-allowed'
                    : editable
                    ? inCreateDrag
                      ? 'bg-brand-200/70 ring-1 ring-inset ring-brand-400 cursor-pointer'
                      : 'cursor-pointer hover:bg-brand-50'
                    : 'cursor-default'
                )}
              >
                {editable && !isPast && !inCreateDrag && (
                  <span className="opacity-0 group-hover:opacity-100 text-[10px] font-semibold text-brand-500 tabular-nums pointer-events-none transition-opacity">
                    + {format(cellTimes[rowIdx], 'h:mm')}
                  </span>
                )}
              </button>
            );
          });
        })}
      </div>
    </div>
  );
}

// ── Recurring availability (editable calendars only) ──────────────────────────
//
// "Repeat every weekday 2-5pm until X" instead of copying day-by-day — reuses
// the same batch publish call the drag-to-paint and copy-day flows already
// make (job/round left null, raw unassigned availability), just fed a
// pattern-generated start_times list instead of a single drag's worth.

const WEEKDAYS = [
  { idx: 1, short: 'Mon' }, { idx: 2, short: 'Tue' }, { idx: 3, short: 'Wed' },
  { idx: 4, short: 'Thu' }, { idx: 5, short: 'Fri' }, { idx: 6, short: 'Sat' },
  { idx: 0, short: 'Sun' },
];

function RecurringAvailabilityModal({ onCancel, onSubmit, isPending }) {
  const [weekdays, setWeekdays] = useState(() => new Set([1, 2, 3, 4, 5])); // Mon–Fri by default
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [until, setUntil] = useState(() => format(addDays(gridNow(), 28), 'yyyy-MM-dd'));

  function toggleDay(idx) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  const valid = weekdays.size > 0 && startTime < endTime && !!until;

  // Same arithmetic the submit handler uses, surfaced up front so nobody has
  // to publish a pattern to find out how big it was.
  const estimate = useMemo(() => {
    if (!valid) return 0;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const perDay = Math.max(0, Math.floor(((eh * 60 + em) - (sh * 60 + sm)) / PUBLISH_DURATION_MINS));
    const untilDate = new Date(`${until}T23:59:59`);
    let days = 0;
    for (let d = gridNow(); d <= untilDate; d = addDays(d, 1)) {
      if (weekdays.has(d.getDay())) days += 1;
    }
    return perDay * days;
  }, [valid, startTime, endTime, until, weekdays]);

  return (
    <Modal
      onClose={onCancel}
      title="Repeat weekly"
      description="Open up the same hours every week, in one go."
      icon={Repeat}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">
            {estimate > 0 ? `≈ ${estimate} slot${estimate === 1 ? '' : 's'}` : 'Nothing to publish yet'}
          </span>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              disabled={!valid || isPending}
              onClick={() => onSubmit({ weekdays, startTime, endTime, until })}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…</> : 'Publish pattern'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <span className="block text-xs font-semibold text-gray-600 mb-2">Repeat on</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map(({ idx, short }) => (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx)}
                aria-pressed={weekdays.has(idx)}
                className={cn(
                  'w-12 h-9 rounded-lg text-xs font-semibold border transition-colors',
                  weekdays.has(idx)
                    ? 'bg-brand-500 border-brand-500 text-white'
                    : 'bg-white border-surface-200 text-gray-500 hover:bg-surface-50'
                )}
              >
                {short}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1.5">From (IST)</span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1.5">To (IST)</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-semibold text-gray-600 mb-1.5">Repeat until</span>
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>

        {!valid && startTime >= endTime && (
          <p className="text-xs text-rose-600">The end time has to be after the start time.</p>
        )}

        <div className="flex gap-2.5 text-xs text-gray-500 bg-surface-50 border border-surface-200 rounded-xl p-3">
          <Sparkles className="w-4 h-4 text-brand-400 shrink-0 mt-px" />
          <p>
            Publishes hourly blocks on each selected day. Times that already have a slot are skipped, so running
            this twice never creates duplicates.
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ── Slot detail popover (click-for-details, Teams-style) ───────────────────────

const POPOVER_W = 288;
const POPOVER_H = 340;

function SlotDetailPopover({ slot, anchorRect, editable, onClose, onRemove, onResize, onReschedule, isBusy }) {
  const ref = useClickOutside(onClose, true);

  // The card is positioned off a one-time snapshot of the slot's rect, so any
  // scroll — the page, or the calendar's own internal scroller — detaches it
  // from what it is describing. Capture phase is what makes this catch scrolls
  // inside the grid container as well as on the window.
  useEffect(() => {
    window.addEventListener('scroll', onClose, true);
    return () => window.removeEventListener('scroll', onClose, true);
  }, [onClose]);

  const isBooked = slot.status === 'booked';
  const start = gridTime(slot.start_time);
  const end = new Date(start.getTime() + slot.duration_mins * 60000);

  const [rescheduleDate, setRescheduleDate] = useState(() => istDateKey(slot.start_time));
  const [rescheduleTime, setRescheduleTime] = useState(() => istTimeKey(slot.start_time));

  function submitReschedule() {
    onReschedule(fromISTDateTime(rescheduleDate, rescheduleTime));
  }

  // Flip above the anchor when there isn't room below, and clamp horizontally
  // so the card never renders off an edge — anchorRect is a raw DOM rect with
  // no idea how big this card actually is.
  const { top, left } = useMemo(() => {
    if (!anchorRect) return { top: 100, left: 100 };
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const flip = spaceBelow < POPOVER_H && anchorRect.top > spaceBelow;
    return {
      top: flip
        ? Math.max(8, anchorRect.top - POPOVER_H - 6)
        : Math.min(anchorRect.bottom + 6, window.innerHeight - POPOVER_H - 8),
      left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - POPOVER_W - 8)),
    };
  }, [anchorRect]);

  return (
    <div
      ref={ref}
      style={{ top, left, width: POPOVER_W }}
      className="fixed z-50 bg-white rounded-2xl border border-surface-200 shadow-modal overflow-hidden animate-in fade-in zoom-in-95 duration-150"
    >
      <div className={cn('px-4 py-3 border-b border-surface-100', isBooked ? 'bg-emerald-50' : 'bg-brand-50/60')}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              {format(start, 'EEEE, MMM d')}
            </p>
            <p className="font-display text-sm font-bold text-gray-900 tabular-nums mt-0.5">
              {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
              <span className="ml-1 text-[11px] font-medium text-gray-400">IST</span>
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 -mt-0.5 -mr-1 w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-white/70 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        {isBooked ? (
          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
              <span className={cn('w-1.5 h-1.5 rounded-full', BOOKED_COLOR.dot)} /> Booked
            </span>
            <div className="flex items-center gap-2">
              <Avatar name={slot.candidate_name} className="w-8 h-8 text-xs" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{slot.candidate_name ?? 'Candidate'}</p>
                {slot.job_title && (
                  <p className="text-xs text-gray-500 truncate">
                    {slot.job_title} · {ROUND_MAP[slot.round_type]?.label ?? slot.round_type}
                  </p>
                )}
              </div>
            </div>
            <p className="text-[11px] text-gray-400 pt-1">
              Real interviews aren’t changed from this calendar — manage it from the candidate’s application.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={cn('w-2 h-2 rounded-full shrink-0', slot.job_id ? DEFAULT_GRID_COLOR.dot : UNASSIGNED_COLOR.dot)} />
            <p className="text-xs text-gray-600">
              {slot.job_id
                ? `${slot.job_title ?? 'Assigned'} · ${ROUND_MAP[slot.round_type]?.label ?? slot.round_type}`
                : 'Free time — not published to agencies yet'}
            </p>
          </div>
        )}

        {editable && !isBooked && (
          <div className="mt-3.5 pt-3.5 border-t border-surface-100 space-y-3.5">
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Duration</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[30, 60].map((mins) => (
                  <button
                    key={mins}
                    disabled={isBusy}
                    onClick={() => onResize(mins)}
                    className={cn(
                      'text-xs font-medium py-2 rounded-lg border transition-colors disabled:opacity-50',
                      slot.duration_mins === mins
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-white text-gray-600 border-surface-200 hover:bg-surface-50'
                    )}
                  >
                    {mins} min
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Move to</p>
              <div className="flex gap-1.5">
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="flex-1 min-w-0 text-xs border border-surface-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-[5.5rem] text-xs border border-surface-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <button
                disabled={isBusy}
                onClick={submitReschedule}
                className="mt-1.5 w-full text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg py-2 hover:bg-brand-100 disabled:opacity-50 transition-colors"
              >
                Move slot
              </button>
            </div>

            <button
              disabled={isBusy}
              onClick={() => onRemove(slot.id)}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-rose-600 border border-rose-100 hover:bg-rose-50 rounded-lg py-2 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove this slot
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Month summary (browse → jump into week) ───────────────────────────────────

function MonthGrid({ month, countsByDay, onDayClick }) {
  const gridStart = startOfWeek(startOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });
  const today = gridNow();

  return (
    <div className="rounded-xl border border-surface-200 overflow-hidden bg-white">
      <div className="grid grid-cols-7 bg-surface-50 border-b border-surface-200">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400 py-2">
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const counts = countsByDay.get(dayKeyLocal(day)) ?? { available: 0, booked: 0 };
          const total = counts.available + counts.booked;
          const inMonth = isSameMonth(day, month);
          const isTodayCell = isSameDay(day, today);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              title={total > 0 ? `${counts.available} available · ${counts.booked} booked` : 'No availability'}
              className={cn(
                'h-20 sm:h-24 border-b border-r border-surface-100 p-1.5 sm:p-2 text-left transition-colors relative',
                inMonth ? 'hover:bg-brand-50' : 'bg-surface-50/60',
                isWeekend(day) && inMonth && 'bg-surface-50/50'
              )}
            >
              <span
                className={cn(
                  'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold',
                  isTodayCell
                    ? 'bg-brand-500 text-white'
                    : inMonth ? 'text-gray-700' : 'text-gray-300'
                )}
              >
                {format(day, 'd')}
              </span>
              {total > 0 && (
                <div className="mt-1 space-y-0.5">
                  {counts.available > 0 && (
                    <p className="flex items-center gap-1 text-[10px] font-medium text-brand-700">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', AVAILABLE_COLOR.dot)} />
                      {counts.available} free
                    </p>
                  )}
                  {counts.booked > 0 && (
                    <p className="flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', BOOKED_COLOR.dot)} />
                      {counts.booked} booked
                    </p>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function dayKeyLocal(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend({ editable }) {
  const items = editable
    ? [
        { swatch: AVAILABLE_COLOR.swatch, label: 'Available' },
        { swatch: BOOKED_COLOR.swatch, label: 'Booked' },
      ]
    : [
        { swatch: UNASSIGNED_COLOR.swatch, label: 'Needs a job' },
        ...ROUND_TYPES.map((r) => ({
          swatch: (GRID_ROUND_COLORS[r.key] ?? DEFAULT_GRID_COLOR).swatch,
          label: r.label,
        })),
        { swatch: BOOKED_COLOR.swatch, label: 'Booked' },
      ];
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      {items.map(({ swatch, label }) => (
        <span key={label} className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <span className={cn('w-2.5 h-2.5 rounded-sm', swatch)} />
          {label}
        </span>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const HR_MODES = [
  { value: 'own', label: 'My availability', shortLabel: 'Mine', icon: User },
  { value: 'manage', label: 'Book for an interviewer', shortLabel: 'Book', icon: CalendarCheck },
  { value: 'publish', label: 'Publish to agencies', shortLabel: 'Publish', icon: Send },
];

const VIEW_OPTIONS = [
  { value: 'day', label: 'Day', icon: CalendarDays },
  { value: 'week', label: 'Week', icon: CalendarRange },
  { value: 'month', label: 'Month', icon: LayoutGrid },
];

export default function AvailabilityPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isHR = HR_ROLES.includes(user?.role);

  const [view, setView] = useState('week'); // 'week' | 'month' | 'day'
  const [weekStart, setWeekStart] = useState(() => startOfWeek(gridNow()));
  const [dayCursor, setDayCursor] = useState(() => gridNow());
  const [monthCursor, setMonthCursor] = useState(() => gridNow());
  const [selectedInterviewerId, setSelectedInterviewerId] = useState('');
  const [bookingSlot, setBookingSlot] = useState(null);
  const [assigningSlot, setAssigningSlot] = useState(null);
  const [showFullDay, setShowFullDay] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  // { slot, anchorRect } | null — the Teams-style click-for-details popover,
  // anchored to the DOM rect of whichever slot button was clicked.
  const [detailPopover, setDetailPopover] = useState(null);

  // A 7-column grid is unreadable on a phone, so narrow screens open on the
  // single-day view instead of dumping the user into a sideways scroll.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) setView('day');
  }, []);

  // Ticks once a minute purely to force WeekGrid to re-render so its
  // current-time indicator line keeps moving — the grid otherwise only
  // re-renders on query refetches/state changes, which could leave the line
  // visibly stuck for a while.
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  // HR/Admin/Super Admin often conduct interviews themselves — the backend
  // already lets them call publish/mine/unpublish (see _HR_AND_INTERVIEWER in
  // interview_slots.py), this mode toggle is what actually exposes it in the UI
  // instead of always defaulting them into "book for someone else".
  // 'own' = publish my own slots | 'manage' = browse an interviewer's calendar
  // to book a slot directly for an internal candidate | 'publish' = pick a
  // job, tick several of that interviewer's open slots, publish them all to
  // agencies at once (PublishSlotsPanel).
  const [hrMode, setHrMode] = useState('manage');

  const startHour = showFullDay ? FULL_START_HOUR : WORK_START_HOUR;
  const endHour = showFullDay ? FULL_END_HOUR : WORK_END_HOUR;
  const rows = ((endHour - startHour) * 60) / SLOT_MINUTES;
  const gridDays = view === 'day' ? [dayCursor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const { data: jobsData } = useQuery({
    queryKey: ['availability-publishable-jobs'],
    queryFn: () => interviewSlotsApi.publishableJobs().then((r) => r.data),
  });

  // Everyone who can actually sit on a panel, not just users whose role is
  // literally "interviewer" — HR managers and admins conduct interviews too
  // (that's exactly what the "My availability" tab exists for), and the old
  // role:'interviewer' filter made their calendars unreachable from here.
  const { data: interviewersData } = useQuery({
    queryKey: ['panel-eligible-users'],
    queryFn: () => usersApi.panelEligible().then((r) => r.data),
    enabled: isHR,
  });

  const manageOwnSlots = !isHR || hrMode === 'own';
  const viewingInterviewerId = manageOwnSlots ? user?.id : selectedInterviewerId;
  const editable = manageOwnSlots; // publishing own slots vs. HR just booking someone else's
  const selectedInterviewer = interviewersData?.find((p) => p.id === selectedInterviewerId);

  const { data: slots, isLoading } = useQuery({
    queryKey: ['interview-slots', manageOwnSlots ? 'mine' : viewingInterviewerId],
    queryFn: () =>
      manageOwnSlots
        ? interviewSlotsApi.mine().then((r) => r.data)
        : interviewSlotsApi.forInterviewer(viewingInterviewerId).then((r) => r.data),
    enabled: !!viewingInterviewerId && hrMode !== 'publish',
  });

  // "Publish slots to agencies" shows every interviewer's open, not-yet-booked
  // slots by default — both raw availability still needing a job (job_id
  // null) and already-published slots still waiting on a booking (job_id
  // set, status still "open") — HR shouldn't have to pick one interviewer at
  // a time just to see either. The interviewer select is an optional
  // narrowing filter (applied client-side below), not a precondition.
  const { data: publishableSlots, isLoading: publishableLoading } = useQuery({
    queryKey: ['interview-slots-publishable'],
    queryFn: () => interviewSlotsApi.publishable().then((r) => r.data),
    enabled: isHR && hrMode === 'publish',
    // A slot can get booked from elsewhere while this panel sits open — an
    // agency booking it, or HR booking it directly via "Book for an
    // interviewer" in another tab/session — and this view has no push
    // mechanism to hear about that. Polling is what keeps a just-booked slot
    // from lingering here looking falsely available.
    refetchInterval: 20000,
  });

  const publishPanelSlots = useMemo(() => {
    if (!selectedInterviewerId) return publishableSlots ?? [];
    return (publishableSlots ?? []).filter((s) => s.interviewer_id === selectedInterviewerId);
  }, [publishableSlots, selectedInterviewerId]);

  // The single at-a-glance answer to "what's on this calendar" — the whole
  // reason someone opens this page — surfaced as plain numbers up top instead
  // of making anyone scan and count colored cells across a whole month.
  const upcomingStats = useMemo(() => {
    const now = new Date();
    const upcoming = (slots ?? []).filter((s) => new Date(s.start_time) >= now);
    const open = upcoming.filter((s) => s.status === 'open');
    const soon = upcoming.filter((s) => new Date(s.start_time) <= new Date(now.getTime() + 7 * 86400000));
    return {
      available: open.length,
      booked: upcoming.filter((s) => s.status === 'booked').length,
      unpublished: open.filter((s) => !s.job_id).length,
      next7: soon.length,
      nextSlot: upcoming.sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0] ?? null,
    };
  }, [slots]);

  const publishStats = useMemo(() => {
    const now = new Date();
    const upcoming = (publishPanelSlots ?? []).filter((s) => new Date(s.start_time) >= now && s.status === 'open');
    return {
      needsJob: upcoming.filter((s) => !s.job_id).length,
      awaiting: upcoming.filter((s) => !!s.job_id).length,
      interviewers: new Set(upcoming.map((s) => s.interviewer_id)).size,
    };
  }, [publishPanelSlots]);

  const countsByDay = useMemo(() => {
    const map = new Map();
    (slots ?? []).forEach((s) => {
      const k = dayKeyLocal(gridTime(s.start_time));
      const cur = map.get(k) ?? { available: 0, booked: 0 };
      if (s.status === 'booked') cur.booked += 1; else cur.available += 1;
      map.set(k, cur);
    });
    return map;
  }, [slots]);

  // How many published slots this week fall outside the collapsed working-hours
  // window — surfaced as a banner rather than silently hidden, since collapsing
  // to 8am–8pm by default must never make real data disappear unnoticed.
  const hiddenOutsideWindow = useMemo(() => {
    if (showFullDay) return 0;
    return (slots ?? []).filter((s) => {
      const st = gridTime(s.start_time);
      return gridDays.some((d) => isSameDay(d, st)) && (st.getHours() < WORK_START_HOUR || st.getHours() >= WORK_END_HOUR);
    }).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, weekStart, dayCursor, view, showFullDay]);

  // Surfaced to HR while browsing an interviewer's calendar — the "publish
  // for agencies" action only exists as a click target on individual slate
  // cells in the grid, which is easy to miss entirely if nothing points it
  // out first.
  const unassignedCountThisWeek = useMemo(() => {
    return (slots ?? []).filter((s) => {
      const st = gridTime(s.start_time);
      return s.status === 'open' && !s.job_id && gridDays.some((d) => isSameDay(d, st));
    }).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, weekStart, dayCursor, view]);

  const invalidateSlots = () => {
    queryClient.invalidateQueries({ queryKey: ['interview-slots', manageOwnSlots ? 'mine' : viewingInterviewerId] });
    queryClient.invalidateQueries({ queryKey: ['interview-slots-publishable'] });
    // Booking a slot here creates a real interview against some application's
    // detail page — an unqualified key (no application id) invalidates every
    // cached ['application-interviews', id] query at once, so if that page is
    // already open elsewhere it reflects the new interview immediately
    // instead of waiting on its own 15s poll. Same idea for the "book a
    // published slot" picker on that page, keyed by job id.
    queryClient.invalidateQueries({ queryKey: ['application-interviews'] });
    queryClient.invalidateQueries({ queryKey: ['interview-slots-for-job'] });
  };

  const publishBatchMutation = useMutation({
    // start_times arrive as IST wall-clock grid Dates; gridToInstant is what
    // turns each one back into the real UTC instant the API stores.
    mutationFn: ({ jobId, roundType, durationMins, startTimes }) =>
      interviewSlotsApi.publish({
        job_id: jobId,
        round_type: roundType,
        duration_mins: durationMins,
        start_times: startTimes.map((d) => gridToInstant(d).toISOString()),
      }),
  });

  // Interviewer's own bulk drag-to-remove of not-yet-booked availability
  // (handleRemoveRange below) — the only place slots get deleted outright.
  const unpublishMutation = useMutation({
    mutationFn: (id) => interviewSlotsApi.unpublish(id),
  });

  // "Reuse" — a slot HR already published for a job, but no agency booked it,
  // goes back to raw unassigned availability so HR can publish it for a
  // different job instead, without deleting anything or making the
  // interviewer republish that time. Applied optimistically against the
  // publishable-slots cache — moving it between the two panel sections is a
  // pure client-side edit, so there's no need to wait on a round trip (and
  // the follow-up refetch) before the UI reflects it.
  const [unassigningSlotId, setUnassigningSlotId] = useState(null);
  const unassignMutation = useMutation({
    mutationFn: (id) => interviewSlotsApi.unassign(id),
  });
  async function handleUnassignSlot(slot) {
    setUnassigningSlotId(slot.id);
    const key = ['interview-slots-publishable'];
    const previous = queryClient.getQueryData(key);
    queryClient.setQueryData(key, (old) =>
      (old ?? []).map((s) => (s.id === slot.id ? { ...s, job_id: null, round_type: null, job_title: null } : s))
    );
    try {
      await unassignMutation.mutateAsync(slot.id);
      invalidateSlots(); // background reconcile with the server — UI already moved optimistically above
      toast.success('Slot freed up — pick a new job for it whenever you like.');
    } catch (err) {
      queryClient.setQueryData(key, previous); // roll back the optimistic move
      toast.error(err.response?.data?.detail ?? 'Could not free up this slot');
    } finally {
      setUnassigningSlotId(null);
    }
  }

  // "Request availability" — a nudge for an interviewer who hasn't published
  // much (or any) free time, rather than HR waiting around or chasing them
  // outside the app. Backend enforces its own cooldown per interviewer, so a
  // repeat click just surfaces that as an error instead of double-sending.
  const requestPublishMutation = useMutation({
    mutationFn: (userId) => interviewSlotsApi.requestPublish(userId),
    onSuccess: (res) => toast.success(res.data?.message ?? 'Reminder sent.'),
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not send the reminder'),
  });

  const bookMutation = useMutation({
    mutationFn: ({ slotId, applicationId }) => interviewSlotsApi.book({ slot_id: slotId, application_id: applicationId }),
    onSuccess: () => {
      invalidateSlots();
      setBookingSlot(null);
      toast.success('Interview scheduled!');
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail ?? 'Could not book this slot');
      invalidateSlots(); // someone else may have just taken it — refresh to show the truth
    },
  });

  // Books a still-unassigned slot directly — job/round and candidate chosen
  // in the same flow, claimed atomically on the backend, so the slot never
  // sits in an agency-visible "assigned but open" state along the way.
  const bookUnassignedMutation = useMutation({
    mutationFn: ({ slotId, jobId, roundType, applicationId }) =>
      interviewSlotsApi.bookUnassigned({ slot_id: slotId, job_id: jobId, round_type: roundType, application_id: applicationId }),
    onSuccess: () => {
      invalidateSlots();
      setBookingSlot(null);
      toast.success('Interview scheduled!');
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail ?? 'Could not book this slot');
      invalidateSlots(); // someone else may have just taken it — refresh to show the truth
    },
  });

  const assignBatchMutation = useMutation({
    mutationFn: (data) => interviewSlotsApi.assignBatch(data),
  });

  // Returns true/false so PublishSlotsPanel knows whether to clear its
  // selection — it shouldn't if the call failed, so HR can just retry.
  async function handlePublishBatch({ slot_ids, job_id, round_type }) {
    try {
      const res = await assignBatchMutation.mutateAsync({ slot_ids, job_id, round_type });
      invalidateSlots();
      const published = res.data?.length ?? 0;
      if (published === 0) {
        toast.error('None of those slots could be published — they may have just been booked or removed.');
        return false;
      }
      if (published < slot_ids.length) {
        toast.success(`Published ${published} of ${slot_ids.length} slots (the rest were no longer open)`);
      } else {
        toast.success(`Published ${published} slot${published !== 1 ? 's' : ''} — agencies for that job can now book ${published !== 1 ? 'them' : 'it'}.`);
      }
      return true;
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Could not publish these slots');
      return false;
    }
  }

  // Drag-to-paint: a whole dragged range becomes ONE publish call carrying
  // every start_time at once (the backend already accepted a batch, the old
  // UI just never sent more than one at a time) — this is what turns
  // "publish a morning" from dozens of clicks into a single drag. Interviewers
  // no longer pick a job/round here at all — that happens later when HR
  // assigns the slot — so every publish goes out with job/round unset.
  //
  // Applied optimistically: a click/drag used to sit waiting on the full
  // round trip to a remote Postgres instance before the cell changed color
  // at all, which read as "high latency" even though the publish itself was
  // quick. The temp rows below render immediately; on success they're
  // replaced with the server's real ones, on failure (or a same-time overlap
  // the server rejects) the cache is rolled back to what it was before.
  async function handlePublishRange(day, loRow, hiRow) {
    const { covered } = buildDayLayout(day, slots, startHour, rows);
    const startTimes = computeDragStartTimes(day, loRow, hiRow, PUBLISH_DURATION_MINS, covered, startHour);
    if (startTimes.length === 0) return;

    const queryKey = ['interview-slots', manageOwnSlots ? 'mine' : viewingInterviewerId];
    const previous = queryClient.getQueryData(queryKey);
    const optimisticSlots = startTimes.map((st) => ({
      id: `optimistic-${st.getTime()}`,
      job_id: null,
      job_title: null,
      round_type: null,
      start_time: gridToInstant(st).toISOString(),
      duration_mins: PUBLISH_DURATION_MINS,
      status: 'open',
      interview_id: null,
      interviewer_id: viewingInterviewerId,
      interviewer_name: null,
      candidate_name: null,
    }));
    queryClient.setQueryData(queryKey, (old) => [...(old ?? []), ...optimisticSlots]);

    try {
      const res = await publishBatchMutation.mutateAsync({
        jobId: null, roundType: null, durationMins: PUBLISH_DURATION_MINS, startTimes,
      });
      invalidateSlots(); // reconciles the optimistic temp rows with real ids in the background
      const created = res.data?.length ?? 0;
      if (created === 0) {
        queryClient.setQueryData(queryKey, previous);
        toast.error('That range overlaps existing slots on your calendar');
      } else if (created < startTimes.length) {
        toast.success(`Published ${created} slot${created !== 1 ? 's' : ''} (${startTimes.length - created} skipped — already occupied)`);
      } else if (created > 1) toast.success(`Published ${created} slots`);
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      toast.error(err.response?.data?.detail ?? 'Could not publish slots');
    }
  }

  async function handleRemoveRange(ids) {
    if (!ids || ids.size === 0) return;
    const list = Array.from(ids);
    const results = await Promise.allSettled(list.map((id) => unpublishMutation.mutateAsync(id)));
    invalidateSlots();
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === 0) toast.success(`Removed ${list.length} slot${list.length !== 1 ? 's' : ''}`);
    else toast.error(`Removed ${list.length - failed}, ${failed} failed`);
  }

  // "Copy day": takes every OPEN slot on the clicked day and republishes the
  // same time-of-day exactly one week later, as raw UNASSIGNED availability —
  // never carrying over the source slot's job/round even if it had already
  // been assigned. Assignment is HR's deliberate per-slot decision, so a copy
  // must always land back in "needs assignment" state rather than silently
  // pre-deciding it. Grouped only by duration (job/round dropped entirely),
  // so this is normally a single batch call regardless of how many slots.
  //
  // Previously this also copied across the *same* displayed week (Mon–Fri of
  // weekStart) regardless of which day was clicked — copying from, say,
  // Thursday landed slots on Monday/Tuesday/Wednesday too, which are earlier
  // in the week and often already in the past. Copying forward exactly 7
  // days is the only direction that can never land in the past.
  const [copyingDay, setCopyingDay] = useState(false);
  async function handleCopyDay(day) {
    const daySlots = (slots ?? []).filter((s) => isSameDay(gridTime(s.start_time), day) && s.status === 'open');
    if (daySlots.length === 0) return;
    const targetDay = addDays(day, 7);

    const groups = new Map(); // duration_mins -> [Date,...]
    for (const s of daySlots) {
      const st = gridTime(s.start_time);
      if (!groups.has(s.duration_mins)) groups.set(s.duration_mins, []);
      const d = new Date(targetDay);
      d.setHours(st.getHours(), st.getMinutes(), 0, 0);
      groups.get(s.duration_mins).push(d);
    }

    setCopyingDay(true);
    let totalCreated = 0;
    let totalRequested = 0;
    try {
      for (const [durationMins, startTimes] of groups) {
        totalRequested += startTimes.length;
        const res = await publishBatchMutation.mutateAsync({
          jobId: null, roundType: null, durationMins, startTimes,
        });
        totalCreated += res.data?.length ?? 0;
      }
      invalidateSlots();
      if (totalCreated === 0) toast.error('Nothing to copy — those times are already taken next week');
      else toast.success(`Copied to ${format(targetDay, 'EEE, MMM d')}: ${totalCreated} slot${totalCreated !== 1 ? 's' : ''}${totalCreated < totalRequested ? ` (${totalRequested - totalCreated} skipped — already occupied)` : ''}`);
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Could not copy this day');
    } finally {
      setCopyingDay(false);
    }
  }

  // Backs both the resize-drag handle and the popover's 30/60 toggle —
  // capped to the same {30, 60} set the backend accepts (see
  // SlotRescheduleRequest), which keeps a resized slot bookable by the
  // agency self-book path.
  const rescheduleMutation = useMutation({
    mutationFn: ({ slotId, data }) => interviewSlotsApi.reschedule(slotId, data),
  });

  async function handleResizeSlot(slotId, durationMins) {
    const queryKey = ['interview-slots', manageOwnSlots ? 'mine' : viewingInterviewerId];
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (old) =>
      (old ?? []).map((s) => (s.id === slotId ? { ...s, duration_mins: durationMins } : s))
    );
    try {
      await rescheduleMutation.mutateAsync({ slotId, data: { duration_mins: durationMins } });
      invalidateSlots();
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      toast.error(err.response?.data?.detail ?? 'Could not resize this slot');
    }
  }

  // `startTime` is a real UTC instant already — the popover builds it from its
  // IST date/time inputs via fromISTDateTime.
  async function handleRescheduleSlot(slotId, startTime) {
    try {
      await rescheduleMutation.mutateAsync({ slotId, data: { start_time: startTime.toISOString() } });
      invalidateSlots();
      setDetailPopover(null);
      toast.success('Slot rescheduled');
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Could not reschedule this slot');
    }
  }

  async function handleRemoveSlotFromPopover(slotId) {
    try {
      await unpublishMutation.mutateAsync(slotId);
      invalidateSlots();
      setDetailPopover(null);
      toast.success('Slot removed');
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Could not remove this slot');
    }
  }

  function handleSlotClick(slot, anchorEl) {
    const anchorRect = anchorEl?.getBoundingClientRect();
    // Booked slots are read-only everywhere (real interviews aren't managed
    // from this grid), but they're worth a click now — Teams-style, clicking
    // any event should show its details rather than doing nothing.
    if (slot.status === 'booked') { setDetailPopover({ slot, anchorRect }); return; }
    // The editable calendar (an interviewer's own slots, or HR's "My
    // availability" tab) always opens the detail popover on click now —
    // single-slot removal moves from instant-click to the popover's Remove
    // button; bulk removal by dragging across several cells is unchanged.
    if (editable) { setDetailPopover({ slot, anchorRect }); return; }
    if (!isHR || slot.status !== 'open') return;
    // This tab is for booking an internal candidate directly — never
    // "publish for agencies" (that's the dedicated Publish tab's job).
    // Unassigned slots ask which job/round first, then go straight to the
    // candidate picker; an already-assigned open slot skips straight there.
    if (!slot.job_id) setAssigningSlot(slot);
    else setBookingSlot(slot);
  }

  // Step 1 (job/round) is done — carry the choice into the same candidate
  // picker an already-assigned slot uses, flagged so the eventual booking
  // call knows to claim job/round + candidate atomically (book_unassigned_slot)
  // instead of the plain book() call an already-assigned slot uses.
  function handlePickJobRoundForBooking(slot, { job_id, round_type }) {
    setAssigningSlot(null);
    setBookingSlot({ ...slot, job_id, round_type, __unassigned: true });
  }

  // "Repeat weekly" — generates every matching start_time (selected weekdays,
  // hourly steps from the pattern's start to end time) between today and the
  // until-date, then republishes as raw unassigned availability through the
  // same batch call handleCopyDay already makes.
  async function handleRecurringSubmit({ weekdays, startTime, endTime, until }) {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const untilDate = new Date(`${until}T23:59:59`);
    const now = gridNow();

    const startTimes = [];
    for (let day = gridNow(); day <= untilDate; day = addDays(day, 1)) {
      if (!weekdays.has(day.getDay())) continue;
      for (let h = startH, m = startM; h < endH || (h === endH && m < endM); ) {
        const dt = new Date(day);
        dt.setHours(h, m, 0, 0);
        if (dt >= now) startTimes.push(dt);
        m += PUBLISH_DURATION_MINS;
        while (m >= 60) { m -= 60; h += 1; }
      }
    }

    if (startTimes.length === 0) {
      toast.error('Nothing to publish — that pattern has no upcoming times before the until-date');
      return;
    }

    try {
      const res = await publishBatchMutation.mutateAsync({
        jobId: null, roundType: null, durationMins: PUBLISH_DURATION_MINS, startTimes,
      });
      invalidateSlots();
      const created = res.data?.length ?? 0;
      setShowRecurringModal(false);
      if (created === 0) toast.error('Nothing published — every one of those times is already taken');
      else if (created < startTimes.length) {
        toast.success(`Published ${created} of ${startTimes.length} slots (the rest were already occupied)`);
      } else {
        toast.success(`Published ${created} slot${created !== 1 ? 's' : ''} as unassigned availability`);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Could not publish this pattern');
    }
  }

  // ── Header copy, per mode ──
  const heading = manageOwnSlots
    ? 'My Availability'
    : hrMode === 'publish'
    ? 'Publish Slots to Agencies'
    : 'Interviewer Availability';
  const subheading = manageOwnSlots
    ? 'Drag across the grid to mark yourself free — HR takes it from there.'
    : hrMode === 'publish'
    ? 'Attach a job and round to open availability so recruitment partners can book it.'
    : 'Browse a panel member’s calendar and book an interview directly for a candidate.';

  const isCalendarMode = hrMode !== 'publish';
  const needsInterviewerPick = isHR && hrMode === 'manage' && !selectedInterviewerId;

  function goToday() {
    if (view === 'day') setDayCursor(gridNow());
    else if (view === 'week') setWeekStart(startOfWeek(gridNow()));
    else setMonthCursor(gridNow());
  }
  function step(dir) {
    if (view === 'day') setDayCursor((d) => addDays(d, dir));
    else if (view === 'week') setWeekStart((w) => (dir > 0 ? addWeeks(w, 1) : subWeeks(w, 1)));
    else setMonthCursor((m) => (dir > 0 ? addMonths(m, 1) : subMonths(m, 1)));
  }
  const rangeLabel =
    view === 'day'
      ? format(dayCursor, 'EEEE, MMM d, yyyy')
      : view === 'month'
      ? format(monthCursor, 'MMMM yyyy')
      : `${format(weekStart, 'MMM d')} – ${format(addDays(weekStart, 6), 'MMM d, yyyy')}`;

  return (
    <div className="space-y-4 max-w-[1500px]">
      {/* ── Header ── */}
      <div className="bg-white rounded-2xl border border-surface-200 p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <CalendarClock className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900 leading-tight">{heading}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{subheading}</p>
            </div>
          </div>
          {isHR && (
            <Segmented
              value={hrMode}
              onChange={setHrMode}
              options={HR_MODES}
              className="shrink-0 self-start"
            />
          )}
        </div>

        {/* Stats */}
        {isCalendarMode ? (
          (!isHR || viewingInterviewerId) && !isLoading && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4 pt-4 border-t border-surface-100">
              <StatTile label="Upcoming available" value={upcomingStats.available} icon={CalendarCheck} tone="brand" />
              <StatTile label="Booked interviews" value={upcomingStats.booked} icon={Users} tone="emerald" />
              {editable ? (
                <StatTile label="Next 7 days" value={upcomingStats.next7} icon={CalendarRange} tone="violet" />
              ) : (
                <StatTile label="Still need a job" value={upcomingStats.unpublished} icon={Hourglass} tone="amber" />
              )}
              <StatTile
                label="Next slot"
                value={
                  upcomingStats.nextSlot
                    ? format(gridTime(upcomingStats.nextSlot.start_time), 'd MMM')
                    : '—'
                }
                hint={
                  upcomingStats.nextSlot
                    ? `${format(gridTime(upcomingStats.nextSlot.start_time), 'h:mm a')} IST`
                    : 'Nothing scheduled'
                }
                icon={Clock}
                tone="slate"
              />
            </div>
          )
        ) : (
          !publishableLoading && (
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-surface-100">
              <StatTile label="Need a job" value={publishStats.needsJob} icon={Hourglass} tone="amber" />
              <StatTile label="Awaiting a booking" value={publishStats.awaiting} icon={Send} tone="brand" />
              <StatTile label="Panel members free" value={publishStats.interviewers} icon={Users} tone="violet" />
            </div>
          )
        )}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-col xl:flex-row xl:items-center gap-3">
        {isHR && (hrMode === 'manage' || hrMode === 'publish') && (
          <div className="flex items-end gap-2">
            <InterviewerPicker
              value={selectedInterviewerId}
              onChange={setSelectedInterviewerId}
              people={interviewersData}
              allLabel={hrMode === 'publish' ? 'All interviewers' : undefined}
              placeholder="Select an interviewer…"
            />
            {hrMode === 'manage' && selectedInterviewerId && (
              <button
                onClick={() => requestPublishMutation.mutate(selectedInterviewerId)}
                disabled={requestPublishMutation.isPending}
                title="Send a reminder asking them to publish their free interview slots"
                className="h-[46px] inline-flex items-center gap-1.5 px-3 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-xl hover:bg-brand-100 disabled:opacity-50 transition-colors"
              >
                {requestPublishMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
                <span className="hidden sm:inline">{requestPublishMutation.isPending ? 'Sending…' : 'Nudge'}</span>
              </button>
            )}
          </div>
        )}

        {isCalendarMode && (!isHR || viewingInterviewerId) && (
          <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
            <div className="flex items-center gap-1 bg-white border border-surface-200 rounded-xl p-1">
              <IconButton icon={ChevronLeft} label="Previous" onClick={() => step(-1)} className="border-0 bg-transparent hover:bg-surface-100" />
              <button
                onClick={goToday}
                className="px-2.5 py-1 text-xs font-semibold text-gray-600 hover:text-brand-600 rounded-lg hover:bg-surface-100 transition-colors"
              >
                Today
              </button>
              <IconButton icon={ChevronRight} label="Next" onClick={() => step(1)} className="border-0 bg-transparent hover:bg-surface-100" />
            </div>
            <p className="font-display text-sm font-semibold text-gray-800 tabular-nums px-1 order-last w-full sm:order-none sm:w-auto">
              {rangeLabel}
            </p>
            <Segmented value={view} onChange={setView} options={VIEW_OPTIONS} size="sm" />
            {view !== 'month' && (
              <IconButton
                icon={showFullDay ? Minimize2 : Maximize2}
                label={showFullDay ? 'Show working hours only' : 'Show the full 24 hours'}
                active={showFullDay}
                onClick={() => setShowFullDay((v) => !v)}
              />
            )}
            {editable && (
              <button
                onClick={() => setShowRecurringModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-brand-700 bg-white border border-brand-200 rounded-xl hover:bg-brand-50 transition-colors"
              >
                <Repeat className="w-4 h-4" />
                <span className="hidden sm:inline">Repeat weekly</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Publish-to-agencies mode ── */}
      {isHR && hrMode === 'publish' && (
        <PublishSlotsPanel
          slots={publishPanelSlots}
          jobsData={jobsData}
          onPublish={handlePublishBatch}
          isPending={assignBatchMutation.isPending}
          onUnassign={handleUnassignSlot}
          unassigningId={unassigningSlotId}
          isLoading={publishableLoading}
        />
      )}

      {/* ── HR hasn't chosen whose calendar to look at ── */}
      {needsInterviewerPick && (
        <div className="bg-white rounded-2xl border border-surface-200 overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-surface-200">
            <h2 className="font-display font-semibold text-gray-900">Whose calendar do you need?</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Pick someone from the interview panel to see their availability and book a candidate into it.
            </p>
          </div>
          {!interviewersData ? (
            <div className="flex justify-center py-14"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : interviewersData.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No panel members yet"
              description="Invite interviewers, HR managers or admins from Settings and their calendars will show up here."
            />
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5 p-4 sm:p-5">
              {interviewersData.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedInterviewerId(p.id)}
                  className="group flex items-center gap-3 p-3 rounded-xl border border-surface-200 bg-white text-left hover:border-brand-300 hover:shadow-card transition-all"
                >
                  <Avatar name={p.full_name} className="w-9 h-9 text-xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900 truncate">{p.full_name}</span>
                    <span className="block text-xs text-gray-400 truncate">{p.email}</span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-brand-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Calendar ── */}
      {isCalendarMode && (!isHR || viewingInterviewerId) && (
        <div className="bg-white rounded-2xl border border-surface-200 p-3 sm:p-4">
          {isLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : view === 'month' ? (
            <>
              <MonthGrid
                month={monthCursor}
                countsByDay={countsByDay}
                onDayClick={(day) => { setWeekStart(startOfWeek(day)); setDayCursor(day); setView('week'); }}
              />
              <p className="text-xs text-gray-400 mt-3 text-center">Click any day to open that week.</p>
            </>
          ) : (
            <>
              {/* Context strip: who / how */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3 px-1">
                {editable ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <Hint icon={MousePointerClick}>Drag empty cells to mark yourself free</Hint>
                    <Hint icon={Eraser}>Drag over free time to clear it</Hint>
                    <Hint icon={MoveVertical}>Drag a slot’s bottom edge to resize</Hint>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar name={selectedInterviewer?.full_name} />
                    <span className="text-sm text-gray-600 truncate">
                      <span className="font-medium text-gray-800">{selectedInterviewer?.full_name}</span>
                      <span className="text-gray-400"> · click an open slot to book a candidate</span>
                    </span>
                  </div>
                )}
                <span className="text-[11px] font-medium text-gray-400 shrink-0">All times IST</span>
              </div>

              {!editable && unassignedCountThisWeek > 0 && (
                <div className="mb-3 flex items-start gap-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3">
                  <span className={cn('w-2 h-2 rounded-full shrink-0 mt-1', UNASSIGNED_COLOR.dot)} />
                  <span>
                    {unassignedCountThisWeek} slot{unassignedCountThisWeek !== 1 ? 's' : ''} here {unassignedCountThisWeek !== 1 ? 'have' : 'has'} no
                    job attached yet. Click one to book it for a candidate, or use{' '}
                    <button onClick={() => setHrMode('publish')} className="underline underline-offset-2 hover:text-brand-600">
                      Publish to agencies
                    </button>{' '}
                    to open it up to recruitment partners.
                  </span>
                </div>
              )}

              {hiddenOutsideWindow > 0 && (
                <button
                  onClick={() => setShowFullDay(true)}
                  className="w-full mb-3 flex items-center justify-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl py-2.5 hover:bg-amber-100 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  {hiddenOutsideWindow} slot{hiddenOutsideWindow !== 1 ? 's' : ''} sit outside 8 AM–8 PM — show the full day
                </button>
              )}

              <WeekGrid
                days={gridDays}
                slots={slots}
                editable={editable}
                startHour={startHour}
                rows={rows}
                nowTick={nowTick}
                showFullDay={showFullDay}
                onPublishRange={handlePublishRange}
                onSlotClick={handleSlotClick}
                onRemoveRange={handleRemoveRange}
                onCopyDay={handleCopyDay}
                copyingDay={copyingDay}
                onResizeSlot={handleResizeSlot}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 mt-3 px-1">
                <Legend editable={editable} />
                {editable && (slots ?? []).length === 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600">
                    <Sparkles className="w-3.5 h-3.5" /> Nothing published yet — drag the grid to get started
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {bookingSlot && (
        <ApplicationPickerModal
          jobId={bookingSlot.job_id}
          slot={bookingSlot}
          isPending={bookMutation.isPending || bookUnassignedMutation.isPending}
          onCancel={() => setBookingSlot(null)}
          onPick={(applicationId) =>
            bookingSlot.__unassigned
              ? bookUnassignedMutation.mutate({
                  slotId: bookingSlot.id, jobId: bookingSlot.job_id, roundType: bookingSlot.round_type, applicationId,
                })
              : bookMutation.mutate({ slotId: bookingSlot.id, applicationId })
          }
        />
      )}

      {assigningSlot && (
        <PickJobRoundForBookingModal
          slot={assigningSlot}
          jobsData={jobsData}
          onCancel={() => setAssigningSlot(null)}
          onContinue={(data) => handlePickJobRoundForBooking(assigningSlot, data)}
        />
      )}

      {showRecurringModal && (
        <RecurringAvailabilityModal
          isPending={publishBatchMutation.isPending}
          onCancel={() => setShowRecurringModal(false)}
          onSubmit={handleRecurringSubmit}
        />
      )}

      {detailPopover && (
        <SlotDetailPopover
          slot={detailPopover.slot}
          anchorRect={detailPopover.anchorRect}
          editable={editable}
          isBusy={unpublishMutation.isPending || rescheduleMutation.isPending}
          onClose={() => setDetailPopover(null)}
          onRemove={handleRemoveSlotFromPopover}
          onResize={(mins) => handleResizeSlot(detailPopover.slot.id, mins)}
          onReschedule={(date) => handleRescheduleSlot(detailPopover.slot.id, date)}
        />
      )}
    </div>
  );
}
