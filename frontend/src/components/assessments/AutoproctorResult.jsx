import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, ShieldAlert, FileSpreadsheet, FileText, Smartphone, ExternalLink,
  Loader2, CheckCircle2, XCircle, Clock, Monitor, ChevronDown,
} from 'lucide-react';
import { autoproctorApi } from '@/api/autoproctor';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/utils';
import { formatIST } from '@/utils/formatters';
import { TRUST_BAR, SCORE_BAR, VIOLATIONS, meetsBar, formatDuration } from '@/constants/assessmentResults';

// Quiz score as a bar against the shortlist bar. Colour encodes pass/below
// the bar, and the number is always printed — never colour alone.
export function ScoreBar({ pct, points, max, className }) {
  if (pct == null) return <span className="text-xs text-gray-400">Not graded</span>;
  const ok = pct > SCORE_BAR;
  return (
    <div className={cn('min-w-[110px]', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-sm font-semibold tabular-nums', ok ? 'text-emerald-700' : 'text-amber-700')}>{pct}%</span>
        {points != null && max != null && (
          <span className="text-[11px] text-gray-400 tabular-nums">{points}/{max}</span>
        )}
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-surface-100 overflow-hidden">
        <div className={cn('h-full rounded-full', ok ? 'bg-emerald-500' : 'bg-amber-400')} style={{ width: `${Math.min(100, pct)}%` }} />
        <span className="absolute top-0 h-full w-px bg-gray-400" style={{ left: `${SCORE_BAR}%` }} title={`Shortlist bar: ${SCORE_BAR}%`} />
      </div>
    </div>
  );
}

export function TrustChip({ pct }) {
  if (pct == null) return <span className="text-xs text-gray-400">—</span>;
  const ok = pct > TRUST_BAR;
  const Icon = ok ? ShieldCheck : ShieldAlert;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums',
      ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
    )}>
      <Icon className="w-3.5 h-3.5" /> {pct}%
    </span>
  );
}

export function ViolationBadge({ total }) {
  if (!total) return <span className="text-xs text-gray-400">None</span>;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 text-xs font-semibold tabular-nums">
      {total} flag{total === 1 ? '' : 's'}
    </span>
  );
}

export function BarVerdict({ attempt }) {
  if (attempt?.percentage_scored == null || attempt?.trust_score_pct == null) return null;
  const ok = meetsBar(attempt);
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-xs font-medium',
      ok ? 'text-emerald-700' : 'text-gray-500',
    )}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {ok ? 'Meets shortlist bar' : 'Below shortlist bar'}
    </span>
  );
}

function DownloadLink({ href, icon: Icon, label, hint }) {
  if (!href) {
    return (
      <span className="flex items-center gap-2.5 rounded-xl border border-dashed border-surface-300 px-3 py-2.5 text-xs text-gray-400">
        <Icon className="w-4 h-4" /> {label} — not available
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-xl border border-surface-200 bg-white px-3 py-2.5 hover:border-brand-300 hover:shadow-card transition-all"
    >
      <span className="w-8 h-8 shrink-0 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-800 truncate">{label}</span>
        {hint && <span className="block text-[11px] text-gray-400 truncate">{hint}</span>}
      </span>
    </a>
  );
}

function ReportChip({ href, icon: Icon, label }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-300 hover:text-brand-700 transition-colors"
    >
      <Icon className="w-3.5 h-3.5 text-brand-600" /> {label}
    </a>
  );
}

