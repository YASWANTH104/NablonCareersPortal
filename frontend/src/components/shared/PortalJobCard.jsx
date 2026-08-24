import { MapPin, Briefcase, Users, Clock, IndianRupee } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { CRITICALITY_STYLES, formatEmploymentType, formatSalaryLakhs } from '@/constants/jobOptions';
import { cn } from '@/lib/utils';

// The in-portal job card, shared by Browse Jobs and Refer a Candidate.
//
// Deliberately not `JobCard`: that one is the public marketing board's card —
// a single big click target with a 3D tilt effect — and a portal card needs
// two or three distinct actions in a footer (read the JD, apply, refer) plus
// room for a status badge. The body is one button, the actions are siblings,
// so nothing is nested inside anything clickable.
export default function PortalJobCard({ job, departmentName, badge, onOpen, actions, footerMeta }) {
  const salary = formatSalaryLakhs(job);

  return (
    <div className="group flex flex-col bg-white rounded-2xl border border-surface-200 hover:border-brand-300 hover:shadow-card-hover transition-all overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 text-left p-4 sm:p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset"
      >
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {departmentName && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 truncate max-w-[12rem]">
                {departmentName}
              </span>
            )}
            {job.employment_type && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-100 text-gray-600">
                {formatEmploymentType(job.employment_type)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {badge}
            {job.criticality && job.criticality !== 'low' && (
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wide border',
                  CRITICALITY_STYLES[job.criticality] ?? CRITICALITY_STYLES.medium
                )}
              >
                {job.criticality}
              </span>
            )}
          </div>
        </div>

        <h3 className="font-display font-bold text-gray-900 leading-snug group-hover:text-brand-600 transition-colors">
          {job.title}
        </h3>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mt-2">
          {(job.location || job.location_type) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-gray-400" />
              {job.location ?? ''}
              {job.location && job.location_type ? ' · ' : ''}
              <span className="capitalize">{job.location_type ?? ''}</span>
            </span>
          )}
          {(job.experience_min != null || job.experience_max != null) && (
            <span className="inline-flex items-center gap-1">
              <Briefcase className="w-3.5 h-3.5 text-gray-400" />
              {job.experience_min ?? 0}–{job.experience_max ?? '∞'} yrs
            </span>
          )}
          {job.openings > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5 text-gray-400" />
              {job.openings} opening{job.openings !== 1 ? 's' : ''}
            </span>
          )}
          {salary && (
            <span className="inline-flex items-center gap-1 font-medium text-gray-600">
              <IndianRupee className="w-3.5 h-3.5 text-gray-400" />
              {salary}
            </span>
          )}
        </div>

        {job.skills_required?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {job.skills_required.slice(0, 4).map((skill) => (
              <span key={skill} className="text-[11px] px-2 py-0.5 bg-surface-50 border border-surface-200 text-gray-600 rounded-md">
                {skill}
              </span>
            ))}
            {job.skills_required.length > 4 && (
              <span className="text-[11px] px-1 py-0.5 text-gray-400">+{job.skills_required.length - 4}</span>
            )}
          </div>
        )}
      </button>

      <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-t border-surface-100 bg-surface-50/50">
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 mr-auto min-w-0 truncate">
          {footerMeta ?? (
            <>
              <Clock className="w-3 h-3 shrink-0" />
              {job.published_at
                ? formatDistanceToNow(new Date(job.published_at), { addSuffix: true })
                : 'Recently posted'}
            </>
          )}
        </span>
        {actions}
      </div>
    </div>
  );
}
