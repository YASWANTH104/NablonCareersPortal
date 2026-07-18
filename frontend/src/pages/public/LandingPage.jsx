import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Sparkles,
  MapPin,
  Briefcase,
  Users,
  Brain,
  Rocket,
  HeartHandshake,
  GraduationCap,
  Globe2,
  ShieldCheck,
  FileText,
  PhoneCall,
  ClipboardCheck,
  MessagesSquare,
  Award,
  ChevronRight,
  Building2,
} from 'lucide-react';
import { jobsApi } from '@/api/jobs';
import { HeroBackdrop, TiltCard, Reveal } from '@/components/shared/effects';

/* ────────────────────────────────────────────────────────────────
   Hero: floating glass cards with mouse parallax in 3D space
   ──────────────────────────────────────────────────────────────── */
const FLOATING_CARDS = [
  {
    icon: FileText,
    title: 'Application received',
    sub: 'Senior ML Engineer',
    accent: 'from-sky-400/30 to-brand-500/20',
    depth: 40,
    pos: 'top-[6%] right-[2%]',
    float: 'float-a',
  },
  {
    icon: MessagesSquare,
    title: 'Interview scheduled',
    sub: 'Technical Round 1 · Tomorrow',
    accent: 'from-brand-400/30 to-violet-500/20',
    depth: 90,
    pos: 'top-[38%] right-[18%]',
    float: 'float-b',
  },
  {
    icon: Award,
    title: 'Offer extended',
    sub: 'Welcome to Nablon 🎉',
    accent: 'from-emerald-400/30 to-brand-500/20',
    depth: 60,
    pos: 'bottom-[8%] right-[5%]',
    float: 'float-c',
  },
];

function HeroVisual() {
  const wrapRef = useRef(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    const el = wrapRef.current;
    if (!el) return;

    function onMove(e) {
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.setProperty('--par-x', px.toFixed(3));
      el.style.setProperty('--par-y', py.toFixed(3));
    }
    const section = el.closest('section');
    section?.addEventListener('mousemove', onMove);
    return () => section?.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative h-[340px] lg:h-[440px] select-none hidden md:block"
      style={{ perspective: '1200px', '--par-x': 0, '--par-y': 0 }}
      aria-hidden="true"
    >
      {FLOATING_CARDS.map((card) => (
        <div
          key={card.title}
          className={`absolute ${card.pos} ${card.float}`}
          style={{
            transform: `translate3d(calc(var(--par-x) * ${card.depth * -0.6}px), calc(var(--par-y) * ${card.depth * -0.6}px), 0)`,
            transition: 'transform 0.25s ease-out',
          }}
        >
          <div
            className={`w-60 lg:w-64 rounded-2xl border border-white/15 bg-white/[0.07] backdrop-blur-xl shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)] p-4 bg-gradient-to-br ${card.accent}`}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center flex-shrink-0">
                <card.icon className="w-[18px] h-[18px] text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{card.title}</p>
                <p className="text-xs text-brand-200/90 truncate">{card.sub}</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-brand-400 to-brand-300 progress-shimmer" />
            </div>
          </div>
        </div>
      ))}

      {/* central glowing orb ring */}
      <div
        className="absolute left-[8%] top-1/2 -translate-y-1/2 w-64 h-64 lg:w-80 lg:h-80"
        style={{
          transform: 'translate3d(calc(var(--par-x) * 20px), calc(-50% + var(--par-y) * 20px), 0)',
          transition: 'transform 0.3s ease-out',
        }}
      >
        <div className="absolute inset-0 rounded-full bg-brand-500/25 blur-[70px]" />
        <div className="absolute inset-6 rounded-full border border-brand-300/25 spin-slow" />
        <div className="absolute inset-14 rounded-full border border-dashed border-brand-300/30 spin-slower" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-400 to-brand-700 shadow-[0_0_60px_rgba(79,94,255,0.55)] border border-white/20 flex items-center justify-center float-b">
            <Brain className="w-9 h-9 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Static content
   ──────────────────────────────────────────────────────────────── */
const VALUE_PROPS = [
  {
    icon: Brain,
    title: 'Frontier AI, in production',
    text: 'We ship agentic AI systems that run real workflows for Fortune 500 companies — not demos, not decks.',
  },
  {
    icon: Rocket,
    title: 'Ship fast, own outcomes',
    text: 'Small teams with real ownership. Your work goes to production and in front of enterprise users quickly.',
  },
  {
    icon: Globe2,
    title: 'Four industries, one platform',
    text: 'CPG, Banking, MedTech and Industrial — solve deep, varied problems instead of one narrow domain.',
  },
  {
    icon: GraduationCap,
    title: 'Learn at the edge',
    text: 'Work hands-on with the latest models, evals and agent scaffolding, alongside people who build them daily.',
  },
  {
    icon: HeartHandshake,
    title: 'A transparent process',
    text: 'Track every stage of your application in real time — from screening to offer — right here in this portal.',
  },
  {
    icon: ShieldCheck,
    title: 'Respect for your time',
    text: 'Structured interviews, clear feedback, and decisions communicated promptly at every step.',
  },
];

const PROCESS_STEPS = [
  { icon: FileText, title: 'Apply', text: 'Submit your application in minutes — no lengthy forms.' },
  { icon: PhoneCall, title: 'Screening', text: 'A quick conversation to align on role, experience and expectations.' },
  { icon: ClipboardCheck, title: 'Assessment', text: 'A practical, role-relevant exercise for select positions.' },
  { icon: MessagesSquare, title: 'Interviews', text: 'Technical and HR rounds with the team you would join.' },
  { icon: Award, title: 'Offer', text: 'Digital offer, e-signature and onboarding — all in the portal.' },
];

function formatEmploymentType(val) {
  return val?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '';
}

function FeaturedJobCard({ job }) {
  return (
    <TiltCard maxTilt={7} className="h-full">
      <Link
        to={`/jobs/${job.slug}`}
        className="group relative flex flex-col h-full bg-white rounded-2xl border border-surface-200 p-5 hover:border-brand-300 hover:shadow-xl transition-all duration-300 overflow-hidden"
      >
        <div className="tilt-glare" />
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 border border-brand-100 flex items-center justify-center">
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
              {job.experience_min ?? 0}–{job.experience_max ?? '∞'} yrs
            </span>
          )}
        </div>

        <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
          View role
          <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </Link>
    </TiltCard>
  );
}

