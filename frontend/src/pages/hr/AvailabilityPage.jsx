import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  startOfWeek, addDays, addWeeks, subWeeks, format, isSameDay,
  startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday,
} from 'date-fns';
import { ChevronLeft, ChevronRight, X, Loader2, Search, CalendarClock } from 'lucide-react';
import toast from 'react-hot-toast';
import { interviewSlotsApi } from '@/api/interviewSlots';
import { applicationsApi } from '@/api/applications';
import { usersApi } from '@/api/users';
import { useAuthStore } from '@/store/authStore';
import { HR_ROLES } from '@/utils/permissions';
import { ROUND_TYPES, ROUND_MAP } from '@/constants/interviewRounds';

const START_HOUR = 9;
const END_HOUR = 19; // exclusive
const SLOT_MINUTES = 30;
const ROWS = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;

function timeSlotsForDay(day) {
  return Array.from({ length: ROWS }, (_, i) => {
    const d = new Date(day);
    d.setHours(START_HOUR, i * SLOT_MINUTES, 0, 0);
    return d;
  });
}

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
];

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

// ── Week grid ──────────────────────────────────────────────────────────────────

// Slots can now span more than one 30-min row (30 or 60 min), so placement is
// explicit (gridRow/gridColumn) rather than relying on DOM-order auto-flow —
// a spanning block occupies its start row plus N-1 "covered" rows that render
// nothing, and every other row still gets its own clickable empty cell.
function buildDayLayout(day, slots) {
  const startRowMap = new Map(); // rowIdx -> { slot, span }
  const covered = new Set();

  (slots ?? [])
    .filter((s) => isSameDay(new Date(s.start_time), day))
    .forEach((s) => {
      const st = new Date(s.start_time);
      const minutesFromStart = (st.getHours() - START_HOUR) * 60 + st.getMinutes();
      const rowIdx = Math.round(minutesFromStart / SLOT_MINUTES);
      const span = Math.max(1, Math.round(s.duration_mins / SLOT_MINUTES));
      if (rowIdx < 0 || rowIdx >= ROWS) return; // outside the visible 9am-7pm window
      startRowMap.set(rowIdx, { slot: s, span });
      for (let r = rowIdx; r < rowIdx + span && r < ROWS; r++) covered.add(r);
    });

  return { startRowMap, covered };
}

