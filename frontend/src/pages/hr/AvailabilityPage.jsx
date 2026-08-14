import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  startOfWeek, addDays, addWeeks, subWeeks, format, isSameDay,
  startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday,
} from 'date-fns';
import { ChevronLeft, ChevronRight, X, Loader2, Search, CalendarClock, Copy, Maximize2, Minimize2, BellRing } from 'lucide-react';
import toast from 'react-hot-toast';
import { interviewSlotsApi } from '@/api/interviewSlots';
import { applicationsApi } from '@/api/applications';
import { usersApi } from '@/api/users';
import { useAuthStore } from '@/store/authStore';
import { HR_ROLES } from '@/utils/permissions';
import { ROUND_TYPES, ROUND_MAP } from '@/constants/interviewRounds';

const SLOT_MINUTES = 30;
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 20; // exclusive — 8am–8pm default window
const FULL_START_HOUR = 0;
const FULL_END_HOUR = 24; // exclusive

// Interviewers no longer choose a duration when publishing — raw availability
// is always in fixed 60-min blocks. HR later assigns a job+round without
// touching duration.
const PUBLISH_DURATION_MINS = 60;

// Distinct-per-round colors for the grid only (kept local, not touching the
// shared ROUND_MAP badge colors used elsewhere — tr1/tr2 share one color
// there, but a calendar you're scanning benefits from telling them apart at a
// glance). "Booked" always wins and stays emerald regardless of round, so the
// existing open/booked mental model never breaks.
const GRID_ROUND_COLORS = {
  tr1: { bg: 'bg-sky-100', hover: 'hover:bg-sky-200', text: 'text-sky-800', dot: 'bg-sky-400' },
  tr2: { bg: 'bg-teal-100', hover: 'hover:bg-teal-200', text: 'text-teal-800', dot: 'bg-teal-400' },
  hr: { bg: 'bg-violet-100', hover: 'hover:bg-violet-200', text: 'text-violet-800', dot: 'bg-violet-400' },
};
const DEFAULT_GRID_COLOR = { bg: 'bg-brand-100', hover: 'hover:bg-brand-200', text: 'text-brand-800', dot: 'bg-brand-400' };
// Raw, interviewer-published availability with no job/round attached yet —
// deliberately neutral (not one of the round colors, not booked-green) so it
// reads as "needs attention" rather than "ready to book". Only ever shown to
// HR (job/round is their concept, not the interviewer's).
const UNASSIGNED_COLOR = { bg: 'bg-slate-200', hover: 'hover:bg-slate-300', text: 'text-slate-700', dot: 'bg-slate-400' };
// What an interviewer sees on their OWN calendar for any not-yet-booked slot,
// whether or not HR has quietly attached a job/round behind the scenes — an
// interviewer never needs to know "Technical Round 1" until it's a real,
// booked interview; showing that label on a slot HR might still reassign or
// an agency might never book is confusing, not informative. One calm color,
// one word: "Available". The round-by-round breakdown stays exclusive to
// HR's own management views, where it's an actual decision they're making.
const AVAILABLE_COLOR = { bg: 'bg-brand-100', hover: 'hover:bg-brand-200', text: 'text-brand-800', dot: 'bg-brand-400' };
const BOOKED_COLOR = { bg: 'bg-emerald-100', hover: 'hover:bg-emerald-200', text: 'text-emerald-800', dot: 'bg-emerald-400' };

function timeSlotsForDay(day, startHour, rows) {
  return Array.from({ length: rows }, (_, i) => {
    const d = new Date(day);
    d.setHours(startHour, i * SLOT_MINUTES, 0, 0);
    return d;
  });
}

// ── Application picker (HR booking a slot) ────────────────────────────────────

