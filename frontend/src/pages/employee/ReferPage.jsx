import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  UserPlus, Briefcase, Gift, TrendingUp, Award, ArrowRight, ExternalLink,
} from 'lucide-react';
import { jobsApi } from '@/api/jobs';
import { referralsApi } from '@/api/referrals';
import JobDetailModal from '@/components/shared/JobDetailModal';
import PortalJobCard from '@/components/shared/PortalJobCard';
import JobFilterBar from '@/components/shared/JobFilterBar';
import ReferCandidateModal from '@/components/shared/ReferCandidateModal';
import { useDebounced } from '@/hooks/useDebounced';
import { StatTile, EmptyState } from '@/components/ui';

export default function ReferPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [departmentId, setDepartmentId] = useState('');
  const [locationType, setLocationType] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [page, setPage] = useState(1);
  const [selectedJob, setSelectedJob] = useState(null);
  const [viewingSlug, setViewingSlug] = useState(null);

  // Any filter change starts a new result set — staying on page 4 of the old
  // one is the classic way to land on a confusing empty page.
  useEffect(() => { setPage(1); }, [search, departmentId, locationType, employmentType]);

  const { data: departments } = useQuery({
    queryKey: ['job-departments'],
    queryFn: () => jobsApi.listDepartments().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // JobResponse only carries department_id, so the name has to be resolved
  // here — the old page rendered `job.department_name`, a field the API has
  // never returned, so the department chip simply never appeared.
  const departmentNames = useMemo(
    () => new Map((departments ?? []).map((d) => [String(d.id), d.name])),
    [departments]
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['referable-jobs', { search, departmentId, locationType, employmentType, page }],
    queryFn: () =>
      jobsApi
        .listReferable({
          search: search || undefined,
          department_id: departmentId || undefined,
          location_type: locationType || undefined,
          employment_type: employmentType || undefined,
          page,
          limit: 12,
        })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  // Same query key MyReferralsPage uses for its summary row, so opening either
  // page warms the other's cache instead of refetching the same list twice.
  const { data: allReferrals } = useQuery({
    queryKey: ['my-referrals-all'],
    queryFn: () => referralsApi.mine({ limit: 100 }).then((r) => r.data),
  });

  const stats = useMemo(() => {
    const all = allReferrals?.items ?? [];
    return {
      total: all.length,
      inProgress: all.filter((r) => ['invited', 'applied', 'in_progress'].includes(r.status)).length,
      hired: all.filter((r) => r.status === 'hired').length,
      bonusPending: all.filter((r) => r.bonus_eligible && !r.bonus_paid).length,
    };
  }, [allReferrals]);

  // Roles this person has already put someone forward for — worth flagging on
  // the card, since the backend enforces one referral per job+candidate and
  // there is otherwise no way to tell from here.
  const referredJobIds = useMemo(
    () => new Set((allReferrals?.items ?? []).map((r) => String(r.job_id))),
    [allReferrals]
  );

  const jobs = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;
  const filtersActive = Boolean(search || departmentId || locationType || employmentType);

  function clearFilters() {
    setSearchInput('');
    setDepartmentId('');
    setLocationType('');
    setEmploymentType('');
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-500 to-brand-700 text-white">
        <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-20 left-1/3 w-64 h-64 rounded-full bg-brand-300/20 blur-3xl pointer-events-none" />

        <div className="relative p-5 sm:p-7">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
            <div className="max-w-xl">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider bg-white/15 rounded-full px-2.5 py-1">
                <Gift className="w-3.5 h-3.5" /> Employee referrals
              </span>
              <h1 className="font-display text-2xl sm:text-3xl font-bold mt-3 leading-tight">
                Know someone who’d be great here?
              </h1>
              <p className="text-sm text-white/80 mt-2 leading-relaxed">
                Referrals are our strongest hiring channel. Pick a role, tell us about them, and we’ll take it
                from there — you’ll get an update at every stage, and a bonus when they’re hired.
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 text-xs text-white/70">
                {['Pick a role', 'Share their details', 'We reach out & keep you posted'].map((step, i) => (
                  <span key={step} className="inline-flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] font-bold inline-flex items-center justify-center">
                      {i + 1}
                    </span>
                    {step}
                  </span>
                ))}
              </div>
            </div>

            <button
              onClick={() => navigate('/employee/my-referrals')}
              className="shrink-0 self-start lg:self-end inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-brand-700 bg-white rounded-xl hover:bg-white/90 transition-colors"
            >
              Track my referrals <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── My referral snapshot ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Referred so far" value={stats.total} icon={UserPlus} tone="brand" />
        <StatTile label="In progress" value={stats.inProgress} icon={TrendingUp} tone="violet" />
        <StatTile label="Hired" value={stats.hired} icon={Award} tone="emerald" />
        <StatTile label="Bonus pending" value={stats.bonusPending} icon={Gift} tone="amber" />
      </div>

      {/* ── Filters ── */}
      <JobFilterBar
        search={searchInput}
        onSearchChange={setSearchInput}
        departmentId={departmentId}
        onDepartmentChange={setDepartmentId}
        locationType={locationType}
        onLocationTypeChange={setLocationType}
        employmentType={employmentType}
        onEmploymentTypeChange={setEmploymentType}
        departments={departments}
        onClear={clearFilters}
        isFetching={isFetching}
        placeholder="Search open roles by title…"
        resultLabel={
          isLoading
            ? null
            : `${total} role${total !== 1 ? 's' : ''} open to referrals${filtersActive ? ' matching your filters' : ''}`
        }
      />

      {/* ── Jobs ── */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 rounded-2xl bg-white border border-surface-200 animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-200">
          <EmptyState
            icon={Briefcase}
            title={filtersActive ? 'No roles match those filters' : 'No roles are open to referrals yet'}
            description={
              filtersActive
                ? 'Try widening the search — or clear the filters to see everything currently open.'
                : 'Once a role opens up for referrals it will appear here. Check back soon.'
            }
            action={
              filtersActive ? (
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors"
                >
                  Clear filters
                </button>
              ) : null
            }
          />
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <PortalJobCard
                key={job.id}
                job={job}
                departmentName={departmentNames.get(String(job.department_id))}
                onOpen={() => setViewingSlug(job.slug)}
                badge={
                  referredJobIds.has(String(job.id)) ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Referred
                    </span>
                  ) : null
                }
                actions={
                  <>
                    <button
                      onClick={() => setViewingSlug(job.slug)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-surface-200 rounded-lg hover:bg-surface-50 hover:text-gray-900 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" /> Read JD
                    </button>
                    <button
                      onClick={() => setSelectedJob(job)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Refer
                    </button>
                  </>
                }
              />
            ))}
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3.5 py-2 text-sm font-medium border border-surface-200 bg-white rounded-xl text-gray-600 hover:bg-surface-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500 tabular-nums">Page {page} of {pages}</span>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
                className="px-3.5 py-2 text-sm font-medium border border-surface-200 bg-white rounded-xl text-gray-600 hover:bg-surface-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {selectedJob && (
        <ReferCandidateModal
          job={selectedJob}
          departmentName={departmentNames.get(String(selectedJob.department_id))}
          onClose={() => setSelectedJob(null)}
        />
      )}

      {viewingSlug && (
        <JobDetailModal
          slug={viewingSlug}
          onClose={() => setViewingSlug(null)}
          onRefer={(job) => { setViewingSlug(null); setSelectedJob(job); }}
        />
      )}
    </div>
  );
}
