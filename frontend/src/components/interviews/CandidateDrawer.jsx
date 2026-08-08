import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  X, Loader2, FileText, ExternalLink, Linkedin, Github, Globe,
  Briefcase, GraduationCap, Building2, MapPin,
} from 'lucide-react';
import { applicationsApi } from '@/api/applications';

const STAGE_COLORS = {
  applied:    'bg-gray-100 text-gray-700',
  screening:  'bg-blue-100 text-blue-700',
  interview:  'bg-indigo-100 text-indigo-700',
  offer:      'bg-green-100 text-green-700',
  hired:      'bg-emerald-100 text-emerald-700',
  rejected:   'bg-red-100 text-red-700',
  withdrawn:  'bg-orange-100 text-orange-700',
};

export default function CandidateDrawer({ applicationId, isHR, onClose }) {
  const { data: app, isLoading } = useQuery({
    queryKey: ['application-brief', applicationId],
    queryFn: () => applicationsApi.getById(applicationId).then((r) => r.data),
    enabled: !!applicationId,
  });

  const candidate = app?.applicant;
  const profile = app?.candidate_profile;
  const initials = candidate?.full_name
    ?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() ?? '?';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      <div className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
          <h2 className="font-display font-bold text-gray-900 text-base">Candidate Profile</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-100 text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          </div>
        ) : !app ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Could not load candidate details.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-lg flex-shrink-0">
                {candidate?.avatar_url
                  ? <img src={candidate.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                  : initials}
              </div>
              <div>
                <p className="font-display font-bold text-gray-900 text-lg leading-tight">{candidate?.full_name}</p>
                <p className="text-sm text-gray-500">{candidate?.email}</p>
              </div>
            </div>

            <div className="bg-surface-50 rounded-xl p-4 space-y-2">
              {app.job_title && (
                <div className="flex items-center gap-2 text-sm">
                  <Briefcase className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 font-medium">{app.job_title}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STAGE_COLORS[app.stage] ?? 'bg-gray-100 text-gray-700'}`}>
                  {app.stage}
                </span>
                <span className="text-xs text-gray-400">Applied {format(parseISO(app.applied_at), 'MMM d, yyyy')}</span>
              </div>
            </div>

            {profile && (
              <div className="space-y-2.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Profile</p>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  {profile.total_experience && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Briefcase className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span>{profile.total_experience} experience</span>
                    </div>
                  )}
                  {profile.current_company && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Building2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span>{profile.current_designation ? `${profile.current_designation} at ` : ''}{profile.current_company}</span>
                    </div>
                  )}
                  {profile.current_location && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span>{profile.current_location}</span>
                    </div>
                  )}
                  {profile.education && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <GraduationCap className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span>{profile.education}</span>
                    </div>
                  )}
                </div>
                {profile.skills && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {profile.skills.split(',').map((s) => s.trim()).filter(Boolean).map((skill) => (
                      <span key={skill} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full font-medium">
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documents & Links</p>
              <div className="space-y-2">
                {app.resume_url && (
                  <a
                    href={app.resume_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2.5 w-full px-4 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-semibold hover:bg-brand-600 transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    View Resume
                    <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-70" />
                  </a>
                )}
                {app.linkedin_url && (
                  <a href={app.linkedin_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 border border-surface-200 rounded-lg text-sm text-gray-700 hover:bg-surface-50 transition-colors">
                    <Linkedin className="w-4 h-4 text-blue-600" /> LinkedIn
                    <ExternalLink className="w-3.5 h-3.5 ml-auto text-gray-400" />
                  </a>
                )}
                {app.portfolio_url && (
                  <a href={app.portfolio_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 border border-surface-200 rounded-lg text-sm text-gray-700 hover:bg-surface-50 transition-colors">
                    <Globe className="w-4 h-4 text-purple-500" /> Portfolio
                    <ExternalLink className="w-3.5 h-3.5 ml-auto text-gray-400" />
                  </a>
                )}
                {app.github_url && (
                  <a href={app.github_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 border border-surface-200 rounded-lg text-sm text-gray-700 hover:bg-surface-50 transition-colors">
                    <Github className="w-4 h-4 text-gray-800" /> GitHub
                    <ExternalLink className="w-3.5 h-3.5 ml-auto text-gray-400" />
                  </a>
                )}
              </div>
            </div>

            {app.cover_letter && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cover Letter</p>
                <p className="text-sm text-gray-700 bg-surface-50 rounded-xl p-4 leading-relaxed whitespace-pre-line">
                  {app.cover_letter}
                </p>
              </div>
            )}

            {isHR && (
              <a
                href={`/hr/applicants/${applicationId}`}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 border border-brand-200 text-brand-600 rounded-lg text-sm font-semibold hover:bg-brand-50 transition-colors"
              >
                Open Full Application
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </>
  );
}
