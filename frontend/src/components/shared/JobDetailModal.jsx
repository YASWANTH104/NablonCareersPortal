import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  MapPin, Briefcase, Users, IndianRupee, CalendarDays, Sparkles, FileText,
  ListChecks, Gift, ArrowRight, ExternalLink, UserPlus, CheckCircle2, Building2,
} from 'lucide-react';
import { jobsApi } from '@/api/jobs';
import { applicationsApi } from '@/api/applications';
import { useAuthStore } from '@/store/authStore';
import { ROLES } from '@/utils/permissions';
import { formatEmploymentType, formatSalaryLakhs } from '@/constants/jobOptions';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/utils';

const STAGE_LABELS = {
  applied: 'Applied',
  screening: 'In screening',
  assessment: 'In assessment',
  tr1: 'Technical round 1',
  tr2: 'Technical round 2',
  hr: 'HR round',
  interview_1: 'Interview 1',
  interview_2: 'Interview 2',
  interview_3: 'Interview 3',
  final_interview: 'Final interview',
  offer: 'Offer stage',
  hired: 'Hired',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
  interview_drop: 'Closed',
  offer_drop: 'Closed',
};

function Chip({ icon: Icon, children, tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium',
        tone === 'brand' ? 'bg-brand-50 text-brand-700' : 'bg-surface-100 text-gray-600'
      )}
    >
      {Icon && <Icon className={cn('w-3.5 h-3.5', tone === 'brand' ? 'text-brand-400' : 'text-gray-400')} />}
      {children}
    </span>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-brand-500" />
        <h4 className="font-display font-semibold text-gray-900 text-sm">{title}</h4>
      </div>
      {children}
    </section>
  );
}

// Same information depth as the public job detail page (title, meta, skills,
// full description/requirements/benefits) but styled to sit inside the portal
// shell instead of the public marketing hero — opened from Browse Jobs and
// Refer a Candidate so nobody has to leave the portal just to read a JD.
//
// The footer action is role-aware. It used to be "Apply now" for everyone,
// which was a dead end for internal staff: POST /applications is restricted to
// Role.APPLICANT, so an employee who read a JD here, clicked through and filled
// in the whole apply form only found out at submit time, via a 403. Internal
// viewers get "Refer a candidate" instead — the thing they can actually do.
export default function JobDetailModal({ slug, onClose, onRefer }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isApplicant = user?.role === ROLES.APPLICANT;

  const { data: job, isLoading, isError } = useQuery({
    queryKey: ['job', slug],
    queryFn: () => jobsApi.getBySlug(slug).then((r) => r.data),
  });

  const { data: departments } = useQuery({
    queryKey: ['job-departments'],
    queryFn: () => jobsApi.listDepartments().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // JobResponse carries department_id, never department_name — this modal used
  // to render `job.department_name` and so never showed a department at all.
  const departmentName = useMemo(
    () => (departments ?? []).find((d) => String(d.id) === String(job?.department_id))?.name,
    [departments, job?.department_id]
  );

  // Nested under the ['my-applications'] prefix on purpose: ApplyPage already
  // invalidates that prefix after a successful submit, so this index refreshes
  // itself and the "you've applied" state appears without a reload.
  const { data: myApplications } = useQuery({
    queryKey: ['my-applications', 'job-index'],
    queryFn: () => applicationsApi.mine(1, 50).then((r) => r.data),
    enabled: isApplicant,
    staleTime: 60_000,
  });

  const existingApplication = useMemo(
    () => (myApplications?.items ?? []).find((a) => String(a.job_id) === String(job?.id)),
    [myApplications, job?.id]
  );

  const salary = formatSalaryLakhs(job);

  if (isLoading) {
    return (
      <Modal onClose={onClose} size="3xl">
        <div className="animate-pulse space-y-4 py-2">
          <div className="h-6 bg-surface-100 rounded w-2/3" />
          <div className="flex gap-2">
            <div className="h-6 bg-surface-100 rounded-full w-20" />
            <div className="h-6 bg-surface-100 rounded-full w-24" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-3 bg-surface-100 rounded" />
          ))}
        </div>
      </Modal>
    );
  }

  if (isError || !job) {
    return (
      <Modal onClose={onClose} size="md">
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">Couldn’t load this role — it may have been closed or removed.</p>
          <button onClick={onClose} className="mt-4 text-sm font-medium text-brand-600 hover:text-brand-700">
            Close
          </button>
        </div>
      </Modal>
    );
  }

  const footer = (
    <div className="flex flex-wrap items-center gap-3">
      {isApplicant ? (
        existingApplication ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4" />
              Applied · {STAGE_LABELS[existingApplication.stage] ?? existingApplication.stage}
            </span>
            <button
              onClick={() => navigate('/portal/applications')}
              className="group inline-flex items-center gap-2 px-4 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              Track your application
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </>
        ) : (
          <button
            onClick={() => navigate(`/jobs/${slug}/apply`)}
            className="group inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            Apply now
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )
      ) : (
        <button
          onClick={() => (onRefer ? onRefer(job) : navigate('/employee/refer'))}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-lg text-sm transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Refer a candidate
        </button>
      )}
      <a
        href={`/jobs/${slug}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 ml-auto"
      >
        Open full posting <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );

  return (
    <Modal
      onClose={onClose}
      size="3xl"
      icon={Building2}
      title={job.title}
      description={`Nablon AI${departmentName ? ` · ${departmentName}` : ''}`}
      footer={footer}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {job.location && <Chip icon={MapPin}>{job.location}</Chip>}
          {job.location_type && <Chip><span className="capitalize">{job.location_type}</span></Chip>}
          {job.employment_type && <Chip icon={Briefcase}>{formatEmploymentType(job.employment_type)}</Chip>}
          {(job.experience_min != null || job.experience_max != null) && (
            <Chip icon={Users}>{job.experience_min ?? 0}–{job.experience_max ?? '∞'} yrs exp</Chip>
          )}
          {job.openings > 0 && (
            <Chip icon={Users}>{job.openings} opening{job.openings !== 1 ? 's' : ''}</Chip>
          )}
          {salary && <Chip icon={IndianRupee} tone="brand">{salary}</Chip>}
          {job.closes_at && (
            <Chip icon={CalendarDays}>Closes {new Date(job.closes_at).toLocaleDateString()}</Chip>
          )}
        </div>

        {job.skills_required?.length > 0 && (
          <Section icon={Sparkles} title="Skills">
            <div className="flex flex-wrap gap-1.5">
              {job.skills_required.map((skill) => (
                <span key={skill} className="text-xs px-2.5 py-1 bg-brand-50 border border-brand-100 text-brand-700 rounded-lg font-medium">
                  {skill}
                </span>
              ))}
            </div>
          </Section>
        )}

        <Section icon={FileText} title="About the role">
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: job.description }} />
        </Section>

        {job.requirements && (
          <Section icon={ListChecks} title="Requirements">
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: job.requirements }} />
          </Section>
        )}

        {job.benefits && (
          <Section icon={Gift} title="Benefits">
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: job.benefits }} />
          </Section>
        )}
      </div>
    </Modal>
  );
}
