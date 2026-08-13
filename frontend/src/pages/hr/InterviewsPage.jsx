import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  format, parseISO, isToday, isTomorrow, isThisWeek, isSameDay,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay,
  addMonths, addWeeks, addDays,
} from 'date-fns';
import toast from 'react-hot-toast';
import {
  Calendar, CalendarDays, List, ChevronLeft, ChevronRight,
  UserCheck, CheckCircle2, Loader2, CalendarRange,
} from 'lucide-react';

import { interviewsApi } from '@/api/interviews';
import { useAuthStore } from '@/store/authStore';
import { HR_ROLES, ROLES } from '@/utils/permissions';
import MonthCalendar from '@/components/interviews/MonthCalendar';
import WeekCalendar from '@/components/interviews/WeekCalendar';
import InterviewCard from '@/components/interviews/InterviewCard';
import InterviewDetailDrawer from '@/components/interviews/InterviewDetailDrawer';
import CandidateDrawer from '@/components/interviews/CandidateDrawer';
import RescheduleDialog from '@/components/interviews/RescheduleDialog';
import { STATUS_STYLES, dayKey } from '@/components/interviews/calendarUtils';

const WEEK_STARTS_ON = 1;
const VIEW_KEY = 'nablon.interviews.view';
const FULL_DAY_KEY = 'nablon.interviews.fullDay';

const VIEWS = [
  { value: 'month', label: 'Month', icon: Calendar },
  { value: 'week',  label: 'Week',  icon: CalendarRange },
  { value: 'list',  label: 'List',  icon: List },
];

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'scheduled', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const LEGEND = ['scheduled', 'rescheduled', 'completed', 'cancelled'];

/** Visible window for the active view. The month grid spills into neighbouring
    weeks, so its range is the padded grid rather than the calendar month. */
function rangeFor(view, cursor) {
  if (view === 'month') {
    return {
      from: startOfWeek(startOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON }),
      to:   addDays(endOfWeek(endOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON }), 1),
    };
  }
  if (view === 'week') {
    const from = startOfWeek(cursor, { weekStartsOn: WEEK_STARTS_ON });
    return { from, to: addDays(from, 7) };
  }
  return null;
}

function dateGroupLabel(dateStr) {
  const d = parseISO(dateStr);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isThisWeek(d, { weekStartsOn: WEEK_STARTS_ON })) return format(d, 'EEEE');
  return format(d, 'MMMM d, yyyy');
}

function groupByDate(interviews) {
  const groups = {};
  interviews.forEach((interview) => {
    const key = dayKey(parseISO(interview.scheduled_at));
    if (!groups[key]) groups[key] = [];
    groups[key].push(interview);
  });
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex gap-1 bg-surface-100 rounded-xl p-1 max-w-full overflow-x-auto">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
            value === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {Icon && <Icon className="w-3.5 h-3.5" />}
          {label}
        </button>
      ))}
    </div>
  );
}

