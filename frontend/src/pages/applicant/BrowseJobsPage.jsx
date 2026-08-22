import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Briefcase, ArrowRight, ExternalLink, UserPlus, CheckCircle2, FileText,
  Sparkles, Compass,
} from 'lucide-react';
import { jobsApi } from '@/api/jobs';
import { applicationsApi } from '@/api/applications';
import { referralsApi } from '@/api/referrals';
import { useAuthStore } from '@/store/authStore';
import { ROLES } from '@/utils/permissions';
import JobDetailModal from '@/components/shared/JobDetailModal';
import PortalJobCard from '@/components/shared/PortalJobCard';
import JobFilterBar from '@/components/shared/JobFilterBar';
import ReferCandidateModal from '@/components/shared/ReferCandidateModal';
import { useDebounced } from '@/hooks/useDebounced';
import { EmptyState } from '@/components/ui';

// Terminal stages — an application here is history, so the role is open to a
// fresh attempt rather than being shown as "already applied".
const CLOSED_STAGES = new Set(['rejected', 'withdrawn', 'interview_drop', 'offer_drop']);

const STAGE_LABELS = {
  applied: 'Applied',
  screening: 'Screening',
  assessment: 'Assessment',
  tr1: 'Interview',
  tr2: 'Interview',
  hr: 'HR round',
  interview_1: 'Interview',
  interview_2: 'Interview',
  interview_3: 'Interview',
  final_interview: 'Final round',
  offer: 'Offer',
  hired: 'Hired',
};

