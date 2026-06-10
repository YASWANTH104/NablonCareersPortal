import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Briefcase, ChevronRight, FileText, AlertCircle, Pencil, X, Loader2 } from 'lucide-react';
import { applicationsApi } from '@/api/applications';
import client from '@/api/client';

const STAGE_CONFIG = {
  applied:         { label: 'Applied',          color: 'bg-blue-100 text-blue-700' },
  screening:       { label: 'Screening',         color: 'bg-purple-100 text-purple-700' },
  assessment:      { label: 'Assessment',        color: 'bg-orange-100 text-orange-700' },
  interview_1:     { label: 'Interview 1',       color: 'bg-indigo-100 text-indigo-700' },
  interview_2:     { label: 'Interview 2',       color: 'bg-indigo-100 text-indigo-700' },
  interview_3:     { label: 'Interview 3',       color: 'bg-indigo-100 text-indigo-700' },
  final_interview: { label: 'Final Interview',   color: 'bg-violet-100 text-violet-700' },
  offer:           { label: 'Offer',             color: 'bg-emerald-100 text-emerald-700' },
  hired:           { label: 'Hired',             color: 'bg-green-100 text-green-700' },
  rejected:        { label: 'Rejected',          color: 'bg-red-100 text-red-700' },
  withdrawn:       { label: 'Withdrawn',         color: 'bg-gray-100 text-gray-500' },
};

const TERMINAL_STAGES = new Set(['hired', 'rejected', 'withdrawn']);

function StageBadge({ stage }) {
  const cfg = STAGE_CONFIG[stage] ?? { label: stage, color: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function EditApplicationModal({ app, onClose, onSuccess }) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm();

  useEffect(() => {
    reset({
      cover_letter: app.cover_letter ?? '',
      resume_url: app.resume_url ?? '',
      linkedin_url: app.linkedin_url ?? '',
      portfolio_url: app.portfolio_url ?? '',
      github_url: app.github_url ?? '',
    });
  }, [app, reset]);

  const onSubmit = async (values) => {
    const payload = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== '')
    );
    await client.patch(`/applications/${app.id}`, payload);
    toast.success('Application updated');
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200">
          <h2 className="font-semibold text-gray-900">Edit Application</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Resume URL</label>
            <input
              {...register('resume_url')}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="https://drive.google.com/..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cover Letter</label>
            <textarea
              {...register('cover_letter')}
              rows={4}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
              placeholder="Tell us why you're a great fit..."
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">LinkedIn</label>
              <input
                {...register('linkedin_url')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="linkedin.com/in/..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Portfolio</label>
              <input
                {...register('portfolio_url')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="yoursite.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">GitHub</label>
              <input
                {...register('github_url')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="github.com/..."
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Save changes
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MyApplicationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [editingApp, setEditingApp] = useState(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['my-applications', page],
    queryFn: () => applicationsApi.mine(page, 10).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const withdrawMut = useMutation({
    mutationFn: (id) => applicationsApi.withdraw(id),
    onSuccess: () => {
      toast.success('Application withdrawn');
      setWithdrawingId(null);
      qc.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to withdraw'),
  });

  const applications = data?.items ?? [];

  return (
    <div className="max-w-3xl mx-auto">
      {editingApp && (
        <EditApplicationModal
          app={editingApp}
          onClose={() => setEditingApp(null)}
          onSuccess={() => {
            setEditingApp(null);
            qc.invalidateQueries({ queryKey: ['my-applications'] });
          }}
        />
      )}
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold text-gray-900">My Applications</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {data?.total ?? 0} application{data?.total !== 1 ? 's' : ''}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-surface-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-200 p-16 text-center">
          <Briefcase className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No applications yet</p>
          <p className="text-gray-400 text-sm mt-1">Browse open positions and apply to get started.</p>
          <button
            onClick={() => navigate('/jobs')}
            className="mt-4 px-5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600"
          >
            Browse Jobs
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => (
            <div key={app.id} className="bg-white rounded-xl border border-surface-200 p-4 hover:border-brand-200 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FileText className="w-4 h-4 text-brand-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">
                      {app.job_title ?? 'Position'}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <StageBadge stage={app.stage} />
                      <span className="text-xs text-gray-400">
                        Applied {format(new Date(app.applied_at), 'MMM d, yyyy')}
                      </span>
                      {app.source && app.source !== 'direct' && (
                        <span className="text-xs text-brand-600 capitalize">{app.source}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {!TERMINAL_STAGES.has(app.stage) && (
                    <>
                      <button
                        onClick={() => setEditingApp(app)}
                        className="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors"
                        title="Edit application"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {withdrawingId === app.id ? (
                        <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>Confirm?</span>
                          <button
                            onClick={() => withdrawMut.mutate(app.id)}
                            disabled={withdrawMut.isPending}
                            className="font-semibold hover:text-red-800 ml-1"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setWithdrawingId(null)}
                            className="text-gray-500 hover:text-gray-700 ml-1"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setWithdrawingId(app.id)}
                          className="text-xs text-gray-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          Withdraw
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => navigate(`/jobs/${app.job_id}`)}
                    className="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
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
    </div>
  );
}
