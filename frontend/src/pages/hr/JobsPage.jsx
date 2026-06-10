import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, Search, MoreHorizontal, Pencil, Pause, Play, XCircle, Archive, Eye, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { jobsApi } from '@/api/jobs';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'paused', label: 'Paused' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
];

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  published: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-red-100 text-red-700',
  archived: 'bg-surface-100 text-gray-500',
};

function formatEmploymentType(val) {
  return val?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '—';
}

function JobRowMenu({ job, onStatusChange }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const navigate = useNavigate();

  const actions = [];
  if (job.status === 'draft') actions.push({ label: 'Publish', icon: Play, status: 'published' });
  if (job.status === 'published') actions.push({ label: 'Pause', icon: Pause, status: 'paused' });
  if (job.status === 'paused') actions.push({ label: 'Resume', icon: Play, status: 'published' });
  if (['published', 'paused'].includes(job.status)) actions.push({ label: 'Close', icon: XCircle, status: 'closed' });
  if (job.status === 'closed') actions.push({ label: 'Archive', icon: Archive, status: 'archived' });

  function handleToggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  }

  return (
    <div>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="p-1.5 rounded-lg text-gray-400 hover:bg-surface-100 hover:text-gray-600 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="fixed z-20 w-44 bg-white rounded-xl border border-surface-200 shadow-modal py-1"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button
              onClick={() => { setOpen(false); navigate(`/hr/jobs/${job.id}/edit`); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-gray-700 hover:bg-surface-50"
            >
              <Pencil className="w-4 h-4 text-gray-400" /> Edit
            </button>
            {job.status === 'published' && (
              <a
                href={`/jobs/${job.slug}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-gray-700 hover:bg-surface-50"
                onClick={() => setOpen(false)}
              >
                <Eye className="w-4 h-4 text-gray-400" /> View public
              </a>
            )}
            {actions.map(({ label, icon: Icon, status }) => (
              <button
                key={status}
                onClick={() => { setOpen(false); onStatusChange(job.id, status); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-gray-700 hover:bg-surface-50"
              >
                <Icon className="w-4 h-4 text-gray-400" /> {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function HRJobsPage() {
  const [activeTab, setActiveTab] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['hr-jobs', { status: activeTab, search, page }],
    queryFn: () =>
      jobsApi
        .list({ status: activeTab || undefined, search: search || undefined, page, limit: 20 })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => jobsApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-jobs'] });
      toast.success('Job status updated');
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to update status'),
  });

  const handleTabChange = (val) => {
    setActiveTab(val);
    setPage(1);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">Job Postings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage and publish open roles</p>
        </div>
        <button
          onClick={() => navigate('/hr/jobs/new')}
          className="flex items-center gap-2 px-4 py-2.5 bg-brand-500 text-white font-medium rounded-lg text-sm hover:bg-brand-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New job
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-100 rounded-xl p-1 mb-6 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleTabChange(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search jobs…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-8 py-2 border border-surface-300 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        />
        {search && (
          <button
            onClick={() => { setSearch(''); setPage(1); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden overflow-x-auto">
        {isLoading ? (
          <div className="divide-y divide-surface-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                <div className="flex-1">
                  <div className="h-4 bg-surface-100 rounded w-48 mb-2" />
                  <div className="h-3 bg-surface-100 rounded w-32" />
                </div>
                <div className="h-5 bg-surface-100 rounded w-16" />
              </div>
            ))}
          </div>
        ) : data?.items?.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 border-b border-surface-100">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-5 py-3">Title</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">Type</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">Openings</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50">
              {data.items.map((job) => (
                <tr key={job.id} className="hover:bg-surface-50 transition-colors">
                  <td className="px-5 py-4">
                    <button
                      onClick={() => navigate(`/hr/jobs/${job.id}/edit`)}
                      className="font-medium text-gray-900 hover:text-brand-600 text-left"
                    >
                      {job.title}
                    </button>
                    {job.location && (
                      <p className="text-xs text-gray-400 mt-0.5">{job.location}</p>
                    )}
                  </td>
                  <td className="px-4 py-4 text-gray-600">
                    {formatEmploymentType(job.employment_type)}
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[job.status] ?? 'bg-surface-100 text-gray-500'}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-gray-600">{job.openings}</td>
                  <td className="px-4 py-4 text-gray-400 text-xs">
                    {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-4">
                    <JobRowMenu
                      job={job}
                      onStatusChange={(id, status) => statusMutation.mutate({ id, status })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm mb-3">
              {search ? `No jobs matching "${search}"` : 'No jobs yet'}
            </p>
            <button
              onClick={() => navigate('/hr/jobs/new')}
              className="text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              + Create your first job posting
            </button>
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-end gap-3 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            {page} / {data.pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
