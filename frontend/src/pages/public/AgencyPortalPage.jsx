import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Building2, ChevronRight, Users, Clock, UserPlus, X, Briefcase, TrendingUp } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { agenciesApi } from '@/api/agencies';
import CandidateIntakeForm from '@/components/shared/CandidateIntakeForm';

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

function StageBadge({ stage }) {
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STAGE_COLORS[stage] ?? 'bg-gray-100 text-gray-600'}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
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
      <div className="bg-white rounded-2xl w-full max-w-lg my-8 p-6">
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

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5">
        ← Back to all jobs
      </button>

      <div className="bg-white border border-surface-200 rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{data?.job_title}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {data?.max_submissions ? `Max ${data.max_submissions} submissions` : 'Unlimited submissions'}
              {data?.expires_at ? ` · Expires ${format(new Date(data.expires_at), 'MMM d, yyyy')}` : ''}
            </p>
          </div>
          <button
            onClick={() => setShowSubmit(true)}
            disabled={quotaFull}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            Submit candidate
          </button>
        </div>

        {quotaFull && (
          <p className="text-xs font-medium text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-4 inline-block">
            Submission limit reached for this job
          </p>
        )}

        {stageSummary.total > 0 && (
          <div className="mt-5 pt-5 border-t border-surface-100 flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-xl font-bold text-gray-900">{stageSummary.total}</p>
              <p className="text-xs text-gray-400">Submitted</p>
            </div>
            <div>
              <p className="text-xl font-bold text-amber-600">{stageSummary.inProgress}</p>
              <p className="text-xs text-gray-400">In progress</p>
            </div>
            <div>
              <p className="text-xl font-bold text-green-600">{stageSummary.hired}</p>
              <p className="text-xs text-gray-400">Hired</p>
            </div>
            <div>
              <p className="text-xl font-bold text-red-400">{stageSummary.rejected}</p>
              <p className="text-xs text-gray-400">Not proceeding</p>
            </div>
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

      {data?.candidates.length === 0 && (
        <div className="text-center py-12 text-gray-400 bg-white border border-surface-200 rounded-2xl">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No candidates submitted yet. Upload a resume with "Submit candidate", or share the job link.</p>
        </div>
      )}

      <div className="space-y-2">
        {data?.candidates.map((c) => (
          <div key={c.application_id} className="flex items-center justify-between bg-white border border-surface-200 rounded-xl px-5 py-4 hover:border-surface-300 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">
                {c.candidate_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{c.candidate_name}</p>
                <p className="text-xs text-gray-400">Applied {formatDistanceToNow(new Date(c.applied_at), { addSuffix: true })}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StageBadge stage={c.stage} />
              <span className="text-xs text-gray-400 hidden sm:block">
                Updated {formatDistanceToNow(new Date(c.stage_updated_at), { addSuffix: true })}
              </span>
            </div>
          </div>
        ))}
      </div>
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
                  className="w-full text-left bg-white border border-surface-200 rounded-xl px-5 py-4 hover:border-brand-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-lg bg-surface-100 flex items-center justify-center flex-shrink-0">
                      <Briefcase className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-gray-900 text-sm truncate">{a.job_title}</p>
                        <span className="text-sm font-bold text-gray-900 flex-shrink-0">{a.submission_count}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 mb-2">
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
