import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Building2, ChevronRight, Users, Clock, UserPlus, X, Briefcase, TrendingUp,
  CalendarClock, CalendarX2, Loader2, Hourglass, XCircle, Info,
} from 'lucide-react';
import { format, formatDistanceToNow, isToday, isTomorrow, isSameDay } from 'date-fns';
import { agenciesApi } from '@/api/agencies';
import CandidateIntakeForm from '@/components/shared/CandidateIntakeForm';
import { ROUND_MAP } from '@/constants/interviewRounds';

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
};

const STAGE_COLORS = {
  applied: 'bg-blue-100 text-blue-700',
  screening: 'bg-purple-100 text-purple-700',
  assessment: 'bg-orange-100 text-orange-700',
  tr1: 'bg-indigo-100 text-indigo-700',
  tr2: 'bg-indigo-100 text-indigo-700',
  hr: 'bg-violet-100 text-violet-700',
  offer: 'bg-emerald-100 text-emerald-700',
  hired: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-gray-100 text-gray-500',
};

// Terminal-ish stages get a dot indicator so the candidate list reads at a
// glance without having to parse every badge color individually.
const STAGE_DOT = {
  hired: 'bg-green-500',
  rejected: 'bg-red-400',
  withdrawn: 'bg-gray-400',
};