function WeekGrid({ weekStart, slots, editable, onCellClick, onSlotClick }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const now = new Date();

  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-[720px] grid"
        style={{ gridTemplateColumns: '64px repeat(7, 1fr)', gridTemplateRows: `auto repeat(${ROWS}, 24px)` }}
      >
        <div style={{ gridRow: 1, gridColumn: 1 }} />
        {days.map((day, di) => (
          <div key={day.toISOString()} style={{ gridRow: 1, gridColumn: di + 2 }} className="text-center pb-2">
            <p className="text-xs text-gray-400 font-medium">{format(day, 'EEE')}</p>
            <p className={`text-sm font-semibold ${isToday(day) ? 'text-brand-600' : 'text-gray-800'}`}>
              {format(day, 'd')}
            </p>
          </div>
        ))}

        {Array.from({ length: ROWS }).map((_, rowIdx) => (
          <div key={`t-${rowIdx}`} style={{ gridRow: rowIdx + 2, gridColumn: 1 }} className="text-[10px] text-gray-400 text-right pr-2 -mt-2">
            {rowIdx % 2 === 0
              ? format(new Date(2000, 0, 1, START_HOUR + Math.floor(rowIdx / 2)), 'h a')
              : ''}
          </div>
        ))}

        {days.map((day, di) => {
          const { startRowMap, covered } = buildDayLayout(day, slots);
          const cellTimes = timeSlotsForDay(day);

          return Array.from({ length: ROWS }, (_, rowIdx) => {
            const gridRow = rowIdx + 2;
            const gridColumn = di + 2;

            if (startRowMap.has(rowIdx)) {
              const { slot, span } = startRowMap.get(rowIdx);
              const isPast = cellTimes[rowIdx] < now;
              return (
                <button
                  key={`slot-${slot.id}`}
                  disabled={isPast}
                  onClick={() => onSlotClick(slot)}
                  style={{ gridRow: `${gridRow} / span ${span}`, gridColumn }}
                  className={`border-t border-l border-surface-100 transition-colors ${
                    isPast
                      ? 'bg-surface-50 cursor-not-allowed'
                      : slot.status === 'booked'
                      ? 'bg-emerald-100 hover:bg-emerald-200 cursor-pointer'
                      : 'bg-brand-100 hover:bg-brand-200 cursor-pointer'
                  }`}
                  title={
                    slot.status === 'booked'
                      ? `Booked · ${slot.candidate_name ?? 'candidate'} (${ROUND_MAP[slot.round_type]?.label}, ${slot.duration_mins} min)`
                      : `Open · ${ROUND_MAP[slot.round_type]?.label} · ${slot.duration_mins} min`
                  }
                />
              );
            }
            if (covered.has(rowIdx)) return null;

            const isPast = cellTimes[rowIdx] < now;
            return (
              <button
                key={`empty-${di}-${rowIdx}`}
                disabled={isPast || !editable}
                onClick={() => onCellClick(cellTimes[rowIdx])}
                style={{ gridRow, gridColumn }}
                className={`border-t border-l border-surface-100 transition-colors ${
                  isPast ? 'bg-surface-50 cursor-not-allowed' : editable ? 'hover:bg-surface-100 cursor-pointer' : 'cursor-default'
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
  const [publishJobId, setPublishJobId] = useState('');
  const [publishRound, setPublishRound] = useState('tr1');
  const [publishDuration, setPublishDuration] = useState(30);
  const [selectedInterviewerId, setSelectedInterviewerId] = useState('');
  const [bookingSlot, setBookingSlot] = useState(null);
  // HR/Admin/Super Admin often conduct interviews themselves — the backend
  // already lets them call publish/mine/unpublish (see _HR_AND_INTERVIEWER in
  // interview_slots.py), this mode toggle is what actually exposes it in the UI
  // instead of always defaulting them into "book for someone else".
  const [hrMode, setHrMode] = useState('manage'); // 'manage' = book for an interviewer | 'own' = publish my own slots

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
    enabled: !!viewingInterviewerId,
  });

  const countsByDay = useMemo(() => {
    const map = new Map();
    (slots ?? []).forEach((s) => {
      const k = dayKeyLocal(new Date(s.start_time));
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return map;
  }, [slots]);

  const invalidateSlots = () =>
    queryClient.invalidateQueries({ queryKey: ['interview-slots', manageOwnSlots ? 'mine' : viewingInterviewerId] });

  const publishMutation = useMutation({
    mutationFn: (startTime) =>
      interviewSlotsApi.publish({
        job_id: publishJobId,
        round_type: publishRound,
        duration_mins: publishDuration,
        start_times: [startTime.toISOString()],
      }),
    onSuccess: (res) => {
      invalidateSlots();
      if (!res.data || res.data.length === 0) {
        toast.error('That time overlaps an existing slot on your calendar');
      }
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not publish slot'),
  });

  const unpublishMutation = useMutation({
    mutationFn: (id) => interviewSlotsApi.unpublish(id),
    onSuccess: invalidateSlots,
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not remove slot'),
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

  function handleCellClick(cellTime) {
    if (!editable) return;
    if (!publishJobId) {
      toast.error('Pick a job first');
      return;
    }
    publishMutation.mutate(cellTime);
  }

  function handleSlotClick(slot) {
    if (editable) {
      if (slot.status === 'open') unpublishMutation.mutate(slot.id);
      // booked slots aren't removable here — cancel the interview itself instead
      return;
    }
    if (isHR && slot.status === 'open') setBookingSlot(slot);
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-brand-500" />
            {manageOwnSlots ? 'My Availability' : 'Interviewer Availability'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {manageOwnSlots
              ? 'Publish free time — agencies and HR can book it for candidates.'
              : 'Pick an interviewer to see their published slots and book directly.'}
          </p>
        </div>
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
      </div>

      {isHR && (
        <div className="flex items-center gap-2 mb-4">
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
        </div>
      )}

      {isHR && hrMode === 'manage' && (
        <div className="mb-4">
          <select
            value={selectedInterviewerId}
            onChange={(e) => setSelectedInterviewerId(e.target.value)}
            className="text-sm border border-surface-300 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[220px]"
          >
            <option value="">Select an interviewer…</option>
            {interviewersData?.map((iv) => (
              <option key={iv.id} value={iv.id}>{iv.full_name}</option>
            ))}
          </select>
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-3 mb-4 bg-surface-50 border border-surface-200 rounded-xl p-3">
          <span className="text-xs font-medium text-gray-500">Publishing for:</span>
          <select
            value={publishJobId}
            onChange={(e) => setPublishJobId(e.target.value)}
            className="text-sm border border-surface-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Select a job…</option>
            {jobsData?.map((job) => (
              <option key={job.id} value={job.id}>{job.title}</option>
            ))}
          </select>
          <select
            value={publishRound}
            onChange={(e) => setPublishRound(e.target.value)}
            className="text-sm border border-surface-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {ROUND_TYPES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          <select
            value={publishDuration}
            onChange={(e) => setPublishDuration(Number(e.target.value))}
            className="text-sm border border-surface-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <span className="text-xs text-gray-400">Click an empty cell to publish a slot of the selected duration.</span>
        </div>
      )}

      {(!isHR || viewingInterviewerId) && (
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
              <WeekGrid
                weekStart={weekStart}
                slots={slots}
                editable={editable}
                onCellClick={handleCellClick}
                onSlotClick={handleSlotClick}
              />
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-brand-100 inline-block" /> Open</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-100 inline-block" /> Booked</span>
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
          isPending={bookMutation.isPending}
          onCancel={() => setBookingSlot(null)}
          onPick={(applicationId) => bookMutation.mutate({ slotId: bookingSlot.id, applicationId })}
        />
      )}
    </div>
  );
}
