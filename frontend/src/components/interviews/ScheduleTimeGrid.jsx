import { useMemo } from 'react';
import { format, addMinutes, isSameDay } from 'date-fns';
import { Loader2, Sparkles, Users } from 'lucide-react';

const ROW_H = 36;
const HEADER_H = 20;
const LABEL_W = '11rem';
const SNAP_MINS = 15;
const MAX_SUGGESTIONS = 8;

const BUSY_STYLES = {
  interview: 'bg-rose-400/80',
  busy:      'bg-rose-400/80',
  tentative: 'bg-amber-300/80',
  oof:       'bg-gray-300',
};

const BUSY_LABELS = {
  interview: 'Interview',
  busy:      'Busy',
  tentative: 'Tentative',
  oof:       'Out of office',
};

/** Collapse overlapping/touching intervals into a minimal set. */
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach((cur) => {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push({ ...cur });
  });
  return merged;
}

/** Gaps between merged busy intervals — the windows where nobody is booked. */
function invertIntervals(busy, from, to) {
  const free = [];
  let cursor = from;
  busy.forEach(({ start, end }) => {
    if (start > cursor) free.push({ start: cursor, end: Math.min(start, to) });
    cursor = Math.max(cursor, end);
  });
  if (cursor < to) free.push({ start: cursor, end: to });
  return free.filter((f) => f.end > f.start);
}

/**
 * Start times where every panelist is free for the full duration.
 *
 * Walks the free windows and takes one slot per duration-length step, so the
 * suggestions read as a short list of distinct options (9:00, 10:00, 11:00)
 * rather than every 15-minute offset inside the same gap.
 */
function suggestSlots(freeWindows, durationMs, notBefore) {
  const slots = [];
  freeWindows.forEach((window) => {
    let start = Math.max(window.start, notBefore);
    const snap = SNAP_MINS * 60_000;
    start = Math.ceil(start / snap) * snap;
    while (start + durationMs <= window.end && slots.length < MAX_SUGGESTIONS) {
      slots.push(start);
      start += durationMs;
    }
  });
  return slots.slice(0, MAX_SUGGESTIONS);
}