function StageBadge({ stage }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STAGE_COLORS[stage] ?? 'bg-gray-100 text-gray-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT[stage] ?? 'bg-current opacity-60'}`} />
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

function SectionHeader({ icon: Icon, title, count, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-gray-400" />
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        {count != null && (
          <span className="text-xs font-medium text-gray-400 bg-surface-100 rounded-full px-2 py-0.5">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}

// Groups anonymized slot rows by calendar day, so the agency scans "Today",
// "Tomorrow", then real dates rather than a flat list of timestamps.
function groupSlotsByDate(slots) {
  const groups = [];
  (slots ?? []).forEach((slot) => {
    const day = new Date(slot.start_time);
    let group = groups.find((g) => isSameDay(g.day, day));
    if (!group) {
      group = { day, label: isToday(day) ? 'Today' : isTomorrow(day) ? 'Tomorrow' : format(day, 'EEEE, MMM d'), slots: [] };
      groups.push(group);
    }
    group.slots.push(slot);
  });
  return groups.sort((a, b) => a.day - b.day);
}

function StatTile({ label, value, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-surface-50 text-gray-900',
    brand: 'bg-brand-50 text-brand-700',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <div className={`rounded-xl p-4 text-center ${tones[tone]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-1 opacity-70">{label}</p>
    </div>
  );
}

function PipelineBar({ hired, inProgress, rejected, total }) {
  if (!total) return null;
  const segments = [
    { count: hired, cls: 'bg-green-400' },
    { count: inProgress, cls: 'bg-amber-300' },
    { count: rejected, cls: 'bg-red-300' },
  ].filter((s) => s.count > 0);

  return (
    <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-surface-100">
      {segments.map((s, i) => (
        <div key={i} className={s.cls} style={{ width: `${(s.count / total) * 100}%` }} />
      ))}
    </div>
  );
}

function SubmitCandidateModal({ portalToken, assignmentId, jobTitle, onClose }) {
  const queryClient = useQueryClient();

  const handleSubmit = async (payload) => {
    try {
      await agenciesApi.portalSubmitCandidate(portalToken, assignmentId, payload);
      toast.success('Candidate submitted!');
      queryClient.invalidateQueries({ queryKey: ['agency-portal-assignment', portalToken, assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['agency-portal', portalToken] });
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Submission failed. Please try again.');
      throw err;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg my-8 p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Submit a candidate</h3>
            <p className="text-xs text-gray-500 mt-0.5">{jobTitle}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <CandidateIntakeForm
          onParse={(file) => agenciesApi.portalParseResume(portalToken, file)}
          onSubmit={handleSubmit}
          submitLabel="Submit candidate"
        />
      </div>
    </div>
  );
}

function BookSlotModal({ slot, candidates, onCancel, onPick, isPending }) {
  const [selectedId, setSelectedId] = useState(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 sm:p-6">
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <CalendarClock className="w-4.5 h-4.5 text-brand-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Book this slot</h3>
              <p className="text-xs text-gray-500">
                {format(new Date(slot.start_time), 'EEEE, MMM d · h:mm a')}
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 mt-3 mb-4">
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">
            {ROUND_MAP[slot.round_type]?.label ?? slot.round_type}
          </span>
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-surface-100 text-gray-600">
            {slot.duration_mins} min
          </span>
        </div>

        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Which candidate is this for?</p>
        <div className="max-h-64 overflow-y-auto space-y-1 -mx-1 px-1">
          {candidates.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-6 h-6 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No submitted candidates for this job yet</p>
            </div>
          ) : (
            candidates.map((c) => (
              <button
                key={c.application_id}
                disabled={isPending}
                onClick={() => setSelectedId(c.application_id)}
                className={`w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl border transition-colors disabled:opacity-50 ${
                  selectedId === c.application_id
                    ? 'border-brand-300 bg-brand-50'
                    : 'border-transparent hover:bg-surface-50'
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-[11px] font-bold text-brand-700 flex-shrink-0">
                  {c.candidate_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <p className="text-sm font-medium text-gray-900 truncate">{c.candidate_name}</p>
              </button>
            ))
          )}
        </div>

        <button
          onClick={() => selectedId && onPick(selectedId)}
          disabled={!selectedId || isPending}
          className="w-full flex items-center justify-center gap-2 mt-4 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Confirm booking
        </button>
      </div>
    </div>
  );
}

function SlotsSection({ portalToken, assignmentId, candidates }) {
  const queryClient = useQueryClient();
  const [bookingSlot, setBookingSlot] = useState(null);

  const { data: slots, isLoading } = useQuery({
    queryKey: ['agency-portal-slots', portalToken, assignmentId],
    queryFn: () => agenciesApi.portalAvailableSlots(portalToken, assignmentId).then((r) => r.data),
  });

  const bookMutation = useMutation({
    mutationFn: (applicationId) =>
      agenciesApi.portalBookSlot(portalToken, assignmentId, {
        start_time: bookingSlot.start_time,
        round_type: bookingSlot.round_type,
        duration_mins: bookingSlot.duration_mins,
        application_id: applicationId,
      }),
    onSuccess: () => {
      toast.success('Interview booked!');
      setBookingSlot(null);
      queryClient.invalidateQueries({ queryKey: ['agency-portal-slots', portalToken, assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['agency-portal-assignment', portalToken, assignmentId] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail ?? 'This slot was just booked — please pick another.');
      setBookingSlot(null);
      queryClient.invalidateQueries({ queryKey: ['agency-portal-slots', portalToken, assignmentId] });
    },
  });

  if (isLoading) {
    return (
      <div className="mb-8">
        <SectionHeader icon={CalendarClock} title="Available interview slots" />
        <div className="bg-white border border-surface-200 rounded-2xl p-5 space-y-2 animate-pulse">
          <div className="h-4 bg-surface-100 rounded w-24" />
          <div className="h-11 bg-surface-100 rounded-lg" />
          <div className="h-11 bg-surface-100 rounded-lg" />
        </div>
      </div>
    );
  }

  const dateGroups = groupSlotsByDate(slots);
  if (dateGroups.length === 0) {
    return (
      <div className="mb-8">
        <SectionHeader icon={CalendarClock} title="Available interview slots" />
        <div className="bg-white border border-dashed border-surface-300 rounded-2xl px-5 py-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-surface-100 flex items-center justify-center flex-shrink-0">
            <CalendarX2 className="w-4.5 h-4.5 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">
            No interview slots published for this role right now — check back soon, or contact your Nablon AI point of contact.
          </p>
        </div>
      </div>
    );
  }

  const totalAvailable = (slots ?? []).reduce((sum, s) => sum + s.available_count, 0);

  return (
    <div className="mb-8">
      <SectionHeader
        icon={CalendarClock}
        title="Available interview slots"
        action={
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Info className="w-3 h-3" />
            Interviewer identity is kept anonymous until booked
          </span>
        }
      />
      <div className="bg-white border border-surface-200 rounded-2xl p-4 sm:p-5 space-y-5">
        {dateGroups.map((group) => (
          <div key={group.day.toISOString()}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{group.label}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {group.slots.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 bg-surface-50 hover:bg-surface-100 rounded-xl px-3.5 py-2.5 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{format(new Date(s.start_time), 'h:mm a')}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {ROUND_MAP[s.round_type]?.label ?? s.round_type} · {s.duration_mins} min · {s.available_count} available
                    </p>
                  </div>
                  <button
                    onClick={() => setBookingSlot(s)}
                    className="flex-shrink-0 px-3 py-1.5 bg-white border border-brand-200 text-brand-700 text-xs font-semibold rounded-lg hover:bg-brand-500 hover:text-white hover:border-brand-500 transition-colors"
                  >
                    Book
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-gray-400 pt-1 border-t border-surface-100">
          {totalAvailable} slot{totalAvailable !== 1 ? 's' : ''} open across {dateGroups.length} day{dateGroups.length !== 1 ? 's' : ''}
        </p>
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

function AssignmentDetail({ portalToken, assignmentId, jobTitle, onBack }) {
  const [showSubmit, setShowSubmit] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['agency-portal-assignment', portalToken, assignmentId],
    queryFn: () => agenciesApi.portalAssignment(portalToken, assignmentId).then((r) => r.data),
  });

  const stageSummary = useMemo(() => {
    const candidates = data?.candidates ?? [];
    const hired = candidates.filter((c) => c.stage === 'hired').length;
    const rejected = candidates.filter((c) => c.stage === 'rejected' || c.stage === 'withdrawn').length;
    const inProgress = candidates.length - hired - rejected;
    return { hired, rejected, inProgress, total: candidates.length };
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-24 bg-surface-100 rounded-xl" />
        {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-surface-100 rounded-xl" />)}
      </div>
    );
  }

  const quotaFull = data?.max_submissions && data?.submission_count >= data.max_submissions;
  const candidates = data?.candidates ?? [];
  // Most recently updated first — the candidates an agency needs to act on
  // (or check in on) surface at the top instead of sorting by submission order.
  const sortedCandidates = [...candidates].sort(
    (a, b) => new Date(b.stage_updated_at) - new Date(a.stage_updated_at)
  );

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-5 group">
        <ChevronRight className="w-4 h-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
        All jobs
      </button>

      {/* Job header */}
      <div className="bg-white border border-surface-200 rounded-2xl p-5 sm:p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <Briefcase className="w-5 h-5 text-brand-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-900 leading-snug">{data?.job_title}</h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-surface-100 text-gray-600">
                  {data?.max_submissions ? `Max ${data.max_submissions} submissions` : 'Unlimited submissions'}
                </span>
                {data?.expires_at && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-surface-100 text-gray-600 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Expires {format(new Date(data.expires_at), 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowSubmit(true)}
            disabled={quotaFull}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0 shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            Submit candidate
          </button>
        </div>

        {quotaFull && (
          <p className="text-xs font-medium text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-4 inline-flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5" />
            Submission limit reached for this job
          </p>
        )}

        {stageSummary.total > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5 pt-5 border-t border-surface-100">
            <StatTile label="Submitted" value={stageSummary.total} />
            <StatTile label="In progress" value={stageSummary.inProgress} tone="amber" />
            <StatTile label="Hired" value={stageSummary.hired} tone="green" />
            <StatTile label="Not proceeding" value={stageSummary.rejected} />
          </div>
        )}
      </div>

      {showSubmit && (
        <SubmitCandidateModal
          portalToken={portalToken}
          assignmentId={assignmentId}
          jobTitle={data?.job_title ?? jobTitle}
          onClose={() => setShowSubmit(false)}
        />
      )}

      <SlotsSection portalToken={portalToken} assignmentId={assignmentId} candidates={candidates} />

      <SectionHeader icon={Users} title="Candidates" count={candidates.length} />
      {candidates.length === 0 ? (
        <div className="text-center py-12 text-gray-400 bg-white border border-dashed border-surface-300 rounded-2xl">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No candidates submitted yet.</p>
          <p className="text-xs mt-1">Upload a resume with "Submit candidate" above, or share the job link.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedCandidates.map((c) => {
            const isTerminal = c.stage === 'rejected' || c.stage === 'withdrawn';
            return (
              <div
                key={c.application_id}
                className={`flex flex-wrap items-center justify-between gap-3 bg-white border rounded-xl px-4 sm:px-5 py-3.5 transition-colors ${
                  isTerminal ? 'border-surface-100 opacity-70' : 'border-surface-200 hover:border-brand-200 hover:shadow-sm'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    c.stage === 'hired' ? 'bg-green-100 text-green-700' : 'bg-brand-100 text-brand-700'
                  }`}>
                    {c.candidate_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.candidate_name}</p>
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      <Hourglass className="w-3 h-3" />
                      Applied {formatDistanceToNow(new Date(c.applied_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StageBadge stage={c.stage} />
                  <span className="text-xs text-gray-400 hidden sm:block">
                    Updated {formatDistanceToNow(new Date(c.stage_updated_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AgencyPortalPage() {
  const { portalToken } = useParams();
  const [selectedAssignment, setSelectedAssignment] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['agency-portal', portalToken],
    queryFn: () => agenciesApi.portal(portalToken).then((r) => r.data),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
        <div className="text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-700">Portal not found</h2>
          <p className="text-sm text-gray-400 mt-1">This agency portal link is invalid or has been deactivated.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50">
      <header className="bg-white border-b border-surface-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-brand-500 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-base font-bold text-gray-900">{data?.agency_name}</p>
            <p className="text-xs text-gray-400">Nablon AI · Recruiting Partner Portal</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {selectedAssignment ? (
          <AssignmentDetail
            portalToken={portalToken}
            assignmentId={selectedAssignment.assignment_id}
            jobTitle={selectedAssignment.job_title}
            onBack={() => setSelectedAssignment(null)}
          />
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-xl font-bold text-gray-900">Your Submissions</h1>
              <p className="text-sm text-gray-500 mt-0.5">Track the status of candidates you've submitted to Nablon AI</p>
            </div>

            {data?.assignments.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <StatTile label="Active jobs" value={data.assignments.length} />
                <StatTile label="Submitted" value={data.total_submitted} tone="brand" />
                <StatTile label="In progress" value={data.total_in_progress} tone="amber" />
                <StatTile label="Hired" value={data.total_hired} tone="green" />
              </div>
            )}

            {data?.assignments.length === 0 && (
              <div className="text-center py-16 text-gray-400 bg-white border border-surface-200 rounded-2xl">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No active job assignments yet.</p>
              </div>
            )}

            <div className="space-y-3">
              {data?.assignments.map((a) => (
                <button
                  key={a.assignment_id}
                  onClick={() => setSelectedAssignment(a)}
                  className="w-full text-left bg-white border border-surface-200 rounded-xl px-4 sm:px-5 py-4 hover:border-brand-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-9 h-9 rounded-lg bg-surface-100 flex items-center justify-center flex-shrink-0">
                      <Briefcase className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-gray-900 text-sm truncate">{a.job_title}</p>
                        <span className="text-sm font-bold text-gray-900 flex-shrink-0">{a.submission_count}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 mb-2">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          submitted{a.max_submissions ? ` / ${a.max_submissions} max` : ''}
                        </span>
                        {a.expires_at && (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Expires {format(new Date(a.expires_at), 'MMM d, yyyy')}
                          </span>
                        )}
                        {a.hired_count > 0 && (
                          <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            {a.hired_count} hired
                          </span>
                        )}
                      </div>
                      <PipelineBar
                        hired={a.hired_count}
                        inProgress={a.in_progress_count}
                        rejected={a.rejected_count}
                        total={a.submission_count}
                      />
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