// Compact block under an assessment on the candidate page: headline numbers
// plus the three stored reports, so HR can open them without the pop-up.
export function AttemptSummary({ attempt, onOpen }) {
  return (
    <div className="mt-3 pt-3 border-t border-surface-100 space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <ScoreBar pct={attempt.percentage_scored} points={attempt.points_scored} max={attempt.points_available} />
        <div>
          <p className="text-[11px] text-gray-400 mb-0.5">Trust score</p>
          <TrustChip pct={attempt.trust_score_pct} />
        </div>
        <div>
          <p className="text-[11px] text-gray-400 mb-0.5">Proctoring</p>
          <ViolationBadge total={attempt.violation_total} />
        </div>
        <div>
          <p className="text-[11px] text-gray-400 mb-0.5">Submitted</p>
          <p className="text-xs text-gray-700">{formatIST(attempt.finished_at, 'dd MMM, h:mm a')}</p>
        </div>
        <div className="flex-1" />
        <BarVerdict attempt={attempt} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ReportChip href={attempt.responses_file_url} icon={FileSpreadsheet} label="All responses" />
        {/* PDFs exist only for attempts imported before PDF generation was dropped. */}
        <ReportChip href={attempt.proctoring_report_url} icon={FileText} label="Proctoring report" />
        <ReportChip href={attempt.aux_report_url} icon={Smartphone} label="Auxiliary device report" />
        <ReportChip href={attempt.autoproctor_url} icon={ExternalLink} label="Proctoring evidence" />
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto text-xs font-semibold text-brand-600 hover:text-brand-700"
        >
          View full report
        </button>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, children }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ResponseRow({ r }) {
  const [open, setOpen] = useState(false);
  const full = r.points != null && r.max_points != null && Number(r.points) >= Number(r.max_points);
  const zero = r.points != null && Number(r.points) === 0;
  return (
    <li className="py-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-start gap-3 text-left">
        <span className="w-6 shrink-0 text-xs font-semibold text-gray-400 tabular-nums pt-0.5">{r.number}.</span>
        <span className={cn('flex-1 text-sm text-gray-800', !open && 'line-clamp-2')}>{r.question || '—'}</span>
        <span className={cn(
          'shrink-0 text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full',
          full ? 'bg-emerald-50 text-emerald-700' : zero ? 'bg-rose-50 text-rose-700' : 'bg-surface-100 text-gray-600',
        )}>
          {r.points ?? '—'}{r.max_points != null ? ` / ${r.max_points}` : ''}
        </span>
        <ChevronDown className={cn('w-4 h-4 shrink-0 text-gray-400 transition-transform mt-0.5', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="ml-9 mt-2 rounded-lg bg-surface-50 border border-surface-200 p-3">
          <p className="text-[11px] font-semibold text-gray-500 mb-1">Candidate's answer</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.answer || <span className="text-gray-400">No answer</span>}</p>
        </div>
      )}
    </li>
  );
}

export function AttemptDetailModal({ attemptId, onClose }) {
  const { data: a, isLoading } = useQuery({
    queryKey: ['autoproctor-attempt', attemptId],
    queryFn: () => autoproctorApi.attempt(attemptId).then((r) => r.data),
    enabled: !!attemptId,
  });

  return (
    <Modal
      onClose={onClose}
      size="3xl"
      title={a ? (a.candidate_name || a.candidate_email) : 'Assessment report'}
      description={a ? `${a.test_title} · ${a.candidate_email}` : undefined}
    >
      {isLoading || !a ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Quiz score">
              <ScoreBar pct={a.percentage_scored} points={a.points_scored} max={a.points_available} />
            </Stat>
            <Stat label="Trust score"><TrustChip pct={a.trust_score_pct} /></Stat>
            <Stat icon={Clock} label="Time taken">
              <p className="text-sm font-semibold text-gray-800">{formatDuration(a.duration_seconds)}</p>
            </Stat>
            <Stat icon={Monitor} label="Device">
              <p className="text-sm font-semibold text-gray-800 truncate">{a.device_type || '—'}</p>
            </Stat>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <span>
              Started {formatIST(a.started_at, 'dd MMM yyyy, h:mm a')} · Submitted {formatIST(a.finished_at, 'h:mm a')} IST
              {!a.graded && <span className="ml-2 text-amber-600 font-medium">· Grading pending on AutoProctor</span>}
            </span>
            <BarVerdict attempt={a} />
          </div>

          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Proctoring flags</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {VIOLATIONS.map(({ key, label }) => {
                const n = a.violations?.[key];
                return (
                  <div key={key} className={cn(
                    'flex items-center justify-between rounded-lg border px-3 py-2',
                    n ? 'border-rose-200 bg-rose-50/60' : 'border-surface-200 bg-white',
                  )}>
                    <span className="text-xs text-gray-600">{label}</span>
                    <span className={cn('text-sm font-semibold tabular-nums', n ? 'text-rose-700' : 'text-gray-400')}>
                      {n ?? '—'}
                    </span>
                  </div>
                );
              })}
            </div>
            {a.aux_device_verified != null && (
              <p className="mt-2 text-xs text-gray-500 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5" />
                Auxiliary device {a.aux_device_verified ? 'verified' : 'not verified'}
              </p>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Reports</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <DownloadLink href={a.responses_file_url} icon={FileSpreadsheet} label="All responses" hint="Excel · this candidate's answers and points" />
              {a.proctoring_report_url && (
                <DownloadLink href={a.proctoring_report_url} icon={FileText} label="Proctoring report" hint="PDF · evidence from the primary device" />
              )}
              {a.aux_report_url && (
                <DownloadLink href={a.aux_report_url} icon={Smartphone} label="Auxiliary device report" hint="PDF · evidence from the phone camera" />
              )}
              <DownloadLink href={a.autoproctor_url} icon={ExternalLink} label="Proctoring evidence" hint="Photos from both devices, in AutoProctor (login needed)" />
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Question-wise responses {a.responses?.length ? `(${a.responses.length})` : ''}
            </h3>
            {a.responses?.length ? (
              <ul className="divide-y divide-surface-100">
                {a.responses.map((r) => <ResponseRow key={r.number} r={r} />)}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 py-3">Responses weren't available when this attempt was imported.</p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
