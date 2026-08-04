import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Briefcase, Search } from 'lucide-react';
import { jobsApi } from '@/api/jobs';
import JobCard from '@/components/shared/JobCard';
import JobDetailModal from '@/components/shared/JobDetailModal';

export default function BrowseJobsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedSlug, setSelectedSlug] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-jobs', { search, page }],
    queryFn: () =>
      jobsApi.list({ search: search || undefined, page, limit: 20 }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const jobs = data?.items ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold text-gray-900">Browse Jobs</h1>
        <p className="text-sm text-gray-500 mt-0.5">Open roles at Nablon AI — click a role to read the full description.</p>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search roles…"
          className="w-full pl-9 pr-4 py-2.5 border border-surface-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl bg-surface-100 animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{search ? `No roles matching "${search}"` : 'No open positions right now'}</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onClick={() => setSelectedSlug(job.slug)} />
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">{page} / {data.pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {selectedSlug && (
        <JobDetailModal slug={selectedSlug} onClose={() => setSelectedSlug(null)} />
      )}
    </div>
  );
}