/* ────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const { data: jobsData } = useQuery({
    queryKey: ['public-jobs', 'featured'],
    queryFn: () => jobsApi.list({ page: 1, limit: 3 }).then((r) => r.data),
  });

  const openRoles = jobsData?.total ?? null;

  return (
    <div className="overflow-x-clip">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative bg-gray-950 overflow-hidden">
        <HeroBackdrop />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-20 pb-24 lg:pt-28 lg:pb-32">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <Reveal>
                <span className="inline-flex items-center gap-2 text-xs font-medium text-brand-200 bg-white/[0.08] border border-white/10 px-3.5 py-1.5 rounded-full mb-6 backdrop-blur">
                  <Sparkles className="w-3.5 h-3.5" />
                  {openRoles != null ? `${openRoles} open role${openRoles === 1 ? '' : 's'} — we're hiring` : "We're hiring"}
                </span>
              </Reveal>

              <Reveal delay={100}>
                <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.08] mb-6 text-white">
                  Build agentic AI that{' '}
                  <span className="animated-gradient-text">runs the enterprise</span>
                </h1>
              </Reveal>

              <Reveal delay={200}>
                <p className="text-lg text-brand-100/80 max-w-lg mb-8 leading-relaxed">
                  Nablon builds production-grade AI agents for Fortune 500 companies across
                  CPG, Banking, MedTech and Industrial. Come do the most ambitious work of
                  your career.
                </p>
              </Reveal>

              <Reveal delay={300}>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    to="/jobs"
                    className="group inline-flex items-center gap-2 px-6 py-3.5 bg-brand-500 hover:bg-brand-400 text-white font-semibold rounded-xl shadow-[0_10px_35px_-10px_rgba(79,94,255,0.7)] hover:shadow-[0_14px_45px_-10px_rgba(79,94,255,0.9)] transition-all"
                  >
                    Explore open roles
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Link>
                  <Link
                    to="/register"
                    className="inline-flex items-center gap-2 px-6 py-3.5 text-white font-semibold rounded-xl border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] backdrop-blur transition-colors"
                  >
                    Create your profile
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={400}>
                <div className="mt-12 grid grid-cols-3 gap-6 max-w-md">
                  {[
                    { value: 'F500', label: 'Enterprise clients' },
                    { value: '4', label: 'Industry verticals' },
                    { value: '5', label: 'Steps to an offer' },
                  ].map((s) => (
                    <div key={s.label}>
                      <p className="font-display text-2xl lg:text-3xl font-bold text-white">{s.value}</p>
                      <p className="text-xs text-brand-200/70 mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>

            <HeroVisual />
          </div>
        </div>

        {/* bottom fade into the light section */}
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-b from-transparent to-surface-50 pointer-events-none" />
      </section>

      {/* ── WHY NABLON ───────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20 lg:py-24">
        <Reveal className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">Why Nablon</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Serious problems. Real ownership.
          </h2>
          <p className="text-gray-500 text-lg">
            We're a small team doing outsized work — here's what that looks like day to day.
          </p>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {VALUE_PROPS.map((v, i) => (
            <Reveal key={v.title} delay={i * 80}>
              <TiltCard className="h-full">
                <div className="relative h-full bg-white rounded-2xl border border-surface-200 p-6 hover:border-brand-200 hover:shadow-card-hover transition-all overflow-hidden">
                  <div className="tilt-glare" />
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mb-4 shadow-[0_8px_20px_-6px_rgba(79,94,255,0.5)]">
                    <v.icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="font-display font-bold text-gray-900 mb-2">{v.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{v.text}</p>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── HIRING PROCESS ───────────────────────────────────── */}
      <section className="bg-white border-y border-surface-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 lg:py-24">
          <Reveal className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">How it works</p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              From application to offer, fully transparent
            </h2>
            <p className="text-gray-500 text-lg">
              Every stage is tracked in your candidate portal — you always know exactly where you stand.
            </p>
          </Reveal>

          <div className="relative">
            {/* connecting line */}
            <div className="hidden lg:block absolute top-7 left-[10%] right-[10%] h-px bg-gradient-to-r from-brand-100 via-brand-300 to-brand-100" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">
              {PROCESS_STEPS.map((step, i) => (
                <Reveal key={step.title} delay={i * 100} className="relative text-center">
                  <div className="relative w-14 h-14 mx-auto mb-4">
                    <div className="absolute inset-0 rounded-2xl bg-brand-500/15 blur-md" />
                    <div className="relative w-full h-full rounded-2xl bg-white border border-brand-200 shadow-card flex items-center justify-center">
                      <step.icon className="w-6 h-6 text-brand-600" />
                    </div>
                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="font-display font-semibold text-gray-900 mb-1.5">{step.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed max-w-[180px] mx-auto">{step.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURED ROLES ───────────────────────────────────── */}
      {jobsData?.items?.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20 lg:py-24">
          <Reveal className="flex flex-wrap items-end justify-between gap-4 mb-10">
            <div>
              <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">Open positions</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-900">
                Freshly posted roles
              </h2>
            </div>
            <Link
              to="/jobs"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors"
            >
              View all {jobsData.total} roles
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {jobsData.items.map((job, i) => (
              <Reveal key={job.id} delay={i * 100}>
                <FeaturedJobCard job={job} />
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* ── FINAL CTA ────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20 lg:pb-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-gray-950 px-6 py-16 sm:px-16 text-center">
            <div className="absolute -top-24 left-1/4 w-96 h-96 rounded-full bg-brand-600/30 blur-[100px] pointer-events-none" />
            <div className="absolute -bottom-24 right-1/4 w-96 h-96 rounded-full bg-violet-600/25 blur-[100px] pointer-events-none" />
            <div className="relative">
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mb-4">
                Ready to build what's next?
              </h2>
              <p className="text-brand-100/80 text-lg max-w-xl mx-auto mb-8">
                Browse our open roles or create a profile so we can reach out when the right one opens up.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Link
                  to="/jobs"
                  className="group inline-flex items-center gap-2 px-6 py-3.5 bg-brand-500 hover:bg-brand-400 text-white font-semibold rounded-xl shadow-[0_10px_35px_-10px_rgba(79,94,255,0.7)] transition-all"
                >
                  <Users className="w-4 h-4" />
                  Explore open roles
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center gap-2 px-6 py-3.5 text-white font-semibold rounded-xl border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] backdrop-blur transition-colors"
                >
                  Create account
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
