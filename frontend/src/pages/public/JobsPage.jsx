import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import {
  Search,
  MapPin,
  Briefcase,
  Clock,
  ChevronLeft,
  ChevronRight,
  Building2,
  Users,
  X,
  Sparkles,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { jobsApi } from '@/api/jobs';
import { HeroBackdrop, TiltCard, Reveal } from '@/components/shared/effects';

const LOCATION_TYPES = [
  { value: '', label: 'Any Location' },
  { value: 'remote', label: 'Remote' },
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
];

const EMPLOYMENT_TYPES = [
  { value: '', label: 'Any Type' },
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
];

function formatEmploymentType(val) {
  return val?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '';
}

function JobCard({ job }) {
  return (
    <TiltCard maxTilt={7} className="h-full">
      <Link
        to={`/jobs/${job.slug}`}
        className="group relative flex flex-col h-full bg-white rounded-2xl border border-surface-200 overflow-hidden hover:border-brand-300 hover:shadow-xl transition-all duration-300"
      >
        <div className="tilt-glare z-10" />
        {/* Gradient accent bar */}
        <div className="h-1 bg-gradient-to-r from-brand-400 via-brand-500 to-brand-600 opacity-80 group-hover:opacity-100 transition-opacity" />

        <div className="flex flex-col flex-1 p-5">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 border border-brand-100 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-brand-500" />
            </div>
            <div className="flex gap-1.5 flex-wrap justify-end">
              {job.location_type && (
                <span className="text-xs px-2.5 py-1 bg-surface-100 text-gray-600 rounded-full capitalize font-medium">
                  {job.location_type}
                </span>
              )}
              {job.employment_type && (
                <span className="text-xs px-2.5 py-1 bg-brand-50 text-brand-600 rounded-full font-medium">
                  {formatEmploymentType(job.employment_type)}
                </span>
              )}
            </div>
          </div>

          {/* Title */}
          <h3 className="font-display font-bold text-gray-900 text-lg leading-snug group-hover:text-brand-600 transition-colors mb-2">
            {job.title}
          </h3>

          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 mb-4">
            {job.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gray-400" />
                {job.location}
              </span>
            )}
            {(job.experience_min != null || job.experience_max != null) && (
              <span className="flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-gray-400" />
                {job.experience_min ?? 0}–{job.experience_max ?? '∞'} yrs exp
              </span>
            )}
            {job.openings > 0 && (
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                {job.openings} opening{job.openings !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Skills */}
          {job.skills_required?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {job.skills_required.slice(0, 4).map((skill) => (
                <span
                  key={skill}
                  className="text-xs px-2 py-0.5 bg-surface-50 border border-surface-200 text-gray-600 rounded-md"
                >
                  {skill}
                </span>
              ))}
              {job.skills_required.length > 4 && (
                <span className="text-xs px-2 py-0.5 text-gray-400 italic">
                  +{job.skills_required.length - 4} more
                </span>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 mt-auto border-t border-surface-100">
            {job.show_salary && job.salary_min ? (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Salary range</p>
                <p className="text-sm font-semibold text-gray-800">
                  {job.salary_currency} {(job.salary_min / 100000).toFixed(1)}L
                  {job.salary_max ? ` – ${(job.salary_max / 100000).toFixed(1)}L` : '+'}
                </p>
              </div>
            ) : (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {job.published_at
                  ? formatDistanceToNow(new Date(job.published_at), { addSuffix: true })
                  : 'Recently posted'}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 bg-brand-50 group-hover:bg-brand-100 px-3 py-1.5 rounded-full transition-colors">
              Apply now
              <ChevronRight className="w-3 h-3" />
            </span>
          </div>

          {/* Posted time when salary is shown */}
          {job.show_salary && job.salary_min && (
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-2">
              <Clock className="w-3 h-3" />
              {job.published_at
                ? formatDistanceToNow(new Date(job.published_at), { addSuffix: true })
                : 'Recently posted'}
            </p>
          )}
        </div>
      </Link>
    </TiltCard>
  );
}

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

        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 pt-16 pb-24 lg:pt-20 lg:pb-28 text-center">
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
        <div className="bg-white/95 backdrop-blur rounded-2xl border border-surface-200 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.35)] p-3 flex flex-wrap gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search roles…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-gray-900 placeholder-gray-400"
            />
          </div>

          {/* Location type */}
          <select
            value={locationType}
            onChange={(e) => handleFilterChange(setLocationType)(e.target.value)}
            className="px-3 py-2.5 text-sm border border-surface-200 rounded-xl bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
          >
            {LOCATION_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Employment type */}
          <select
            value={employmentType}
            onChange={(e) => handleFilterChange(setEmploymentType)(e.target.value)}
            className="px-3 py-2.5 text-sm border border-surface-200 rounded-xl bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
          >
            {EMPLOYMENT_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-gray-500 hover:text-gray-800 border border-surface-200 rounded-xl hover:bg-surface-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Clear
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
                <JobCard job={job} />
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