export default function InterviewsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isInterviewer = user?.role === ROLES.INTERVIEWER;
  const isHR = HR_ROLES.includes(user?.role);

  // Interviewers land on the list view scoped to upcoming interviews by default —
  // the calendar views are HR's scheduling tool, not what an interviewer needs first.
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) ?? (isInterviewer ? 'list' : 'month'));
  const [fullDay, setFullDay] = useState(() => localStorage.getItem(FULL_DAY_KEY) === '1');
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [scope, setScope] = useState('all');
  const [statusFilter, setStatusFilter] = useState(() => (isInterviewer ? 'scheduled' : ''));
  const [page, setPage] = useState(1);

  const [activeInterviewId, setActiveInterviewId] = useState(null);
  const [rescheduleFor, setRescheduleFor] = useState(null);
  const [confirmCompleteId, setConfirmCompleteId] = useState(null);
  const [candidateDrawerAppId, setCandidateDrawerAppId] = useState(null);

  const canComplete = isHR || isInterviewer;
  const canCancel = isHR;
  const effectiveScope = isInterviewer ? 'mine' : scope;

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);
  useEffect(() => { localStorage.setItem(FULL_DAY_KEY, fullDay ? '1' : '0'); }, [fullDay]);

  const range = useMemo(() => rangeFor(view, cursor), [view, cursor]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: [
      'hr-interviews',
      {
        scope: effectiveScope,
        status: statusFilter,
        from: range?.from.toISOString() ?? null,
        to: range?.to.toISOString() ?? null,
        page: range ? 1 : page,
      },
    ],
    queryFn: () => {
      const params = { status: statusFilter || undefined };
      if (range) {
        // Calendar views render a fixed window, so pull it whole instead of paging.
        params.date_from = range.from.toISOString();
        params.date_to = range.to.toISOString();
        params.limit = 500;
      } else {
        params.page = page;
        params.limit = 50;
      }
      const fn = effectiveScope === 'mine' ? interviewsApi.mine : interviewsApi.list;
      return fn(params).then((r) => r.data);
    },
    keepPreviousData: true,
  });

  const interviews = useMemo(() => data?.items ?? [], [data]);

  const completeMut = useMutation({
    mutationFn: (id) => interviewsApi.complete(id),
    onSuccess: () => {
      setConfirmCompleteId(null);
      toast.success('Interview marked as completed');
      qc.invalidateQueries({ queryKey: ['hr-interviews'] });
      qc.invalidateQueries({ queryKey: ['application-interviews'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to complete interview'),
  });

  /* Track the drawer by id so it re-reads from the refreshed list after a
     complete or a feedback submission, rather than showing a stale snapshot. */
  const activeInterview = useMemo(
    () => interviews.find((iv) => iv.id === activeInterviewId) ?? null,
    [interviews, activeInterviewId],
  );

  const selectedDayInterviews = useMemo(
    () => interviews.filter((iv) => isSameDay(parseISO(iv.scheduled_at), selectedDay)),
    [interviews, selectedDay],
  );

  const legendCounts = useMemo(() => {
    const counts = {};
    interviews.forEach((iv) => { counts[iv.status] = (counts[iv.status] ?? 0) + 1; });
    return counts;
  }, [interviews]);

  const step = (direction) => {
    if (view === 'month') setCursor((c) => addMonths(c, direction));
    else if (view === 'week') setCursor((c) => addWeeks(c, direction));
  };

  const goToday = () => {
    const today = new Date();
    setCursor(today);
    setSelectedDay(startOfDay(today));
  };

  /* Arrow keys page through the calendar, as long as focus isn't in a field. */
  useEffect(() => {
    if (view === 'list') return undefined;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 't' || e.key === 'T') goToday();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const rangeLabel = useMemo(() => {
    if (view === 'month') return format(cursor, 'MMMM yyyy');
    if (view === 'week') {
      const from = startOfWeek(cursor, { weekStartsOn: WEEK_STARTS_ON });
      const to = addDays(from, 6);
      const sameMonth = from.getMonth() === to.getMonth();
      return sameMonth
        ? `${format(from, 'MMM d')} – ${format(to, 'd, yyyy')}`
        : `${format(from, 'MMM d')} – ${format(to, 'MMM d, yyyy')}`;
    }
    return null;
  }, [view, cursor]);

  const openCandidate = (applicationId) => {
    // Interviewers get the full read-only application page directly — the
    // sidebar drawer only shows a stripped-down summary and is HR-only now.
    if (isInterviewer) {
      navigate(`/hr/applicants/${applicationId}`);
      return;
    }
    setActiveInterviewId(null);
    setCandidateDrawerAppId(applicationId);
  };

  // Month/week grids select an interview (opening InterviewDetailDrawer for HR)
  // — interviewers skip that hop and go straight to the application page.
  const selectInterview = (iv) => {
    if (isInterviewer) {
      navigate(`/hr/applicants/${iv.application_id}`);
      return;
    }
    setActiveInterviewId(iv.id);
  };

  const grouped = groupByDate(interviews);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">Interviews</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {view === 'list'
              ? `${data?.total ?? 0} interview${data?.total !== 1 ? 's' : ''}`
              : `${interviews.length} scheduled in this ${view}`}
            {isFetching && <span className="text-gray-300"> · updating…</span>}
          </p>
        </div>
        <SegmentedControl options={VIEWS} value={view} onChange={setView} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          {view !== 'list' && (
            <>
              <div className="flex items-center rounded-xl border border-surface-200 bg-white overflow-hidden">
                <button
                  onClick={() => step(-1)}
                  aria-label="Previous"
                  className="p-2 text-gray-500 hover:bg-surface-50 hover:text-gray-800 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="w-px h-5 bg-surface-200" />
                <button
                  onClick={() => step(1)}
                  aria-label="Next"
                  className="p-2 text-gray-500 hover:bg-surface-50 hover:text-gray-800 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={goToday}
                className="px-3 py-2 rounded-xl border border-surface-200 bg-white text-sm font-medium text-gray-700 hover:bg-surface-50 transition-colors"
              >
                Today
              </button>
              <h2 className="font-display text-lg font-bold text-gray-900 ml-1">{rangeLabel}</h2>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isInterviewer && (
            <SegmentedControl
              options={[
                { value: 'all', label: 'All' },
                { value: 'mine', label: 'Mine', icon: UserCheck },
              ]}
              value={scope}
              onChange={(v) => { setScope(v); setPage(1); }}
            />
          )}
          <SegmentedControl
            options={STATUS_TABS}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
          />
        </div>
      </div>

      {/* Legend */}
      {view !== 'list' && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {LEGEND.map((status) => (
              <span key={status} className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className={`w-2 h-2 rounded-full ${STATUS_STYLES[status].dot}`} />
                {STATUS_STYLES[status].label}
                {legendCounts[status] > 0 && (
                  <span className="font-semibold text-gray-700 tabular-nums">{legendCounts[status]}</span>
                )}
              </span>
            ))}
          </div>

          {view === 'week' && (
            <SegmentedControl
              options={[
                { value: 'work', label: 'Work hours' },
                { value: 'full', label: '24 hours' },
              ]}
              value={fullDay ? 'full' : 'work'}
              onChange={(v) => setFullDay(v === 'full')}
            />
          )}
        </div>
      )}

      {/* Views */}
      {isLoading ? (
        <div className="h-[60vh] bg-surface-100 rounded-2xl animate-pulse" />
      ) : view === 'month' ? (
        <>
          <MonthCalendar
            month={cursor}
            interviews={interviews}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onExpandDay={setSelectedDay}
            onSelectInterview={selectInterview}
          />

          {/* Selected day detail — full cards with actions, without leaving the grid */}
          <div className="mt-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
              <CalendarDays className="w-4 h-4 text-gray-400" />
              {format(selectedDay, 'EEEE, MMMM d')}
              <span className="text-gray-300">·</span>
              <span className="font-normal text-gray-400">
                {selectedDayInterviews.length} interview{selectedDayInterviews.length !== 1 ? 's' : ''}
              </span>
            </h3>
            {selectedDayInterviews.length === 0 ? (
              <p className="text-sm text-gray-400 bg-surface-50 border border-surface-200 rounded-xl px-4 py-6 text-center">
                Nothing scheduled on this day.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedDayInterviews.map((interview) => (
                  <InterviewCard
                    key={interview.id}
                    interview={interview}
                    onCandidateClick={openCandidate}
                    canComplete={canComplete}
                    canCancel={canCancel}
                    onComplete={setConfirmCompleteId}
                    onReschedule={setRescheduleFor}
                    onRefetch={refetch}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : view === 'week' ? (
        <WeekCalendar
          weekStart={startOfWeek(cursor, { weekStartsOn: WEEK_STARTS_ON })}
          interviews={interviews}
          selectedInterviewId={activeInterviewId}
          onSelectInterview={selectInterview}
          fullDay={fullDay}
        />
      ) : grouped.length === 0 ? (
        <div className="text-center py-20">
          <Calendar className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            {statusFilter === 'scheduled' ? 'No upcoming interviews'
              : statusFilter ? `No ${statusFilter} interviews`
              : 'No interviews found'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([key, dayInterviews]) => (
            <div key={key}>
              <h2 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {dateGroupLabel(dayInterviews[0].scheduled_at)}
                <span className="text-gray-300 font-normal">·</span>
                <span className="text-gray-400 font-normal">
                  {format(parseISO(dayInterviews[0].scheduled_at), 'MMMM d')}
                </span>
              </h2>
              <div className="space-y-3">
                {dayInterviews.map((interview) => (
                  <InterviewCard
                    key={interview.id}
                    interview={interview}
                    onCandidateClick={openCandidate}
                    canComplete={canComplete}
                    canCancel={canCancel}
                    onComplete={setConfirmCompleteId}
                    onReschedule={setRescheduleFor}
                    onRefetch={refetch}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination — list view only; calendars fetch their whole window */}
      {view === 'list' && data && data.pages > 1 && (
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">{page} / {data.pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {activeInterview && (
        <InterviewDetailDrawer
          interview={activeInterview}
          canComplete={canComplete}
          canCancel={canCancel}
          onComplete={setConfirmCompleteId}
          onReschedule={setRescheduleFor}
          onRefetch={refetch}
          onViewCandidate={openCandidate}
          onClose={() => setActiveInterviewId(null)}
        />
      )}

      {rescheduleFor && (
        <RescheduleDialog
          interview={rescheduleFor}
          onClose={() => setRescheduleFor(null)}
          onSuccess={() => { setRescheduleFor(null); refetch(); }}
        />
      )}

      {candidateDrawerAppId && (
        <CandidateDrawer
          applicationId={candidateDrawerAppId}
          isHR={isHR}
          onClose={() => setCandidateDrawerAppId(null)}
        />
      )}

      {confirmCompleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setConfirmCompleteId(null)} />
          <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-sm z-10 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-gray-900">Mark interview as completed?</h3>
                <p className="text-sm text-gray-500 mt-0.5">This will update the interview status to completed.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmCompleteId(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => completeMut.mutate(confirmCompleteId)}
                disabled={completeMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                {completeMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Yes, complete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
