import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Briefcase, Clock, Users, ArrowLeft, Building2, DollarSign, ExternalLink } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { jobsApi } from '@/api/jobs';
import { useAuthStore } from '@/store/authStore';

function formatEmploymentType(val) {
  return val?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '';
}

export default function JobDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { accessToken } = useAuthStore();

  const { data: job, isLoading, isError } = useQuery({
    queryKey: ['job', slug],
    queryFn: () => jobsApi.getBySlug(slug).then((r) => r.data),
  });

  const handleApply = () => {
    if (!accessToken) {
      navigate('/register', { state: { from: { pathname: `/jobs/${slug}/apply` } } });
    } else {
      navigate(`/jobs/${slug}/apply`);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
        <div className="h-8 bg-surface-100 rounded w-2/3 mb-4" />
        <div className="flex gap-3 mb-6">
          <div className="h-5 bg-surface-100 rounded w-20" />
          <div className="h-5 bg-surface-100 rounded w-24" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 bg-surface-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-20 text-center">
        <h2 className="font-display text-2xl font-bold text-gray-800 mb-2">Job not found</h2>
        <p className="text-gray-500 mb-6">This role may have been filled or removed.</p>
        <Link to="/jobs" className="text-brand-600 hover:text-brand-700 font-medium">
          ← View all openings
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {/* Back */}
      <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft className="w-4 h-4" />
        All openings
      </Link>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-6 h-6 text-brand-500" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-gray-900 mb-1">{job.title}</h1>
              <p className="text-sm text-gray-500">Nablon AI</p>
            </div>
          </div>

          {/* Meta chips */}
          <div className="flex flex-wrap gap-2 mb-8">
            {job.location && (
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-600 bg-surface-50 border border-surface-200 px-3 py-1.5 rounded-lg">
                <MapPin className="w-3.5 h-3.5 text-gray-400" />
                {job.location}
              </span>
            )}
            {job.location_type && (
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-600 bg-surface-50 border border-surface-200 px-3 py-1.5 rounded-lg capitalize">
                {job.location_type}
              </span>
            )}
            {job.employment_type && (
              <span className="inline-flex items-center gap-1.5 text-sm text-brand-700 bg-brand-50 border border-brand-100 px-3 py-1.5 rounded-lg">
                <Briefcase className="w-3.5 h-3.5" />
                {formatEmploymentType(job.employment_type)}
              </span>
            )}
            {(job.experience_min != null || job.experience_max != null) && (
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-600 bg-surface-50 border border-surface-200 px-3 py-1.5 rounded-lg">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                {job.experience_min ?? 0}–{job.experience_max ?? '∞'} yrs exp
              </span>
            )}
            {job.show_salary && job.salary_min && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-700 bg-green-50 border border-green-100 px-3 py-1.5 rounded-lg">
                <DollarSign className="w-3.5 h-3.5" />
                {job.salary_currency} {(job.salary_min / 100000).toFixed(1)}L
                {job.salary_max ? ` – ${(job.salary_max / 100000).toFixed(1)}L` : '+'}
              </span>
            )}
            {job.published_at && (
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 px-1">
                <Clock className="w-3.5 h-3.5" />
                Posted {formatDistanceToNow(new Date(job.published_at), { addSuffix: true })}
              </span>
            )}
          </div>

          {/* Skills */}
          {job.skills_required?.length > 0 && (
            <div className="mb-8">
              <h2 className="font-display font-semibold text-gray-900 mb-3">Skills</h2>
              <div className="flex flex-wrap gap-2">
                {job.skills_required.map((skill) => (
                  <span key={skill} className="text-sm px-3 py-1 bg-surface-100 text-gray-700 rounded-lg">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="mb-8">
            <h2 className="font-display font-semibold text-gray-900 mb-3">About the role</h2>
            <div
              className="prose prose-sm max-w-none text-gray-700"
              dangerouslySetInnerHTML={{ __html: job.description }}
            />
          </div>

          {/* Requirements */}
          {job.requirements && (
            <div className="mb-8">
              <h2 className="font-display font-semibold text-gray-900 mb-3">Requirements</h2>
              <div
                className="prose prose-sm max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: job.requirements }}
              />
            </div>
          )}

          {/* Benefits */}
          {job.benefits && (
            <div className="mb-8">
              <h2 className="font-display font-semibold text-gray-900 mb-3">Benefits</h2>
              <div
                className="prose prose-sm max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: job.benefits }}
              />
            </div>
          )}
        </div>

        {/* Sticky apply card */}
        <div className="lg:w-72 flex-shrink-0">
          <div className="sticky top-24 bg-white rounded-2xl border border-surface-200 shadow-card p-6">
            <h3 className="font-display font-semibold text-gray-900 mb-1">{job.title}</h3>
            <p className="text-sm text-gray-500 mb-5">Nablon AI · {job.openings} opening{job.openings !== 1 ? 's' : ''}</p>

            <button
              onClick={handleApply}
              className="w-full py-3 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 transition-colors flex items-center justify-center gap-2"
            >
              Apply now
              <ExternalLink className="w-4 h-4" />
            </button>

            {!accessToken && (
              <p className="text-xs text-gray-400 text-center mt-3">
                You'll be asked to create an account
              </p>
            )}

            <div className="mt-6 pt-5 border-t border-surface-100 space-y-2 text-sm text-gray-600">
              {job.closes_at && (
                <p>
                  <span className="text-gray-400">Closes: </span>
                  {new Date(job.closes_at).toLocaleDateString()}
                </p>
              )}
              {job.openings && (
                <p>
                  <span className="text-gray-400">Openings: </span>
                  {job.openings}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