function ApplicationPickerModal({ jobId, onCancel, onPick, isPending }) {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['availability-job-applications', jobId, search],
    queryFn: () =>
      applicationsApi.list({ job_id: jobId, search: search || undefined, limit: 50 }).then((r) => r.data),
  });
  const applications = data?.items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900">Book this slot for…</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate…"
            className="w-full pl-9 pr-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="max-h-72 overflow-y-auto space-y-1">
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : applications.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No candidates found for this job</p>
          ) : (
            applications.map((app) => (
              <button
                key={app.id}
                disabled={isPending}
                onClick={() => onPick(app.id)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-50 disabled:opacity-50"
              >
                <p className="text-sm font-medium text-gray-900">{app.applicant?.full_name ?? 'Unknown'}</p>
                <p className="text-xs text-gray-400">{app.applicant?.email}</p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold text-gray-900">Book this slot</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          {format(new Date(slot.start_time), 'EEE, MMM d · h:mm a')} · {slot.duration_mins} min — which job and
          round is this interview for? You'll pick the candidate next.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Job</label>
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select a job…</option>
              {jobsData?.map((job) => (
                <option key={job.id} value={job.id}>{job.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Round</label>
            <select
              value={roundType}
              onChange={(e) => setRoundType(e.target.value)}
              className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {ROUND_TYPES.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:bg-surface-100 rounded-lg">
            Cancel
          </button>
          <button
            disabled={!jobId}
            onClick={() => onContinue({ job_id: jobId, round_type: roundType })}
            className="px-4 py-2 text-sm font-medium bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50"
          >
            Choose candidate
          </button>
        </div>
      </div>
    </div>
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
  slots, jobsData, onPublish, isPending, onUnassign, unassigningId,
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
      const key = format(new Date(s.start_time), 'EEEE, MMM d');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return map;
  }, [available]);

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allSelected = available.length > 0 && available.every((s) => selectedIds.has(s.id));
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(available.map((s) => s.id)));
  }

  async function handlePublish() {
    const ok = await onPublish({ slot_ids: Array.from(selectedIds), job_id: jobId, round_type: roundType });
    if (ok) setSelectedIds(new Set());
  }

  return (
    <div className="bg-white rounded-xl border border-surface-200 p-4">
      <div className="flex flex-wrap items-end gap-3 mb-4 pb-4 border-b border-surface-200">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Job</span>
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="text-sm border border-surface-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[180px]"
          >
            <option value="">Select a job…</option>
            {jobsData?.map((job) => (
              <option key={job.id} value={job.id}>{job.title}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Round</span>
          <select
            value={roundType}
            onChange={(e) => setRoundType(e.target.value)}
            className="text-sm border border-surface-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {ROUND_TYPES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </div>
        <button
          disabled={!jobId || selectedIds.size === 0 || isPending}
          onClick={handlePublish}
          className="ml-auto px-4 py-2 text-sm font-medium bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? 'Publishing…' : `Publish ${selectedIds.size || ''} slot${selectedIds.size === 1 ? '' : 's'}`}
        </button>
      </div>

      {available.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">
          {awaitingBooking.length > 0 ? 'Nothing new needs a job right now.' : 'No unpublished availability right now.'}
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-500 mb-2 cursor-pointer select-none">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-surface-300" />
            Select all ({available.length})
          </label>
          <div className="max-h-[28rem] overflow-y-auto divide-y divide-surface-100 border border-surface-100 rounded-lg">
            {Array.from(groups.entries()).map(([day, daySlots]) => (
              <div key={day}>
                <div className="bg-surface-50 px-3 py-1.5 text-xs font-semibold text-gray-500 sticky top-0">{day}</div>
                {daySlots.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-surface-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="rounded border-surface-300"
                    />
                    <span className="font-medium text-gray-800">{format(new Date(s.start_time), 'h:mm a')}</span>
                    <span className="text-gray-400">{s.duration_mins} min</span>
                    {s.interviewer_name && (
                      <span className="ml-auto text-xs text-gray-400 truncate">{s.interviewer_name}</span>
                    )}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {awaitingBooking.length > 0 && (
        <div className="mt-6 pt-4 border-t border-surface-200">
          <p className="text-xs font-medium text-gray-500 mb-2">
            Published, awaiting a booking ({awaitingBooking.length})
          </p>
          <div className="max-h-[16rem] overflow-y-auto divide-y divide-surface-100 border border-surface-100 rounded-lg">
            {awaitingBooking.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="font-medium text-gray-800">{format(new Date(s.start_time), 'EEE, MMM d · h:mm a')}</span>
                <span className="text-gray-400">{s.duration_mins} min</span>
                <span className="text-xs font-medium text-brand-700 bg-brand-50 rounded-full px-2 py-0.5">
                  {s.job_title ?? 'Job'} · {ROUND_MAP[s.round_type]?.label ?? s.round_type}
                </span>
                {s.interviewer_name && (
                  <span className="ml-auto text-xs text-gray-400 truncate">{s.interviewer_name}</span>
                )}
                <button
                  type="button"
                  disabled={unassigningId === s.id}
                  onClick={() => onUnassign(s)}
                  title="No agency has booked this — free it up to publish for a different job"
                  className="shrink-0 text-xs font-medium text-gray-500 hover:text-brand-600 disabled:opacity-60"
                >
                  {unassigningId === s.id ? 'Reusing…' : 'Reuse'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
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
    .filter((s) => isSameDay(new Date(s.start_time), day))
    .forEach((s) => {
      const st = new Date(s.start_time);
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
  weekStart, slots, editable, startHour, rows,
  onPublishRange, onSlotClick, onRemoveRange, onCopyDay, copyingDay,
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const now = new Date();

  // Drag state: which day column, the row range touched so far, and whether
  // this drag is painting new slots ('create') or sweeping open slots for
  // bulk removal ('remove') — decided by what the mouse went down on.
  const [drag, setDrag] = useState(null); // { dayIndex, startRow, endRow, mode }
  const draggingRef = useRef(null);
  draggingRef.current = drag;

  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      const d = draggingRef.current;
      draggingRef.current = null;
      setDrag(null);
      if (!d) return;
      const lo = Math.min(d.startRow, d.endRow);
      const hi = Math.max(d.startRow, d.endRow);
      if (d.mode === 'create') onPublishRange(days[d.dayIndex], lo, hi);
      else onRemoveRange(d.removedIds);
    };
    window.addEventListener('mouseup', finish, { once: true });
    return () => window.removeEventListener('mouseup', finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  function startCreateDrag(dayIndex, rowIdx) {
    if (!editable) return;
    setDrag({ dayIndex, startRow: rowIdx, endRow: rowIdx, mode: 'create' });
  }
  function startRemoveDrag(dayIndex, rowIdx, slotId) {
    if (!editable) return;
    setDrag({ dayIndex, startRow: rowIdx, endRow: rowIdx, mode: 'remove', removedIds: new Set([slotId]) });
  }
  function enterCell(dayIndex, rowIdx, coveredHere, slotAtRow) {
    setDrag((d) => {
      if (!d || d.dayIndex !== dayIndex) return d;
      const next = { ...d, endRow: rowIdx };
      if (d.mode === 'remove' && slotAtRow && slotAtRow.status === 'open') {
        next.removedIds = new Set(d.removedIds).add(slotAtRow.id);
      }
      return next;
    });
  }

  return (
    <div className="overflow-x-auto select-none">
      <div
        className="min-w-[760px] grid"
        style={{ gridTemplateColumns: '64px repeat(7, 1fr)', gridTemplateRows: `auto repeat(${rows}, 22px)` }}
      >
        <div style={{ gridRow: 1, gridColumn: 1 }} />
        {days.map((day, di) => {
          const { covered } = buildDayLayout(day, slots, startHour, rows);
          const hasOpenSlots = (slots ?? []).some((s) => isSameDay(new Date(s.start_time), day) && s.status === 'open');
          return (
            <div key={day.toISOString()} style={{ gridRow: 1, gridColumn: di + 2 }} className="text-center pb-2 px-0.5">
              <p className="text-xs text-gray-400 font-medium">{format(day, 'EEE')}</p>
              <p className={`text-sm font-semibold ${isToday(day) ? 'text-brand-600' : 'text-gray-800'}`}>
                {format(day, 'd')}
              </p>
              {editable && hasOpenSlots && covered.size > 0 && (
                <button
                  onClick={() => onCopyDay(day)}
                  disabled={copyingDay}
                  title="Copy this day's open slots to the same day next week"
                  className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-brand-600 disabled:opacity-40"
                >
                  <Copy className="w-2.5 h-2.5" /> copy
                </button>
              )}
            </div>
          );
        })}

        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={`t-${rowIdx}`} style={{ gridRow: rowIdx + 2, gridColumn: 1 }} className="text-[10px] text-gray-400 text-right pr-2 -mt-2">
            {rowIdx % 2 === 0
              ? format(new Date(2000, 0, 1, startHour + Math.floor(rowIdx / 2)), 'h a')
              : ''}
          </div>
        ))}

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
              const showLabel = span >= 2;
              // A booked slot is a no-op to click in every mode (real
              // interviews aren't cancelled from this grid) — it should read
              // as informational, not as an inviting, hoverable target.
              const interactive = !isBooked;
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
                  onClick={() => { if (!drag) onSlotClick(slot); }}
                  style={{ gridRow: `${gridRow} / span ${span}`, gridColumn }}
                  className={`relative border-t border-l border-surface-100 transition-colors flex flex-col items-start justify-center px-1 overflow-hidden ${
                    isPast
                      ? 'bg-surface-50 cursor-not-allowed'
                      : interactive
                      ? `${inRemoveDrag ? 'bg-rose-200 ring-1 ring-inset ring-rose-400' : `${color.bg} ${color.hover}`} cursor-pointer`
                      : `${color.bg} cursor-default`
                  }`}
                  title={
                    isBooked
                      ? `Booked · ${slot.candidate_name ?? 'candidate'} (${ROUND_MAP[slot.round_type]?.label}, ${slot.duration_mins} min)`
                      : editable
                      ? `Available · ${slot.duration_mins} min — drag to remove`
                      : isUnassigned
                      ? `Not published yet · ${slot.duration_mins} min — click to publish for agencies`
                      : `Open · ${ROUND_MAP[slot.round_type]?.label} · ${slot.duration_mins} min`
                  }
                >
                  {showLabel && (
                    <span className={`text-[10px] font-semibold leading-tight truncate w-full ${color.text}`}>
                      {isBooked
                        ? (slot.candidate_name ?? 'Booked')
                        : editable
                        ? 'Available'
                        : isUnassigned ? 'Unpublished' : (ROUND_MAP[slot.round_type]?.label ?? slot.round_type)}
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
                className={`border-t border-l border-surface-100 transition-colors ${
                  isPast
                    ? 'bg-surface-50 cursor-not-allowed'
                    : editable
                    ? `cursor-pointer ${inCreateDrag ? 'bg-brand-200 ring-1 ring-inset ring-brand-400' : 'hover:bg-surface-100'}`
                    : 'cursor-default'
                }`}
              />
            );
          });
        })}
      </div>
    </div>
  );
}

// ── Month summary (browse → jump into week) ───────────────────────────────────

function MonthGrid({ month, countsByDay, onDayClick }) {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const days = eachDayOfInterval({ start: startOfWeek(start), end: addDays(startOfWeek(end), 41) }).slice(0, 42);

  return (
    <div className="grid grid-cols-7 gap-1">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
        <div key={d} className="text-center text-xs font-medium text-gray-400 pb-1">{d}</div>
      ))}
      {days.map((day) => {
        const count = countsByDay.get(dayKeyLocal(day)) ?? 0;
        return (
          <button
            key={day.toISOString()}
            onClick={() => onDayClick(day)}
            className={`h-16 rounded-lg border p-1.5 text-left transition-colors ${
              isSameMonth(day, month) ? 'border-surface-200 hover:border-brand-300' : 'border-surface-100 text-gray-300'
            }`}
          >
            <span className={`text-xs ${isToday(day) ? 'font-bold text-brand-600' : 'text-gray-600'}`}>
              {format(day, 'd')}
            </span>
            {count > 0 && (
              <p className="text-[10px] mt-1 text-brand-600 font-medium">{count} slot{count !== 1 ? 's' : ''}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}

function dayKeyLocal(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AvailabilityPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isHR = HR_ROLES.includes(user?.role);

  const [view, setView] = useState('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [selectedInterviewerId, setSelectedInterviewerId] = useState('');
  const [bookingSlot, setBookingSlot] = useState(null);
  const [assigningSlot, setAssigningSlot] = useState(null);
  const [showFullDay, setShowFullDay] = useState(false);
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

  const { data: jobsData } = useQuery({
    queryKey: ['availability-publishable-jobs'],
    queryFn: () => interviewSlotsApi.publishableJobs().then((r) => r.data),
  });

  const { data: interviewersData } = useQuery({
    queryKey: ['interviewer-users'],
    queryFn: () => usersApi.list({ role: 'interviewer' }).then((r) => r.data),
    enabled: isHR,
  });

  const manageOwnSlots = !isHR || hrMode === 'own';
  const viewingInterviewerId = manageOwnSlots ? user?.id : selectedInterviewerId;
  const editable = manageOwnSlots; // publishing own slots vs. HR just booking someone else's

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

  // The single at-a-glance answer to "what are my slots, what's already
  // booked" — the whole reason someone opens this page — surfaced as plain
  // numbers right under the title instead of making the interviewer scan and
  // count colored cells across the whole calendar themselves.
  const upcomingStats = useMemo(() => {
    const now = new Date();
    const upcoming = (slots ?? []).filter((s) => new Date(s.start_time) >= now);
    return {
      available: upcoming.filter((s) => s.status === 'open').length,
      booked: upcoming.filter((s) => s.status === 'booked').length,
    };
  }, [slots]);

  const countsByDay = useMemo(() => {
    const map = new Map();
    (slots ?? []).forEach((s) => {
      const k = dayKeyLocal(new Date(s.start_time));
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return map;
  }, [slots]);

  // How many published slots this week fall outside the collapsed working-hours
  // window — surfaced as a banner rather than silently hidden, since collapsing
  // to 8am–8pm by default must never make real data disappear unnoticed.
  const hiddenOutsideWindow = useMemo(() => {
    if (showFullDay) return 0;
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return (slots ?? []).filter((s) => {
      const st = new Date(s.start_time);
      return weekDays.some((d) => isSameDay(d, st)) && (st.getHours() < WORK_START_HOUR || st.getHours() >= WORK_END_HOUR);
    }).length;
  }, [slots, weekStart, showFullDay]);

  // Surfaced to HR while browsing an interviewer's calendar — the "publish
  // for agencies" action only exists as a click target on individual slate
  // cells in the grid, which is easy to miss entirely if nothing points it
  // out first.
  const unassignedCountThisWeek = useMemo(() => {
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return (slots ?? []).filter((s) => {
      const st = new Date(s.start_time);
      return s.status === 'open' && !s.job_id && weekDays.some((d) => isSameDay(d, st));
    }).length;
  }, [slots, weekStart]);

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
    mutationFn: ({ jobId, roundType, durationMins, startTimes }) =>
      interviewSlotsApi.publish({
        job_id: jobId,
        round_type: roundType,
        duration_mins: durationMins,
        start_times: startTimes.map((d) => d.toISOString()),
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
      start_time: st.toISOString(),
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
    const daySlots = (slots ?? []).filter((s) => isSameDay(new Date(s.start_time), day) && s.status === 'open');
    if (daySlots.length === 0) return;
    const targetDay = addDays(day, 7);

    const groups = new Map(); // duration_mins -> [Date,...]
    for (const s of daySlots) {
      const st = new Date(s.start_time);
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
      else toast.success(`Copied to ${format(targetDay, 'EEE, MMM d')} as unassigned: ${totalCreated} slot${totalCreated !== 1 ? 's' : ''}${totalCreated < totalRequested ? ` (${totalRequested - totalCreated} skipped — already occupied)` : ''} — remember to publish for agencies`);
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Could not copy this day');
    } finally {
      setCopyingDay(false);
    }
  }

  function handleSlotClick(slot) {
    if (editable) return; // handled via drag-to-remove now
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

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-brand-500" />
            {manageOwnSlots ? 'My Availability' : hrMode === 'publish' ? 'Publish Slots to Agencies' : 'Interviewer Availability'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {manageOwnSlots
              ? 'Drag across the grid to mark yourself free — HR takes it from there.'
              : hrMode === 'publish'
              ? 'Pick an interviewer and a job, tick as many open slots as you like, and publish them all at once.'
              : 'Pick an interviewer, then click a slate slot to publish it for agencies (job & round), or book an already-published one directly.'}
          </p>
          {manageOwnSlots && !isLoading && (
            <div className="flex items-center gap-3 mt-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 bg-brand-50 rounded-full px-2.5 py-1">
                <span className={`w-1.5 h-1.5 rounded-full ${AVAILABLE_COLOR.dot}`} />
                {upcomingStats.available} available
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">
                <span className={`w-1.5 h-1.5 rounded-full ${BOOKED_COLOR.dot}`} />
                {upcomingStats.booked} booked
              </span>
            </div>
          )}
        </div>
        {hrMode !== 'publish' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('week')}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium ${view === 'week' ? 'bg-brand-500 text-white' : 'bg-white border border-surface-200 text-gray-600'}`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium ${view === 'month' ? 'bg-brand-500 text-white' : 'bg-white border border-surface-200 text-gray-600'}`}
            >
              Month
            </button>
          </div>
        )}
      </div>

      {isHR && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={() => setHrMode('own')}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium ${hrMode === 'own' ? 'bg-brand-500 text-white' : 'bg-white border border-surface-200 text-gray-600'}`}
          >
            My availability
          </button>
          <button
            onClick={() => setHrMode('manage')}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium ${hrMode === 'manage' ? 'bg-brand-500 text-white' : 'bg-white border border-surface-200 text-gray-600'}`}
          >
            Book for an interviewer
          </button>
          <button
            onClick={() => setHrMode('publish')}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium ${hrMode === 'publish' ? 'bg-brand-500 text-white' : 'bg-white border border-surface-200 text-gray-600'}`}
          >
            Publish slots to agencies
          </button>
        </div>
      )}

      {isHR && (hrMode === 'manage' || hrMode === 'publish') && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select
            value={selectedInterviewerId}
            onChange={(e) => setSelectedInterviewerId(e.target.value)}
            className="text-sm border border-surface-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[220px]"
          >
            <option value="">{hrMode === 'publish' ? 'All interviewers' : 'Select an interviewer…'}</option>
            {interviewersData?.map((iv) => (
              <option key={iv.id} value={iv.id}>{iv.full_name}</option>
            ))}
          </select>
          {hrMode === 'manage' && selectedInterviewerId && (
            <button
              onClick={() => requestPublishMutation.mutate(selectedInterviewerId)}
              disabled={requestPublishMutation.isPending}
              title="Send a reminder asking them to publish their free interview slots"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 disabled:opacity-50"
            >
              <BellRing className="w-4 h-4" />
              {requestPublishMutation.isPending ? 'Sending…' : 'Request availability'}
            </button>
          )}
        </div>
      )}

      {editable && (
        <div className="flex items-center gap-2.5 mb-4 bg-surface-50 border border-surface-200 rounded-xl p-3.5">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${AVAILABLE_COLOR.dot}`} />
          <span className="text-sm text-gray-600">
            Click a cell to mark one hour free, or drag across several at once. Drag across an
            available cell again to remove it — a <span className="font-medium text-emerald-700">booked</span> slot is locked in and can't be removed here.
          </span>
        </div>
      )}

      {isHR && hrMode === 'publish' && (
        publishableLoading ? (
          <div className="bg-white rounded-xl border border-surface-200 p-4 flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <PublishSlotsPanel
            slots={publishPanelSlots}
            jobsData={jobsData}
            onPublish={handlePublishBatch}
            isPending={assignBatchMutation.isPending}
            onUnassign={handleUnassignSlot}
            unassigningId={unassigningSlotId}
          />
        )
      )}

      {hrMode !== 'publish' && (!isHR || viewingInterviewerId) && (
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : view === 'week' ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setWeekStart(subWeeks(weekStart, 1))} className="p-1.5 rounded-lg hover:bg-surface-100">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <p className="text-sm font-semibold text-gray-800">
                  {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
                </p>
                <button onClick={() => setWeekStart(addWeeks(weekStart, 1))} className="p-1.5 rounded-lg hover:bg-surface-100">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {!editable && unassignedCountThisWeek > 0 && (
                <div className="w-full mb-3 flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-lg py-2 px-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${UNASSIGNED_COLOR.dot}`} />
                  {unassignedCountThisWeek} slot{unassignedCountThisWeek !== 1 ? 's' : ''} not yet published for agencies this week —
                  click a slate-colored slot below to pick its job &amp; round.
                </div>
              )}

              {hiddenOutsideWindow > 0 && (
                <button
                  onClick={() => setShowFullDay(true)}
                  className="w-full mb-3 flex items-center justify-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg py-2 hover:bg-amber-100"
                >
                  <Maximize2 className="w-3 h-3" />
                  {hiddenOutsideWindow} slot{hiddenOutsideWindow !== 1 ? 's' : ''} hidden outside 8 AM–8 PM — show full day
                </button>
              )}

              <WeekGrid
                weekStart={weekStart}
                slots={slots}
                editable={editable}
                startHour={startHour}
                rows={rows}
                onPublishRange={handlePublishRange}
                onSlotClick={handleSlotClick}
                onRemoveRange={handleRemoveRange}
                onCopyDay={handleCopyDay}
                copyingDay={copyingDay}
              />

              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                  {editable ? (
                    <>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 rounded inline-block ${AVAILABLE_COLOR.bg}`} />
                        Available
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 rounded inline-block ${BOOKED_COLOR.bg}`} />
                        Booked
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 rounded inline-block ${UNASSIGNED_COLOR.bg}`} />
                        Unassigned
                      </span>
                      {ROUND_TYPES.map((r) => (
                        <span key={r.key} className="flex items-center gap-1.5">
                          <span className={`w-3 h-3 rounded inline-block ${(GRID_ROUND_COLORS[r.key] ?? DEFAULT_GRID_COLOR).bg}`} />
                          {r.label}
                        </span>
                      ))}
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 rounded inline-block ${BOOKED_COLOR.bg}`} />
                        Booked
                      </span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setShowFullDay((v) => !v)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600"
                >
                  {showFullDay ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                  {showFullDay ? 'Show working hours only' : 'Show full day'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setMonthCursor(subWeeks(monthCursor, 4))} className="p-1.5 rounded-lg hover:bg-surface-100">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <p className="text-sm font-semibold text-gray-800">{format(monthCursor, 'MMMM yyyy')}</p>
                <button onClick={() => setMonthCursor(addWeeks(monthCursor, 4))} className="p-1.5 rounded-lg hover:bg-surface-100">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <MonthGrid
                month={monthCursor}
                countsByDay={countsByDay}
                onDayClick={(day) => { setWeekStart(startOfWeek(day)); setView('week'); }}
              />
            </>
          )}
        </div>
      )}

      {bookingSlot && (
        <ApplicationPickerModal
          jobId={bookingSlot.job_id}
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
    </div>
  );
}
