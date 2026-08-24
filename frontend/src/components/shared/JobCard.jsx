import { MapPin, Briefcase, Clock, Building2, Users, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { TiltCard } from '@/components/shared/effects';
import { formatEmploymentType } from '@/constants/jobOptions';

// The public marketing board's job card: one big click target with a 3D tilt.
// The logged-in portal uses PortalJobCard instead — it needs a status badge and
// two or three distinct footer actions, which don't fit inside a single button.
export default function JobCard({ job, onClick, ctaLabel = 'View details' }) {
  return (
    <TiltCard maxTilt={7} className="h-full">
      <button
        type="button"
        onClick={onClick}
        className="group relative flex flex-col h-full w-full text-left bg-white rounded-2xl border border-surface-200 overflow-hidden hover:border-brand-300 hover:shadow-xl transition-all duration-300"
      >
        <div className="tilt-glare z-10" />
        <div className="h-1 bg-gradient-to-r from-brand-400 via-brand-500 to-brand-600 opacity-80 group-hover:opacity-100 transition-opacity" />

        <div className="flex flex-col flex-1 p-5">
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

          <h3 className="font-display font-bold text-gray-900 text-lg leading-snug group-hover:text-brand-600 transition-colors mb-2">
            {job.title}
          </h3>

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
              {ctaLabel}
              <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </div>
      </button>
    </TiltCard>
  );
}
