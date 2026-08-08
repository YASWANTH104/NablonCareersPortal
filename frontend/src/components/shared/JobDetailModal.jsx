import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  X, MapPin, Briefcase, Users, IndianRupee, CalendarDays,
  Sparkles, FileText, ListChecks, Gift, ArrowRight, ExternalLink,
} from 'lucide-react';
import { jobsApi } from '@/api/jobs';

function formatEmploymentType(val) {
  return val?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '';
}

function Chip({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-surface-100 text-gray-600 rounded-full font-medium">
      {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
      {children}
    </span>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-brand-500" />
        <h4 className="font-display font-semibold text-gray-900 text-sm">{title}</h4>
      </div>
      {children}
    </div>
  );
}

// Same information depth as the public job detail page (title, meta, skills,
// full description/requirements/benefits) but styled to sit inside the
// portal shell instead of the public marketing hero — opened from Browse
// Jobs so candidates/employees never have to leave the portal just to read
// a JD clearly.
export default function JobDetailModal({ slug, onClose }) {
  const navigate = useNavigate();

  const { data: job, isLoading, isError } = useQuery({
    queryKey: ['job', slug],
    queryFn: () => jobsApi.getBySlug(slug).then((r) => r.data),
  });

  const handleApply = () => navigate(`/jobs/${slug}/apply`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90dvh] overflow-y-auto">
        {isLoading ? (
          <div className="p-4 sm:p-6 animate-pulse space-y-4">
            <div className="h-6 bg-surface-100 rounded w-2/3" />
            <div className="flex gap-2">
              <div className="h-6 bg-surface-100 rounded-full w-20" />
              <div className="h-6 bg-surface-100 rounded-full w-24" />
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-3 bg-surface-100 rounded" />
            ))}
          </div>
        ) : isError || !job ? (
          <div className="p-10 text-center">
            <p className="text-sm text-gray-500">Couldn't load this role — it may have been removed.</p>
            <button onClick={onClose} className="mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-surface-200 px-4 sm:px-6 py-4 flex items-start justify-between gap-4 z-10">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold text-gray-900 leading-snug">{job.title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Nablon AI{job.department_name ? ` · ${job.department_name}` : ''}
                </p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-surface-100 hover:text-gray-600 flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-5">
              <div className="flex flex-wrap gap-2">
                {job.location && <Chip icon={MapPin}>{job.location}</Chip>}
                {job.location_type && <Chip><span className="capitalize">{job.location_type}</span></Chip>}
                {job.employment_type && <Chip icon={Briefcase}>{formatEmploymentType(job.employment_type)}</Chip>}
                {(job.experience_min != null || job.experience_max != null) && (
                  <Chip icon={Users}>{job.experience_min ?? 0}–{job.experience_max ?? '∞'} yrs exp</Chip>
                )}
                {job.show_salary && job.salary_min && (
                  <Chip icon={IndianRupee}>
                    {job.salary_currency} {(job.salary_min / 100000).toFixed(1)}L
                    {job.salary_max ? ` – ${(job.salary_max / 100000).toFixed(1)}L` : '+'}
                  </Chip>
                )}
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

            <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-surface-200 px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3">
              <button
                onClick={handleApply}
                className="group flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-lg text-sm transition-colors"
              >
                Apply now
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
              <a
                href={`/jobs/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
              >
                Open full posting <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
