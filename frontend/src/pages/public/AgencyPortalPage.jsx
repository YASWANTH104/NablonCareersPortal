import { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Building2, ChevronLeft, Users, Clock, UserPlus, Briefcase,
  CalendarClock, CalendarX, Loader2, Info, Search, Check, Send, Award,
  AlertCircle, ShieldCheck, Hourglass, LifeBuoy, Sparkles, ArrowRight, Link2,
} from 'lucide-react';
import { formatDistanceToNow, isSameDay, addDays } from 'date-fns';
import { agenciesApi } from '@/api/agencies';
import CandidateIntakeForm from '@/components/shared/CandidateIntakeForm';
import CopyLink from '@/components/shared/CopyLink';
import PipelineFunnel, { QuotaMeter } from '@/components/shared/PipelineFunnel';
import { ROUND_MAP } from '@/constants/interviewRounds';
import { toIST, formatIST } from '@/utils/formatters';
import { Modal, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';

const STAGE_LABELS = {
  applied: 'Applied',
  screening: 'Screening',
  assessment: 'Assessment',
  tr1: 'Technical Round 1',
  tr2: 'Technical Round 2',
  hr: 'HR Interview',
  offer: 'Offer Extended',
  hired: 'Hired',
  rejected: 'Not Proceeding',
  withdrawn: 'Withdrawn',
  interview_drop: 'Not Proceeding',
  offer_drop: 'Not Proceeding',
};

const STAGE_COLORS = {
  applied: 'bg-blue-50 text-blue-700 border-blue-200',
  screening: 'bg-purple-50 text-purple-700 border-purple-200',
  assessment: 'bg-orange-50 text-orange-700 border-orange-200',
  tr1: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  tr2: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  hr: 'bg-violet-50 text-violet-700 border-violet-200',
  offer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  hired: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  withdrawn: 'bg-surface-100 text-gray-500 border-surface-200',
  interview_drop: 'bg-rose-50 text-rose-700 border-rose-200',
  offer_drop: 'bg-rose-50 text-rose-700 border-rose-200',
};

const TERMINAL_STAGES = new Set(['rejected', 'withdrawn', 'interview_drop', 'offer_drop']);

function StageBadge({ stage }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap',
        STAGE_COLORS[stage] ?? 'bg-surface-100 text-gray-600 border-surface-200'
      )}
    >
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

function initials(name) {
  return (name ?? '?').trim().split(/\s+/).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('');
}

function assignmentState(a) {
  const expiresAt = a?.expires_at ? new Date(a.expires_at) : null;
  const expired = Boolean(expiresAt && expiresAt < new Date());
  const capped = Boolean(a?.max_submissions) && (a?.submission_count ?? 0) >= a.max_submissions;
  return { expiresAt, expired, capped, blocked: expired || capped };
}

function SectionTitle({ icon: Icon, title, count, hint, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className="w-4 h-4 text-gray-400 shrink-0" />}
        <h3 className="font-display text-sm font-bold text-gray-900">{title}</h3>
        {count != null && (
          <span className="text-xs font-semibold text-gray-500 bg-surface-100 rounded-full px-2 py-0.5">{count}</span>
        )}
        {hint && <span className="text-[11px] text-gray-400 hidden sm:inline">· {hint}</span>}
      </div>
      {action}
    </div>
  );
}

