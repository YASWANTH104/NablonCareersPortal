import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Radar, FileSignature } from 'lucide-react';
import { HeroBackdrop } from '@/components/shared/effects';

const POINTS = [
  {
    icon: Radar,
    title: 'Track every stage',
    text: 'Screening, interviews, offer — followed live in your portal.',
  },
  {
    icon: FileSignature,
    title: 'Digital offers',
    text: 'Review and e-sign your offer letter online, no paperwork.',
  },
  {
    icon: ShieldCheck,
    title: 'Your data, protected',
    text: 'Applications and documents are handled confidentially.',
  },
];

/* Split-screen shell for auth pages: dark brand panel + light form column. */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen flex bg-surface-50">
      {/* ── Brand panel ──────────────────────────────────────── */}
      <div className="relative hidden lg:flex lg:w-[44%] xl:w-2/5 flex-col justify-between bg-gray-950 overflow-hidden p-10 xl:p-14">
        <HeroBackdrop particles={false} />

        <Link to="/" className="relative flex items-center gap-3 w-fit">
          <img src="/logo.jpg" alt="Nablon AI" className="h-10 w-auto rounded-lg object-contain" />
          <div>
            <p className="font-display font-bold text-white leading-tight">Nablon AI</p>
            <p className="text-xs text-brand-200/70">Careers Portal</p>
          </div>
        </Link>

        <div className="relative">
          <h2 className="font-display text-3xl xl:text-4xl font-bold text-white leading-tight mb-4">
            Build agentic AI that{' '}
            <span className="animated-gradient-text">runs the enterprise</span>
          </h2>
          <p className="text-brand-100/70 mb-10 max-w-sm">
            One account for everything — applications, interviews, documents and offers.
          </p>

          <ul className="space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="flex items-start gap-3.5">
                <span className="w-9 h-9 rounded-xl bg-white/[0.08] border border-white/10 backdrop-blur flex items-center justify-center flex-shrink-0">
                  <p.icon className="w-4 h-4 text-brand-300" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{p.title}</span>
                  <span className="block text-sm text-brand-100/60 mt-0.5">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-200/50">
          © {new Date().getFullYear()} Nablon AI · careers.nablon.ai
        </p>
      </div>

      {/* ── Form column ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between p-5 sm:p-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to careers
          </Link>
          {/* Mobile-only logo */}
          <Link to="/" className="lg:hidden">
            <img src="/logo.jpg" alt="Nablon AI" className="h-8 w-auto rounded-lg object-contain" />
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center px-4 pb-12">
          <div className="w-full max-w-[400px]">
            <h1 className="font-display text-2xl sm:text-[1.7rem] font-bold text-gray-900 mb-1.5">
              {title}
            </h1>
            <p className="text-sm text-gray-500 mb-8">{subtitle}</p>

            {children}

            {footer && <div className="mt-8 text-center text-sm text-gray-500">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Consistent field styling for auth forms.
   Must forward its ref to the underlying <input> — react-hook-form's
   register() relies on that ref to actually register the field, and a
   plain function component silently drops it, breaking validation. */
export const AuthInput = forwardRef(function AuthInput(
  { icon: Icon, error, rightSlot, ...props },
  ref
) {
  return (
    <div>
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        )}
        <input
          ref={ref}
          {...props}
          className={`w-full ${Icon ? 'pl-10' : 'pl-3.5'} ${rightSlot ? 'pr-10' : 'pr-3.5'} py-3 bg-white border rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow ${
            error ? 'border-red-300' : 'border-surface-300'
          }`}
        />
        {rightSlot}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
});

export function AuthSubmitButton({ loading, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full flex items-center justify-center gap-2 py-3 bg-brand-500 hover:bg-brand-400 text-white font-semibold rounded-xl text-sm shadow-[0_10px_30px_-10px_rgba(79,94,255,0.6)] hover:shadow-[0_12px_38px_-10px_rgba(79,94,255,0.8)] disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none transition-all"
    >
      {children}
    </button>
  );
}
