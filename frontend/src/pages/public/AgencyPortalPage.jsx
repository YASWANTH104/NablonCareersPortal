import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, Users, Clock } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { agenciesApi } from '@/api/agencies';

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

function AssignmentDetail({ portalToken, assignmentId, jobTitle, onBack }) {
  const { data, isLoading } = useQuery({
    queryKey: ['agency-portal-assignment', portalToken, assignmentId],
    queryFn: () => agenciesApi.portalAssignment(portalToken, assignmentId).then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-surface-100 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5">
        ← Back to all jobs
      </button>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{data?.job_title}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.submission_count} candidate{data?.submission_count !== 1 ? 's' : ''} submitted
            {data?.max_submissions ? ` · Max ${data.max_submissions}` : ''}
            {data?.expires_at ? ` · Expires ${format(new Date(data.expires_at), 'MMM d, yyyy')}` : ''}
          </p>
        </div>
      </div>

      {data?.candidates.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No candidates submitted yet. Share the job link with your candidates.</p>
        </div>
      )}

      <div className="space-y-2">
        {data?.candidates.map((c) => (
          <div key={c.application_id} className="flex items-center justify-between bg-white border border-surface-200 rounded-xl px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700">
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
      <div className="min-h-screen bg-surface-50 flex items-center justify-center">
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
      <header className="bg-white border-b border-surface-200 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{data?.agency_name}</p>
            <p className="text-xs text-gray-400">Nablon AI · Recruiting Agency Portal</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
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

            {data?.assignments.length === 0 && (
              <div className="text-center py-16 text-gray-400">
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
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{a.job_title}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {a.submission_count} submitted
                          {a.max_submissions ? ` / ${a.max_submissions} max` : ''}
                        </span>
                        {a.expires_at && (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Expires {format(new Date(a.expires_at), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
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