export default function ScheduleTimeGrid({
  panelists,
  busyByPanelist,
  dayStart,
  dayEnd,
  durationMins,
  selectedStart,
  onPick,
  loading,
}) {
  const windowStart = dayStart.getTime();
  const windowEnd = dayEnd.getTime();
  const span = windowEnd - windowStart;
  const durationMs = (durationMins || 60) * 60_000;

  const pct = (ms) => Math.min(100, Math.max(0, ((ms - windowStart) / span) * 100));

  const hours = useMemo(() => {
    const out = [];
    for (let t = windowStart; t < windowEnd; t += 3_600_000) out.push(t);
    return out;
  }, [windowStart, windowEnd]);

  // Gridlines stay hourly regardless of span — they're thin dividers, cheap to
  // pack in. Text labels aren't: cramming 24 of them into the same width just
  // overlaps into unreadable mush, so thin those out to roughly a dozen labels
  // no matter how wide the window is (2hr steps for a full day, hourly for a
  // half day, etc).
  const labelStep = Math.max(1, Math.ceil(hours.length / 12));

  /* Everyone's bookings folded together: the busy union drives both the
     "all free" lane and the suggested slots, so they can never disagree. */
  const { freeWindows, busyUnion } = useMemo(() => {
    const all = panelists.flatMap((p) =>
      (busyByPanelist[p.id] ?? []).map((b) => ({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime(),
      })),
    );
    const union = mergeIntervals(all);
    return { busyUnion: union, freeWindows: invertIntervals(union, windowStart, windowEnd) };
  }, [panelists, busyByPanelist, windowStart, windowEnd]);

  const suggestions = useMemo(() => {
    const now = Date.now();
    const notBefore = isSameDay(dayStart, new Date()) ? Math.max(windowStart, now) : windowStart;
    return suggestSlots(freeWindows, durationMs, notBefore);
  }, [freeWindows, durationMs, dayStart, windowStart]);

  const selectedMs = selectedStart?.getTime() ?? null;
  const selectedEndMs = selectedMs != null ? selectedMs + durationMs : null;
  const hasConflict = selectedMs != null &&
    busyUnion.some((b) => b.start < selectedEndMs && b.end > selectedMs);

  const pickFromClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const snap = SNAP_MINS * 60_000;
    onPick(new Date(Math.round((windowStart + ratio * span) / snap) * snap));
  };

  const gridLines = hours.map((t) => (
    <div
      key={t}
      style={{ left: `${pct(t)}%` }}
      className="absolute top-0 bottom-0 border-l border-surface-200/80"
    />
  ));

  if (panelists.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-surface-300 bg-surface-50 px-4 py-8 text-center">
        <Users className="w-6 h-6 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">Add interviewers to see their availability.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-200 bg-surface-50">
        <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
          Availability
          {loading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
        </p>
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400/70" /> Free</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400/80" /> Busy</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-300/80" /> Tentative</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300" /> OOF</span>
        </div>
      </div>

      <div className="flex p-3 gap-2">
        {/* Row labels */}
        <div className="flex-shrink-0" style={{ width: LABEL_W }}>
          <div style={{ height: HEADER_H }} />
          <div style={{ height: ROW_H }} className="flex items-center">
            <span className="text-xs font-semibold text-gray-700">Everyone free</span>
          </div>
          {panelists.map((p) => (
            <div key={p.id} style={{ height: ROW_H }} className="flex items-center gap-1.5 min-w-0">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-semibold flex items-center justify-center flex-shrink-0">
                {p.full_name.charAt(0).toUpperCase()}
              </span>
              <span className="text-xs text-gray-700 truncate">{p.full_name}</span>
            </div>
          ))}
        </div>

        {/* Tracks */}
        <div className="flex-1 min-w-0">
          {/* Hour ruler */}
          <div className="relative" style={{ height: HEADER_H }}>
            {hours.map((t, i) => (
              i % labelStep === 0 && (
                <span
                  key={t}
                  style={{ left: `${pct(t)}%` }}
                  className="absolute top-0 -translate-x-1/2 text-[10px] text-gray-400 tabular-nums whitespace-nowrap"
                >
                  {format(new Date(t), 'h a')}
                </span>
              )
            ))}
          </div>

          <div className="relative">
            {/* All-free lane */}
            <div style={{ height: ROW_H }} className="flex items-center">
              <div
                onClick={pickFromClick}
                title="Click to pick a time"
                className="relative w-full h-6 rounded-md bg-surface-100 overflow-hidden cursor-pointer"
              >
                {gridLines}
                {freeWindows.map((w) => (
                  <div
                    key={w.start}
                    style={{ left: `${pct(w.start)}%`, width: `${Math.max(0.6, pct(w.end) - pct(w.start))}%` }}
                    className="absolute inset-y-0 bg-emerald-400/60"
                  />
                ))}
              </div>
            </div>

            {/* One track per interviewer */}
            {panelists.map((p) => (
              <div key={p.id} style={{ height: ROW_H }} className="flex items-center">
                <div
                  onClick={pickFromClick}
                  title="Click to pick a time"
                  className="relative w-full h-6 rounded-md bg-surface-50 overflow-hidden cursor-pointer"
                >
                  {gridLines}
                  {(busyByPanelist[p.id] ?? []).map((b, i) => {
                    const start = new Date(b.start).getTime();
                    const end = new Date(b.end).getTime();
                    return (
                      <div
                        key={i}
                        title={`${BUSY_LABELS[b.status] ?? 'Busy'} · ${format(new Date(start), 'h:mm a')}–${format(new Date(end), 'h:mm a')}`}
                        style={{ left: `${pct(start)}%`, width: `${Math.max(0.6, pct(end) - pct(start))}%` }}
                        className={`absolute inset-y-0 ${BUSY_STYLES[b.status] ?? BUSY_STYLES.busy}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Proposed slot, drawn across every row so conflicts are obvious */}
            {selectedMs != null && (
              <div
                style={{
                  left: `${pct(selectedMs)}%`,
                  width: `${Math.max(0.8, pct(selectedEndMs) - pct(selectedMs))}%`,
                }}
                className={`absolute inset-y-0 rounded-md border-2 pointer-events-none ${
                  hasConflict ? 'border-rose-500 bg-rose-500/10' : 'border-brand-600 bg-brand-500/10'
                }`}
              />
            )}
          </div>
        </div>
      </div>

      {/* Suggested slots */}
      <div className="px-3 pb-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 mb-1.5">
          <Sparkles className="w-3 h-3 text-brand-500" />
          Open slots for everyone
        </p>
        {suggestions.length === 0 ? (
          <p className="text-xs text-gray-400">
            No {durationMins}-minute window works for the whole panel on this day.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((ms) => {
              const active = ms === selectedMs;
              return (
                <button
                  key={ms}
                  type="button"
                  onClick={() => onPick(new Date(ms))}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium tabular-nums border transition-colors ${
                    active
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'bg-white border-surface-300 text-gray-700 hover:border-brand-400 hover:text-brand-600'
                  }`}
                >
                  {format(new Date(ms), 'h:mm a')}
                  <span className={active ? 'text-white/70' : 'text-gray-400'}>
                    {' '}– {format(addMinutes(new Date(ms), durationMins || 60), 'h:mm a')}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