function SidebarCard({ icon: Icon, title, children, className }) {
  return (
    <section className={cn('bg-white rounded-2xl border border-surface-200 p-4', className)}>
      {title && (
        <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-gray-900 mb-3">
          {Icon && <Icon className="w-4 h-4 text-brand-500" />}
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

// ── Submit candidate ──────────────────────────────────────────────────────────

function SubmitCandidateModal({ portalToken, assignmentId, jobTitle, onClose }) {
  const queryClient = useQueryClient();

  const handleSubmit = async (payload) => {
    try {
      await agenciesApi.portalSubmitCandidate(portalToken, assignmentId, payload);
      toast.success('Candidate submitted — the hiring team can see them now.');
      queryClient.invalidateQueries({ queryKey: ['agency-portal-assignment', portalToken, assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['agency-portal', portalToken] });
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Submission failed. Please try again.');
      throw err;
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Submit a candidate"
      description={jobTitle}
      icon={UserPlus}
      size="lg"
      closeOnBackdrop={false}
    >
      <div className="flex gap-2.5 text-xs text-gray-600 bg-brand-50/60 border border-brand-100 rounded-xl p-3 mb-4">
        <Sparkles className="w-4 h-4 text-brand-500 shrink-0 mt-px" />
        <p>
          Drop the resume in first — we read it and pre-fill everything we can, so you only check the details
          and add what’s missing.
        </p>
      </div>
      <CandidateIntakeForm
        onParse={(file) => agenciesApi.portalParseResume(portalToken, file)}
        onSubmit={handleSubmit}
        submitLabel="Submit candidate"
      />
    </Modal>
  );
}

// ── Book a slot ───────────────────────────────────────────────────────────────

function BookSlotModal({ slot, candidates, onCancel, onPick, isPending }) {
  const [selectedId, setSelectedId] = useState(null);
  const bookable = candidates.filter((c) => !TERMINAL_STAGES.has(c.stage));

  return (
    <Modal
      onClose={onCancel}
      title="Confirm this interview"
      description={`${formatIST(slot.start_time, 'EEEE d MMMM')} · ${formatIST(slot.start_time, 'h:mm a')} IST`}
      icon={CalendarClock}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={() => selectedId && onPick(selectedId)}
            disabled={!selectedId || isPending}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {isPending ? 'Booking…' : 'Confirm booking'}
          </button>
        </div>
      }
    >
      <div className="flex items-center gap-3 rounded-xl bg-brand-50/60 border border-brand-100 p-3.5 mb-5">
        <div className="text-center shrink-0 px-3 py-1.5 rounded-lg bg-white border border-brand-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-brand-500">
            {formatIST(slot.start_time, 'MMM')}
          </p>
          <p className="font-display text-xl font-bold text-gray-900 leading-none">
            {formatIST(slot.start_time, 'd')}
          </p>
        </div>
        <div className="min-w-0">
          <p className="font-display text-base font-bold text-gray-900 tabular-nums">
            {formatIST(slot.start_time, 'h:mm a')} <span className="text-xs font-medium text-gray-400">IST</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {ROUND_MAP[slot.round_type]?.label ?? slot.round_type} · {slot.duration_mins} minutes
          </p>
        </div>
      </div>

      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Who is this for?</p>
      {bookable.length === 0 ? (
        <EmptyState
          compact
          icon={Users}
          title={candidates.length === 0 ? 'No candidates submitted yet' : 'Nobody is still in progress'}
          description={
            candidates.length === 0
              ? 'Submit a candidate for this role first, then you can book them an interview.'
              : 'Everyone you’ve submitted for this role has already been closed out.'
          }
        />
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1.5 -mx-1 px-1">
          {bookable.map((c) => (
            <button
              key={c.application_id}
              disabled={isPending}
              onClick={() => setSelectedId(c.application_id)}
              className={cn(
                'w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl border transition-all disabled:opacity-50',
                selectedId === c.application_id
                  ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100'
                  : 'border-surface-200 hover:border-brand-200 hover:bg-surface-50'
              )}
            >
              <span className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-[11px] font-bold text-brand-700 shrink-0">
                {initials(c.candidate_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 truncate">{c.candidate_name}</span>
                <span className="block text-[11px] text-gray-400">{STAGE_LABELS[c.stage] ?? c.stage}</span>
              </span>
              {selectedId === c.application_id && <Check className="w-4 h-4 text-brand-500 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Slot picker ───────────────────────────────────────────────────────────────
//
// Day tabs then time chips, rather than one long scrolling list of every slot
// on every date. Slot instants are UTC; everything here is rendered on the IST
// wall clock and labelled as such, because an external partner is very often
// not in IST and "3:00 PM" with no zone is how a candidate misses an interview.

function groupSlotsByDay(slots) {
  const istToday = toIST(new Date());
  const istTomorrow = addDays(istToday, 1);
  const groups = [];
  (slots ?? []).forEach((slot) => {
    const day = toIST(slot.start_time);
    let group = groups.find((g) => isSameDay(g.day, day));
    if (!group) {
      group = {
        key: formatIST(slot.start_time, 'yyyy-MM-dd'),
        day,
        short: isSameDay(day, istToday)
          ? 'Today'
          : isSameDay(day, istTomorrow)
          ? 'Tomorrow'
          : formatIST(slot.start_time, 'EEE d MMM'),
        long: formatIST(slot.start_time, 'EEEE d MMMM'),
        slots: [],
      };
      groups.push(group);
    }
    group.slots.push(slot);
  });
  groups.sort((a, b) => a.day - b.day);
  groups.forEach((g) => g.slots.sort((a, b) => new Date(a.start_time) - new Date(b.start_time)));
  return groups;
}

function SlotPicker({ portalToken, assignmentId, candidates, disabled }) {
  const queryClient = useQueryClient();
  const [bookingSlot, setBookingSlot] = useState(null);
  const [activeDay, setActiveDay] = useState(null);

  const { data: slots, isLoading } = useQuery({
    queryKey: ['agency-portal-slots', portalToken, assignmentId],
    queryFn: () => agenciesApi.portalAvailableSlots(portalToken, assignmentId).then((r) => r.data),
    enabled: !disabled,
    // HR can book one of these directly (e.g. for an internal candidate) at any
    // time, and this page has no push channel — polling is what stops a
    // just-taken slot sitting here looking bookable.
    refetchInterval: 20000,
  });

  const days = useMemo(() => groupSlotsByDay(slots), [slots]);

  // Keep the selected day valid across refetches: if the day someone is looking
  // at empties out, fall back to the first one that still has slots.
  useEffect(() => {
    if (days.length === 0) { setActiveDay(null); return; }
    if (!activeDay || !days.some((d) => d.key === activeDay)) setActiveDay(days[0].key);
  }, [days, activeDay]);

  const bookMutation = useMutation({
    mutationFn: (applicationId) =>
      agenciesApi.portalBookSlot(portalToken, assignmentId, {
        start_time: bookingSlot.start_time,
        round_type: bookingSlot.round_type,
        duration_mins: bookingSlot.duration_mins,
        application_id: applicationId,
      }),
    onSuccess: () => {
      toast.success('Interview booked — we’ve emailed the details across.');
      setBookingSlot(null);
      queryClient.invalidateQueries({ queryKey: ['agency-portal-slots', portalToken, assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['agency-portal-assignment', portalToken, assignmentId] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail ?? 'That slot was just taken — please pick another.');
      setBookingSlot(null);
      queryClient.invalidateQueries({ queryKey: ['agency-portal-slots', portalToken, assignmentId] });
    },
  });

  if (disabled) return null;

  if (isLoading) {
    return (
      <div>
        <SectionTitle icon={CalendarClock} title="Book an interview" />
        <div className="bg-white border border-surface-200 rounded-2xl p-4 space-y-3">
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 w-24 bg-surface-100 rounded-xl animate-pulse" />)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-14 bg-surface-100 rounded-xl animate-pulse" />)}
          </div>
        </div>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div>
        <SectionTitle icon={CalendarClock} title="Book an interview" />
        <div className="bg-white border border-surface-200 rounded-2xl">
          <EmptyState
            compact
            icon={CalendarX}
            title="No interview times open yet"
            description="The hiring team hasn’t published slots for this role. This list refreshes on its own — no need to reload."
          />
        </div>
      </div>
    );
  }

  const active = days.find((d) => d.key === activeDay) ?? days[0];
  const totalAvailable = (slots ?? []).reduce((sum, s) => sum + s.available_count, 0);

  return (
    <div>
      <SectionTitle
        icon={CalendarClock}
        title="Book an interview"
        count={totalAvailable}
        hint="all times IST"
        action={
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
            <ShieldCheck className="w-3 h-3" />
            Interviewer stays anonymous until booked
          </span>
        }
      />

      <div className="bg-white border border-surface-200 rounded-2xl overflow-hidden">
        {/* Day tabs */}
        <div className="flex gap-2 overflow-x-auto p-3 border-b border-surface-100 bg-surface-50/60">
          {days.map((d) => {
            const isActive = d.key === active.key;
            const count = d.slots.reduce((s, x) => s + x.available_count, 0);
            return (
              <button
                key={d.key}
                onClick={() => setActiveDay(d.key)}
                aria-pressed={isActive}
                className={cn(
                  'shrink-0 px-3.5 py-2 rounded-xl border text-left transition-all',
                  isActive
                    ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
                    : 'bg-white border-surface-200 text-gray-600 hover:border-brand-300 hover:text-brand-700'
                )}
              >
                <span className="block text-xs font-semibold whitespace-nowrap">{d.short}</span>
                <span className={cn('block text-[10px] mt-0.5', isActive ? 'text-white/75' : 'text-gray-400')}>
                  {count} slot{count !== 1 ? 's' : ''}
                </span>
              </button>
            );
          })}
        </div>

        {/* Time chips for the selected day */}
        <div className="p-4">
          <p className="font-display text-sm font-semibold text-gray-900 mb-3">{active.long}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {active.slots.map((s, i) => (
              <button
                key={`${s.start_time}-${s.round_type}-${i}`}
                onClick={() => setBookingSlot(s)}
                style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
                className="group px-3 py-2.5 rounded-xl border border-surface-200 bg-white text-left hover:border-brand-400 hover:bg-brand-50/50 hover:-translate-y-px transition-all animate-in fade-in duration-300 fill-mode-both"
              >
                <span className="flex items-baseline justify-between gap-1">
                  <span className="font-display text-sm font-bold text-gray-900 tabular-nums group-hover:text-brand-700 transition-colors">
                    {formatIST(s.start_time, 'h:mm a')}
                  </span>
                  {s.available_count > 1 && (
                    <span className="text-[10px] font-semibold text-gray-400">×{s.available_count}</span>
                  )}
                </span>
                <span className="block text-[11px] text-gray-500 truncate mt-0.5">
                  {ROUND_MAP[s.round_type]?.label ?? s.round_type} · {s.duration_mins}m
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3.5 pt-3 border-t border-surface-100">
            Picking a time confirms the interview straight away and emails everyone the details.
          </p>
        </div>
      </div>

      {bookingSlot && (
        <BookSlotModal
          slot={bookingSlot}
          candidates={candidates}
          isPending={bookMutation.isPending}
          onCancel={() => setBookingSlot(null)}
          onPick={(applicationId) => bookMutation.mutate(applicationId)}
        />
      )}
    </div>
  );
}

// ── Role detail ───────────────────────────────────────────────────────────────

const CANDIDATE_FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'active', label: 'In progress' },
  { value: 'hired', label: 'Hired' },
  { value: 'closed', label: 'Not proceeding' },
];

function RoleDetail({ portalToken, assignment, onBack }) {
  const [showSubmit, setShowSubmit] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['agency-portal-assignment', portalToken, assignment.assignment_id],
    queryFn: () => agenciesApi.portalAssignment(portalToken, assignment.assignment_id).then((r) => r.data),
  });

  const candidates = data?.candidates ?? [];

  const counts = useMemo(() => {
    const hired = candidates.filter((c) => c.stage === 'hired').length;
    const rejected = candidates.filter((c) => TERMINAL_STAGES.has(c.stage)).length;
    return { hired, rejected, inProgress: candidates.length - hired - rejected };
  }, [candidates]);

  const visibleCandidates = useMemo(() => {
    let list = candidates;
    if (filter === 'active') list = list.filter((c) => c.stage !== 'hired' && !TERMINAL_STAGES.has(c.stage));
    else if (filter === 'hired') list = list.filter((c) => c.stage === 'hired');
    else if (filter === 'closed') list = list.filter((c) => TERMINAL_STAGES.has(c.stage));

    const needle = search.trim().toLowerCase();
    if (needle) list = list.filter((c) => c.candidate_name?.toLowerCase().includes(needle));

    // Whatever moved most recently is what they want to see — not whatever they
    // happened to submit first.
    return [...list].sort((a, b) => new Date(b.stage_updated_at) - new Date(a.stage_updated_at));
  }, [candidates, filter, search]);

  const back = (
    <button onClick={onBack} className="group inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 mb-4">
      <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
      All roles
    </button>
  );

  if (isLoading) {
    return (
      <div>
        {back}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 animate-pulse">
          <div className="space-y-4">
            <div className="h-28 bg-white border border-surface-200 rounded-2xl" />
            <div className="h-64 bg-white border border-surface-200 rounded-2xl" />
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-36 bg-white border border-surface-200 rounded-2xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        {back}
        <div className="bg-white border border-surface-200 rounded-2xl">
          <EmptyState
            icon={AlertCircle}
            title="Couldn’t load this role"
            description="It may have been unassigned from your agency. Go back to your roles, or get in touch with your Nablon AI contact."
          />
        </div>
      </div>
    );
  }

  // Both conditions are enforced server-side by validate_portal_assignment, so
  // reflecting them here is what stops someone writing up a whole candidate
  // only to be refused at the final step.
  const { expiresAt, expired, capped, blocked } = assignmentState(data);
  const trackedLink = `${window.location.origin}/agency-apply/${assignment.job_slug ?? assignment.job_id}?ref=${assignment.ref_token}`;

  return (
    <div>
      {back}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        {/* ── Main column ── */}
        <div className="min-w-0 space-y-6">
          <header className="bg-white border border-surface-200 rounded-2xl p-5">
            <div className="flex items-start gap-3.5">
              <span className="w-11 h-11 shrink-0 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                <Briefcase className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900 leading-snug break-words">
                  {data.job_title}
                </h1>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border',
                      expired
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : capped
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    )}
                  >
                    {expired ? 'Access ended' : capped ? 'Cap reached' : 'Open for submissions'}
                  </span>
                  {expiresAt && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                      <Clock className="w-3 h-3" />
                      {expired ? 'ended' : 'until'} {formatIST(expiresAt, 'd MMM yyyy')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {blocked && (
              <div className="flex items-start gap-2.5 mt-4 text-xs rounded-xl border border-amber-200 bg-amber-50 text-amber-800 p-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <p>
                  {expired
                    ? 'Your window for this role has closed, so new submissions are refused. Everyone you already submitted carries on below — ask your Nablon AI contact if you need it extended.'
                    : 'You’ve used every submission for this role. Candidates already submitted continue as normal — ask your Nablon AI contact if you need the cap raised.'}
                </p>
              </div>
            )}
          </header>

          <SlotPicker
            portalToken={portalToken}
            assignmentId={assignment.assignment_id}
            candidates={candidates}
            disabled={expired}
          />

          <div>
            <SectionTitle
              icon={Users}
              title="Your candidates"
              count={candidates.length}
              action={
                candidates.length > 3 ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Find a name…"
                        className="w-36 sm:w-44 pl-8 pr-2 py-1.5 text-xs bg-white border border-surface-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      aria-label="Filter candidates"
                      className="text-xs bg-white border border-surface-300 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      {CANDIDATE_FILTERS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                ) : null
              }
            />

            {candidates.length === 0 ? (
              <div className="bg-white border border-surface-200 rounded-2xl">
                <EmptyState
                  icon={Users}
                  title="No candidates submitted yet"
                  description={
                    blocked
                      ? 'Submissions are closed for this role.'
                      : 'Upload a resume with “Submit a candidate”, or share your trackable link and let them apply themselves.'
                  }
                  action={
                    !blocked ? (
                      <button
                        onClick={() => setShowSubmit(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors"
                      >
                        <UserPlus className="w-4 h-4" /> Submit your first candidate
                      </button>
                    ) : null
                  }
                />
              </div>
            ) : visibleCandidates.length === 0 ? (
              <div className="bg-white border border-surface-200 rounded-2xl">
                <EmptyState compact icon={Search} title="Nobody matches" description="Try a different name, or change the filter." />
              </div>
            ) : (
              <div className="bg-white border border-surface-200 rounded-2xl divide-y divide-surface-100 overflow-hidden">
                {visibleCandidates.map((c, i) => {
                  const closed = TERMINAL_STAGES.has(c.stage);
                  return (
                    <div
                      key={c.application_id}
                      style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                      className={cn(
                        'flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 transition-colors',
                        'animate-in fade-in slide-in-from-bottom-1 duration-300 fill-mode-both',
                        closed ? 'opacity-60' : 'hover:bg-surface-50'
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={cn(
                            'w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                            c.stage === 'hired' ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'
                          )}
                        >
                          {initials(c.candidate_name)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{c.candidate_name}</p>
                          <p className="text-[11px] text-gray-400">
                            submitted {formatDistanceToNow(new Date(c.applied_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StageBadge stage={c.stage} />
                        <span className="text-[11px] text-gray-400 hidden sm:block whitespace-nowrap">
                          moved {formatDistanceToNow(new Date(c.stage_updated_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Sidebar ── */}
        <aside className="lg:sticky lg:top-[5.5rem] space-y-4">
          <SidebarCard>
            <QuotaMeter used={data.submission_count} max={data.max_submissions} className="mb-4" />
            <button
              onClick={() => setShowSubmit(true)}
              disabled={blocked}
              title={blocked ? 'Submissions are closed for this role' : undefined}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Submit a candidate
            </button>
            <p className="text-[11px] text-gray-400 mt-2.5 text-center leading-relaxed">
              Resume in, details pre-filled, done in a couple of minutes.
            </p>
          </SidebarCard>

          {candidates.length > 0 && (
            <SidebarCard title="Where they stand" icon={Send}>
              <PipelineFunnel counts={counts} total={candidates.length} layout="stack" />
            </SidebarCard>
          )}

          {!expired && (
            <SidebarCard title="Your link for this role" icon={Link2}>
              <CopyLink
                url={trackedLink}
                label={null}
                hint="Send this to candidates instead. Anyone who applies through it is credited to you automatically."
                className="border-0 bg-transparent p-0"
              />
            </SidebarCard>
          )}

          <SidebarCard title="Need a hand?" icon={LifeBuoy}>
            <p className="text-xs text-gray-500 leading-relaxed">
              Your Nablon AI point of contact can raise a submission cap, extend your access window, or open more
              interview times. All interview times on this page are shown in <strong className="font-semibold text-gray-700">IST</strong>.
            </p>
          </SidebarCard>
        </aside>
      </div>

      {showSubmit && (
        <SubmitCandidateModal
          portalToken={portalToken}
          assignmentId={assignment.assignment_id}
          jobTitle={data.job_title}
          onClose={() => setShowSubmit(false)}
        />
      )}
    </div>
  );
}

// ── Role card ─────────────────────────────────────────────────────────────────

function RoleCard({ assignment, onOpen, index }) {
  const { expiresAt, expired, capped } = assignmentState(assignment);
  const counts = {
    inProgress: assignment.in_progress_count ?? 0,
    hired: assignment.hired_count ?? 0,
    rejected: assignment.rejected_count ?? 0,
  };

  return (
    <button
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={cn(
        'group w-full text-left bg-white border rounded-2xl p-5 transition-all',
        'animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both',
        expired
          ? 'border-surface-200 opacity-70 hover:opacity-100'
          : 'border-surface-200 hover:border-brand-300 hover:shadow-card-hover hover:-translate-y-0.5'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-colors',
            expired ? 'bg-surface-100 text-gray-400' : 'bg-brand-50 text-brand-600 group-hover:bg-brand-100'
          )}
        >
          <Briefcase className="w-5 h-5" />
        </span>
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border shrink-0',
            expired
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : capped
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          )}
        >
          {expired ? 'Ended' : capped ? 'Cap reached' : 'Open'}
        </span>
      </div>

      <h3 className="font-display font-bold text-gray-900 mt-3.5 leading-snug group-hover:text-brand-700 transition-colors">
        {assignment.job_title}
      </h3>

      {expiresAt && !expired && (
        <p className="inline-flex items-center gap-1 text-[11px] text-gray-400 mt-1">
          <Clock className="w-3 h-3" /> open until {formatIST(expiresAt, 'd MMM')}
        </p>
      )}

      <div className="mt-4">
        <QuotaMeter used={assignment.submission_count} max={assignment.max_submissions} />
      </div>

      {assignment.submission_count > 0 && (
        <div className="mt-4 pt-3.5 border-t border-surface-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Outcomes</p>
          <PipelineFunnel counts={counts} total={assignment.submission_count} size="sm" />
        </div>
      )}

      <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 mt-4 group-hover:gap-2 transition-all">
        Open role <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────
//
// Module scope on purpose: declared inside the page component this would be a
// new component type on every render, so React would tear down and rebuild the
// whole subtree — losing RoleDetail's state every time a poll landed.
function Shell({ agencyName, roleSwitcher, children }) {
  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <header className="bg-white/90 backdrop-blur border-b border-surface-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <img src="/logo.jpg" alt="Nablon AI" className="h-8 w-auto rounded-lg object-contain shrink-0" />
          <div className="h-5 w-px bg-surface-200 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 leading-none truncate">
              {agencyName ?? 'Recruiting Partner Portal'}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">Nablon AI · Partner workspace</p>
          </div>
          {roleSwitcher}
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>

      <footer className="border-t border-surface-200 bg-white py-5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center text-[11px] text-gray-400">
          © {new Date().getFullYear()} Nablon AI · Candidate data is handled confidentially · Interview times shown in IST
        </div>
      </footer>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgencyPortalPage() {
  const { portalToken } = useParams();
  // Kept in the URL so refresh, browser-back and a bookmarked role all land
  // where the agency expects — this used to be component state, so a reload
  // silently dumped them back at the top level.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('role');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['agency-portal', portalToken],
    queryFn: () => agenciesApi.portal(portalToken).then((r) => r.data),
    retry: false,
  });

  const assignments = data?.assignments ?? [];
  const selected = assignments.find((a) => a.assignment_id === selectedId) ?? null;

  if (isLoading) {
    return (
      <Shell>
        <div className="space-y-5 animate-pulse">
          <div className="h-44 bg-white border border-surface-200 rounded-3xl" />
          <div className="grid sm:grid-cols-2 gap-4">
            {[1, 2].map((i) => <div key={i} className="h-56 bg-white border border-surface-200 rounded-2xl" />)}
          </div>
        </div>
      </Shell>
    );
  }

  if (isError) {
    return (
      <Shell>
        <div className="bg-white border border-surface-200 rounded-2xl max-w-xl mx-auto">
          <EmptyState
            icon={Building2}
            title="This portal link isn’t working"
            description="It may have been deactivated, or the link may be incomplete. Check the link in your invitation email, or get in touch with your Nablon AI point of contact."
          />
        </div>
      </Shell>
    );
  }

  // A switcher beats going back to the list and in again for an agency working
  // across several roles.
  const roleSwitcher =
    assignments.length > 1 ? (
      <select
        value={selectedId ?? ''}
        onChange={(e) => (e.target.value ? setSearchParams({ role: e.target.value }) : setSearchParams({}))}
        aria-label="Switch role"
        className="shrink-0 max-w-[10rem] sm:max-w-[16rem] text-xs sm:text-sm border border-surface-300 rounded-xl px-2.5 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <option value="">All roles</option>
        {assignments.map((a) => (
          <option key={a.assignment_id} value={a.assignment_id}>{a.job_title}</option>
        ))}
      </select>
    ) : null;

  if (selected) {
    return (
      <Shell agencyName={data?.agency_name} roleSwitcher={roleSwitcher}>
        <RoleDetail portalToken={portalToken} assignment={selected} onBack={() => setSearchParams({})} />
      </Shell>
    );
  }

  const openCount = assignments.filter((a) => !assignmentState(a).expired).length;

  return (
    <Shell agencyName={data?.agency_name} roleSwitcher={roleSwitcher}>
      {/* Hero — KPIs live inside it rather than in a separate tile row below */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white mb-6">
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-28 left-1/4 w-80 h-80 rounded-full bg-brand-300/20 blur-3xl pointer-events-none" />

        <div className="relative p-6 sm:p-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Partner workspace</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold mt-2.5 leading-tight">
            {data?.agency_name}
          </h1>
          <p className="text-sm text-white/75 mt-2 max-w-xl leading-relaxed">
            Submit candidates, book them straight into interview times, and follow exactly where each one
            stands — no logins, no chasing anyone for an update.
          </p>

          {assignments.length > 0 && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-6">
              {[
                { label: 'Roles open to you', value: openCount, icon: Briefcase },
                { label: 'Submitted', value: data.total_submitted, icon: Send },
                { label: 'In progress', value: data.total_in_progress, icon: Hourglass },
                { label: 'Hired', value: data.total_hired, icon: Award },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-2xl bg-white/10 border border-white/15 backdrop-blur-sm px-3.5 py-3">
                  <dt className="flex items-center gap-1.5 text-[11px] text-white/70">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                  </dt>
                  <dd className="font-display text-2xl font-bold tabular-nums mt-1 leading-none">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {assignments.length === 0 ? (
        <div className="bg-white border border-surface-200 rounded-2xl max-w-xl mx-auto">
          <EmptyState
            icon={Briefcase}
            title="No roles assigned yet"
            description="Once the Nablon AI hiring team opens a role to your agency it appears here, along with your submission allowance, interview times and trackable apply link."
          />
        </div>
      ) : (
        <>
          <SectionTitle
            icon={Briefcase}
            title="Your roles"
            count={assignments.length}
            hint="pick one to submit candidates or book interviews"
          />
          <div className={cn('grid gap-4', assignments.length > 1 && 'sm:grid-cols-2')}>
            {assignments.map((a, i) => (
              <RoleCard
                key={a.assignment_id}
                index={i}
                assignment={a}
                onOpen={() => setSearchParams({ role: a.assignment_id })}
              />
            ))}
          </div>

          <div className="flex items-start gap-2.5 mt-6 text-xs text-gray-500 bg-white border border-surface-200 rounded-2xl p-4">
            <Info className="w-4 h-4 text-brand-400 shrink-0 mt-px" />
            <p className="leading-relaxed">
              Every role carries its own submission allowance and its own trackable apply link. Open a role to
              see both, along with the interview times currently free — all shown in IST.
            </p>
          </div>
        </>
      )}
    </Shell>
  );
}
