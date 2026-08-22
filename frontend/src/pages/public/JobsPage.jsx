import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Users,
  X,
  Sparkles,
} from 'lucide-react';
import { jobsApi } from '@/api/jobs';
import { HeroBackdrop, Reveal } from '@/components/shared/effects';
import JobCard from '@/components/shared/JobCard';
import { LOCATION_TYPES, EMPLOYMENT_TYPES } from '@/constants/jobOptions';

// Option lists come from constants/jobOptions so this board can't drift from
// what JobEditPage is able to set — this local copy was missing `freelance`,
// making freelance roles impossible to filter for.
const LOCATION_OPTIONS = [{ value: '', label: 'Any Location' }, ...LOCATION_TYPES];
const EMPLOYMENT_OPTIONS = [{ value: '', label: 'Any Type' }, ...EMPLOYMENT_TYPES];

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-surface-200 p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded-xl bg-surface-100" />
        <div className="h-4 bg-surface-100 rounded w-20 ml-auto" />
      </div>
      <div className="h-5 bg-surface-100 rounded w-3/4 mb-2" />
      <div className="h-4 bg-surface-100 rounded w-1/2 mb-3" />
      <div className="flex gap-2">
        <div className="h-5 bg-surface-100 rounded w-16" />
        <div className="h-5 bg-surface-100 rounded w-20" />
      </div>
    </div>
  );
}

export default function JobsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [locationType, setLocationType] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [page, setPage] = useState(1);

  const hasFilters = search || locationType || employmentType;

  const { data, isLoading } = useQuery({
    queryKey: ['public-jobs', { search, locationType, employmentType, page }],
    queryFn: () =>
      jobsApi
        .list({
          search: search || undefined,
          location_type: locationType || undefined,
          employment_type: employmentType || undefined,
          page,
          limit: 12,
        })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const clearFilters = () => {
    setSearch('');
    setLocationType('');
    setEmploymentType('');
    setPage(1);
  };

  const handleFilterChange = (setter) => (val) => {
    setter(val);
    setPage(1);
  };

  return (
    <div className="overflow-x-clip">
      {/* ── HERO — same visual language as the landing page ──── */}
      <section className="relative bg-gray-950 overflow-hidden">
        <HeroBackdrop />

        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-24 lg:pt-28 lg:pb-28 text-center">
          <Reveal>
            <span className="inline-flex items-center gap-2 text-xs font-medium text-brand-200 bg-white/[0.08] border border-white/10 px-3.5 py-1.5 rounded-full mb-6 backdrop-blur">
              <Sparkles className="w-3.5 h-3.5" />
              {data?.total != null
                ? `${data.total} open role${data.total === 1 ? '' : 's'} — we're hiring`
                : "We're hiring"}
            </span>
          </Reveal>
          <Reveal delay={100}>
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-white mb-4 leading-[1.1]">
              Find your role at <span className="animated-gradient-text">Nablon AI</span>
            </h1>
          </Reveal>
          <Reveal delay={200}>
            <p className="text-lg text-brand-100/80 max-w-xl mx-auto">
              Join a team building production-grade agentic AI for Fortune 500 companies.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Filter bar — floats over the hero bottom ─────────── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 -mt-10 relative z-10">
        <div className="bg-white/95 backdrop-blur rounded-2xl border border-surface-200 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.35)] p-3 flex flex-col sm:flex-row gap-2">
          {/* Search */}
          <div className="relative flex-1 sm:min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search roles…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-gray-900 placeholder-gray-400"
            />
          </div>

          <div className="grid grid-cols-2 sm:flex gap-2">
            {/* Location type */}
            <select
              value={locationType}
              onChange={(e) => handleFilterChange(setLocationType)(e.target.value)}
              className="w-full sm:w-auto px-3 py-2.5 text-sm border border-surface-200 rounded-xl bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
            >
              {LOCATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Employment type */}
            <select
              value={employmentType}
              onChange={(e) => handleFilterChange(setEmploymentType)(e.target.value)}
              className="w-full sm:w-auto px-3 py-2.5 text-sm border border-surface-200 rounded-xl bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
            >
              {EMPLOYMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm text-gray-500 hover:text-gray-800 border border-surface-200 rounded-xl hover:bg-surface-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
        {/* Results count */}
        {!isLoading && data && (
          <p className="text-sm text-gray-500 mb-5">
            <span className="font-medium text-gray-900">{data.total}</span>{' '}
            {data.total === 1 ? 'role' : 'roles'} found
            {search ? <span> for <span className="font-medium">"{search}"</span></span> : ''}
          </p>
        )}

        {/* Grid */}
        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : data?.items?.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.items.map((job, i) => (
              <Reveal key={job.id} delay={Math.min(i, 5) * 60} className="h-full">
                <JobCard job={job} onClick={() => navigate(`/jobs/${job.slug}`)} ctaLabel="Apply now" />
              </Reveal>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-14 h-14 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7 text-surface-300" />
            </div>
            <h3 className="font-display font-semibold text-gray-700 mb-1">No open roles right now</h3>
            <p className="text-sm text-gray-500">
              {hasFilters ? 'Try adjusting your filters.' : 'Check back soon — we\'re always growing.'}
            </p>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Pagination */}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-10">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-surface-200 rounded-xl bg-white text-gray-600 hover:bg-surface-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page} of {data.pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
              disabled={page === data.pages}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-surface-200 rounded-xl bg-white text-gray-600 hover:bg-surface-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