// One page, two audiences: candidates in the applicant portal (/portal/jobs)
// browsing roles to apply for, and internal staff in the employee hub
// (/employee/jobs) browsing the same board to refer someone into. The actions
// differ completely — POST /applications is applicant-only — so the CTAs are
// chosen from the viewer's role rather than shown identically to both, which
// is what previously walked employees into an apply form they'd get a 403 from.
export default function BrowseJobsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isApplicant = user?.role === ROLES.APPLICANT;

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [departmentId, setDepartmentId] = useState('');
  const [locationType, setLocationType] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [page, setPage] = useState(1);
  const [viewingSlug, setViewingSlug] = useState(null);
  const [referringJob, setReferringJob] = useState(null);

  useEffect(() => { setPage(1); }, [search, departmentId, locationType, employmentType]);

  const { data: departments } = useQuery({
    queryKey: ['job-departments'],
    queryFn: () => jobsApi.listDepartments().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const departmentNames = useMemo(
    () => new Map((departments ?? []).map((d) => [String(d.id), d.name])),
    [departments]
  );

  // An applicant gets the public audience; anyone internal gets the referral
  // audience. `listReferable` matters for HR specifically — the plain list
  // hands them the admin view (every job, any status, filters ignored).
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['portal-jobs', { isApplicant, search, departmentId, locationType, employmentType, page }],
    queryFn: () => {
      const params = {
        search: search || undefined,
        department_id: departmentId || undefined,
        location_type: locationType || undefined,
        employment_type: employmentType || undefined,
        page,
        limit: 12,
      };
      const request = isApplicant ? jobsApi.list(params) : jobsApi.listReferable(params);
      return request.then((r) => r.data);
    },
    placeholderData: keepPreviousData,
  });

  // Shares the ['my-applications'] prefix that ApplyPage already invalidates on
  // submit, so an "Applied" badge appears without a manual refresh.
  const { data: myApplications } = useQuery({
    queryKey: ['my-applications', 'job-index'],
    queryFn: () => applicationsApi.mine(1, 50).then((r) => r.data),
    enabled: isApplicant,
    staleTime: 60_000,
  });

  const { data: myReferrals } = useQuery({
    queryKey: ['my-referrals-all'],
    queryFn: () => referralsApi.mine({ limit: 100 }).then((r) => r.data),
    enabled: !isApplicant,
  });

  // job_id -> the live application, so a card can say exactly where it stands
  // instead of just "you applied".
  const applicationByJob = useMemo(() => {
    const map = new Map();
    (myApplications?.items ?? []).forEach((a) => {
      if (!CLOSED_STAGES.has(a.stage)) map.set(String(a.job_id), a);
    });
    return map;
  }, [myApplications]);

  const referredJobIds = useMemo(
    () => new Set((myReferrals?.items ?? []).map((r) => String(r.job_id))),
    [myReferrals]
  );

  const jobs = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;
  const filtersActive = Boolean(search || departmentId || locationType || employmentType);
  const activeApplications = applicationByJob.size;

  function clearFilters() {
    setSearchInput('');
    setDepartmentId('');
    setLocationType('');
    setEmploymentType('');
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* ── Header ── */}
      <div className="bg-white rounded-2xl border border-surface-200 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <Compass className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900 leading-tight">
                {isApplicant ? 'Open roles at Nablon AI' : 'Browse open roles'}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {isApplicant
                  ? 'Read the full description, then apply in a couple of minutes. We review every application.'
                  : 'Everything currently open to referrals. Read a JD, then put someone forward without leaving the page.'}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {isApplicant ? (
              <button
                onClick={() => navigate('/portal/applications')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-xl hover:bg-brand-100 transition-colors"
              >
                <FileText className="w-4 h-4" />
                My applications
                {activeApplications > 0 && (
                  <span className="ml-0.5 text-[11px] font-bold bg-brand-500 text-white rounded-full px-1.5 py-px">
                    {activeApplications}
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={() => navigate('/employee/refer')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-xl hover:bg-brand-100 transition-colors"
              >
                <UserPlus className="w-4 h-4" /> Referral dashboard
              </button>
            )}
          </div>
        </div>

        {isApplicant && activeApplications > 0 && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-surface-100">
            <Sparkles className="w-4 h-4 text-brand-400 shrink-0" />
            <p className="text-sm text-gray-600">
              You have {activeApplications} application{activeApplications !== 1 ? 's' : ''} in progress.
            </p>
            <button
              onClick={() => navigate('/portal/applications')}
              className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700 shrink-0"
            >
              Track them <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
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
        placeholder="Search roles by title…"
        resultLabel={
          isLoading
            ? null
            : `${total} open role${total !== 1 ? 's' : ''}${filtersActive ? ' matching your filters' : ''}`
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
            title={filtersActive ? 'No roles match those filters' : 'No open positions right now'}
            description={
              filtersActive
                ? 'Try widening the search — or clear the filters to see everything currently open.'
                : 'New roles are posted regularly. Check back soon, or keep an eye on your email.'
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
            {jobs.map((job) => {
              const application = applicationByJob.get(String(job.id));
              const referred = referredJobIds.has(String(job.id));
              return (
                <PortalJobCard
                  key={job.id}
                  job={job}
                  departmentName={departmentNames.get(String(job.department_id))}
                  onOpen={() => setViewingSlug(job.slug)}
                  badge={
                    application ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" />
                        {STAGE_LABELS[application.stage] ?? 'Applied'}
                      </span>
                    ) : referred ? (
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
                      {isApplicant ? (
                        application ? (
                          <button
                            onClick={() => navigate('/portal/applications')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 transition-colors"
                          >
                            Track <ArrowRight className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={() => navigate(`/jobs/${job.slug}/apply`)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 transition-colors"
                          >
                            Apply <ArrowRight className="w-3 h-3" />
                          </button>
                        )
                      ) : (
                        <button
                          onClick={() => setReferringJob(job)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 transition-colors"
                        >
                          <UserPlus className="w-3.5 h-3.5" /> Refer
                        </button>
                      )}
                    </>
                  }
                />
              );
            })}
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

      {viewingSlug && (
        <JobDetailModal
          slug={viewingSlug}
          onClose={() => setViewingSlug(null)}
          onRefer={(job) => { setViewingSlug(null); setReferringJob(job); }}
        />
      )}

      {referringJob && (
        <ReferCandidateModal
          job={referringJob}
          departmentName={departmentNames.get(String(referringJob.department_id))}
          onClose={() => setReferringJob(null)}
        />
      )}
    </div>
  );
}
