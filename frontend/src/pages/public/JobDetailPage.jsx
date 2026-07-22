import { useEffect } from 'react';
import { Link, useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  MapPin,
  Briefcase,
  Clock,
  Users,
  ArrowLeft,
  ArrowRight,
  Building2,
  IndianRupee,
  CalendarDays,
  Sparkles,
  ListChecks,
  Gift,
  FileText,
  Download,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { jobsApi } from '@/api/jobs';
import { useAuthStore } from '@/store/authStore';
import { HeroBackdrop, Reveal } from '@/components/shared/effects';

function formatEmploymentType(val) {
  return val?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '';
}

function HeroChip({ icon: Icon, children, tone = 'default' }) {
  const tones = {
    default: 'text-brand-100 bg-white/[0.08] border-white/10',
    accent: 'text-white bg-brand-500/30 border-brand-400/30',
    success: 'text-emerald-200 bg-emerald-400/10 border-emerald-300/20',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border backdrop-blur ${tones[tone]}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5 opacity-80" />}
      {children}
    </span>
  );
}

function ContentSection({ icon: Icon, title, children, delay = 0 }) {
  return (
    <Reveal delay={delay}>
      <section className="bg-white rounded-2xl border border-surface-200 shadow-card p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 border border-brand-100 flex items-center justify-center">
            <Icon className="w-[18px] h-[18px] text-brand-600" />
          </div>
          <h2 className="font-display text-lg font-bold text-gray-900">{title}</h2>
        </div>
        {children}
      </section>
    </Reveal>
  );
}

export default function JobDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { accessToken } = useAuthStore();
  const isAgencyMode = location.pathname.startsWith('/agency-apply');

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) {
      sessionStorage.setItem('agency_ref', ref);
      if (!isAgencyMode) {
        // Redirect to focused apply layout
        navigate(`/agency-apply/${slug}`, { replace: true });
      }
    }
  }, [searchParams]);

  const { data: job, isLoading, isError } = useQuery({
    queryKey: ['job', slug],
    queryFn: () => jobsApi.getBySlug(slug).then((r) => r.data),
  });

  const handleApply = () => {
    const applyPath = isAgencyMode ? `/agency-apply/${slug}/apply` : `/jobs/${slug}/apply`;
    if (!accessToken) {
      sessionStorage.setItem('agency_return_to', applyPath);
      navigate('/register', { state: { from: { pathname: applyPath } } });
    } else {
      navigate(applyPath);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="bg-gray-950 pt-12 pb-20 px-4">
          <div className="max-w-5xl mx-auto">
            <div className="h-4 bg-white/10 rounded w-28 mb-8" />
            <div className="h-9 bg-white/10 rounded w-2/3 mb-4" />
            <div className="flex gap-2">
              <div className="h-8 bg-white/10 rounded-full w-28" />
              <div className="h-8 bg-white/10 rounded-full w-24" />
              <div className="h-8 bg-white/10 rounded-full w-32" />
            </div>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 bg-surface-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-24 text-center">
        <div className="w-14 h-14 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-5">
          <Briefcase className="w-7 h-7 text-surface-300" />
        </div>
        <h2 className="font-display text-2xl font-bold text-gray-800 mb-2">Job not found</h2>
        <p className="text-gray-500 mb-6">This role may have been filled or removed.</p>
        <Link
          to="/jobs"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          View all openings
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-clip pb-16">
      {/* ── HERO — same visual language as landing & jobs ────── */}
      <section className="relative bg-gray-950 overflow-hidden">
        <HeroBackdrop particles={false} />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-24 pb-24 sm:pb-28">
          {/* Back — hidden in agency focused mode */}
          {!isAgencyMode && (
            <Link
              to="/jobs"
              className="inline-flex items-center gap-1.5 text-sm text-brand-200/80 hover:text-white transition-colors mb-8"
            >
              <ArrowLeft className="w-4 h-4" />
              All openings
            </Link>
          )}

          <Reveal>
            <div className="flex items-start gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.08] border border-white/15 backdrop-blur flex items-center justify-center flex-shrink-0 shadow-[0_10px_30px_-10px_rgba(79,94,255,0.5)]">
                <Building2 className="w-7 h-7 text-brand-300" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-3xl sm:text-4xl font-bold text-white leading-tight mb-2">
                  {job.title}
                </h1>
                <p className="text-sm text-brand-200/80 flex items-center gap-2 flex-wrap">
                  Nablon AI
                  {job.published_at && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-brand-200/40" />
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        Posted {formatDistanceToNow(new Date(job.published_at), { addSuffix: true })}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="flex flex-wrap gap-2">
              {job.location && <HeroChip icon={MapPin}>{job.location}</HeroChip>}
              {job.location_type && (
                <HeroChip>
                  <span className="capitalize">{job.location_type}</span>
                </HeroChip>
              )}
              {job.employment_type && (
                <HeroChip icon={Briefcase} tone="accent">
                  {formatEmploymentType(job.employment_type)}
                </HeroChip>
              )}
              {(job.experience_min != null || job.experience_max != null) && (
                <HeroChip icon={Users}>
                  {job.experience_min ?? 0}–{job.experience_max ?? '∞'} yrs exp
                </HeroChip>
              )}
              {job.show_salary && job.salary_min && (
                <HeroChip icon={IndianRupee} tone="success">
                  {job.salary_currency} {(job.salary_min / 100000).toFixed(1)}L
                  {job.salary_max ? ` – ${(job.salary_max / 100000).toFixed(1)}L` : '+'}
                </HeroChip>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── CONTENT — overlaps the hero bottom ───────────────── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 -mt-12 relative z-10">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Skills */}
            {job.skills_required?.length > 0 && (
              <ContentSection icon={Sparkles} title="Skills">
                <div className="flex flex-wrap gap-2">
                  {job.skills_required.map((skill) => (
                    <span
                      key={skill}
                      className="text-sm px-3 py-1.5 bg-brand-50 border border-brand-100 text-brand-700 rounded-lg font-medium"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </ContentSection>
            )}

            {/* Description */}
            <ContentSection icon={FileText} title="About the role" delay={80}>
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: job.description }}
              />
            </ContentSection>

            {/* Requirements */}
            {job.requirements && (
              <ContentSection icon={ListChecks} title="Requirements" delay={120}>
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: job.requirements }}
                />
              </ContentSection>
            )}

            {/* Benefits */}
            {job.benefits && (
              <ContentSection icon={Gift} title="Benefits" delay={160}>
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: job.benefits }}
                />
              </ContentSection>
            )}
          </div>

          {/* Sticky apply card */}
          <div className="lg:w-80 flex-shrink-0">
            <div className="sticky top-24">
              <div className="relative overflow-hidden bg-white rounded-2xl border border-surface-200 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.35)] p-6">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-brand-400 via-brand-500 to-brand-600" />
                <h3 className="font-display font-bold text-gray-900 mb-1">{job.title}</h3>
                <p className="text-sm text-gray-500 mb-5">
                  Nablon AI · {job.openings} opening{job.openings !== 1 ? 's' : ''}
                </p>

                <button
                  onClick={handleApply}
                  className="group w-full py-3.5 bg-brand-500 hover:bg-brand-400 text-white font-semibold rounded-xl text-sm shadow-[0_10px_35px_-10px_rgba(79,94,255,0.7)] hover:shadow-[0_14px_45px_-10px_rgba(79,94,255,0.9)] transition-all flex items-center justify-center gap-2"
                >
                  Apply now
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>

                {!accessToken && (
                  <p className="text-xs text-gray-400 text-center mt-3">
                    You'll be asked to create an account
                  </p>
                )}

                {job.jd_pdf_url && (
                  <a
                    href={job.jd_pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 w-full py-2.5 border border-brand-200 text-brand-700 bg-brand-50/60 hover:bg-brand-50 font-medium rounded-xl text-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Full job description (PDF)
                  </a>
                )}

                <div className="mt-6 pt-5 border-t border-surface-100 space-y-3 text-sm">
                  {job.closes_at && (
                    <p className="flex items-center gap-2 text-gray-600">
                      <CalendarDays className="w-4 h-4 text-gray-400" />
                      <span>
                        <span className="text-gray-400">Closes </span>
                        {new Date(job.closes_at).toLocaleDateString()}
                      </span>
                    </p>
                  )}
                  {job.openings && (
                    <p className="flex items-center gap-2 text-gray-600">
                      <Users className="w-4 h-4 text-gray-400" />
                      <span>
                        <span className="text-gray-400">Openings </span>
                        {job.openings}
                      </span>
                    </p>
                  )}
                  {job.location && (
                    <p className="flex items-center gap-2 text-gray-600">
                      <MapPin className="w-4 h-4 text-gray-400" />
                      {job.location}
                    </p>
                  )}
                </div>
              </div>

              {/* Process reassurance */}
              {!isAgencyMode && (
                <div className="mt-4 bg-brand-50/70 border border-brand-100 rounded-2xl p-5">
                  <p className="text-sm font-semibold text-brand-800 mb-1.5">Transparent process</p>
                  <p className="text-xs text-brand-700/80 leading-relaxed">
                    Track every stage — screening, interviews, offer — live in your candidate portal
                    after you apply.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
