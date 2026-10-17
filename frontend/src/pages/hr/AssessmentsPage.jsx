import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck, Hourglass, AlarmClock, Link2, DownloadCloud, Search, Loader2, CheckCircle2,
  AlertTriangle, RefreshCw, History, ListChecks, Unlink, Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { autoproctorApi } from '@/api/autoproctor';
import { PageHeader, StatTile, Segmented, EmptyState, Modal } from '@/components/ui';
import { AttemptDetailModal, ScoreBar, TrustChip, ViolationBadge } from '@/components/assessments/AutoproctorResult';
import { useDebounced } from '@/hooks/useDebounced';
import { formatIST, istDateKey } from '@/utils/formatters';
import { STAGE_MAP } from '@/constants/pipelineStages';

const stageLabel = (key) => STAGE_MAP[key]?.label ?? key;
import { cn } from '@/lib/utils';

const inputCls =
  'w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-400';
const th = 'px-4 py-3 text-left text-xs font-medium text-gray-500';
const MAX_RANGE_DAYS = 31;

const ACTIVE = ['queued', 'running'];

function runLabel(run) {
  return run.range_from
    ? `Manual scrape ${run.range_from}${run.range_to && run.range_to !== run.range_from ? ` → ${run.range_to}` : ''}`
    : 'Nightly sync';
}

function RunStatus({ run, lastSuccessAt }) {
  if (!run) {
    return <p className="text-xs text-gray-500">No sync has run yet. The nightly sync runs at 12:00 AM IST.</p>;
  }
  const label = runLabel(run);
  if (run.status === 'queued') {
    return (
      <p className="flex items-center gap-2 text-xs text-brand-700">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {label} queued — waiting for the worker to pick it up.
      </p>
    );
  }
  if (run.status === 'running') {
    const found = run.attempts_seen || 0;
    const toImport = Math.max(0, found - (run.attempts_skipped || 0));
    const done = (run.attempts_imported || 0) + (run.attempts_failed || 0);
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-brand-700">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span className="font-medium">{label} running</span>
        <span className="text-gray-500">
          started {formatIST(run.started_at, 'h:mm a')}
          {found > 0
            ? ` · ${done} of ${toImport} new attempt${toImport === 1 ? '' : 's'} imported${run.attempts_skipped ? `, ${run.attempts_skipped} already imported` : ''}`
            : ' · logging in and listing attempts…'}
          {run.attempts_failed ? ` · ${run.attempts_failed} failed` : ''}
        </span>
      </p>
    );
  }
  return (
    <p className={cn('flex items-center gap-2 text-xs', run.status === 'failed' ? 'text-rose-700' : 'text-gray-500')}>
      {run.status === 'failed' ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
      {label} {run.status === 'failed' ? 'failed' : 'finished'} {formatIST(run.finished_at || run.started_at, 'dd MMM, h:mm a')}
      {run.status !== 'failed' && ` · ${run.attempts_imported} new, ${run.attempts_skipped} already imported`}
      {run.status === 'failed' && run.error && ` — ${run.error.slice(0, 120)}`}
      {lastSuccessAt && run.status === 'failed' && ` · last good nightly sync ${formatIST(lastSuccessAt, 'dd MMM, h:mm a')}`}
    </p>
  );
}

function ScrapeModal({ onClose, onQueued }) {
  const today = istDateKey(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const days = from && to ? Math.round((new Date(to) - new Date(from)) / 86400000) + 1 : 0;
  const error =
    !from || !to ? 'Pick both dates'
      : from > to ? 'From date must be on or before To date'
        : to > today ? "To date can't be in the future"
          : days > MAX_RANGE_DAYS ? `Pick at most ${MAX_RANGE_DAYS} days per run` : null;

  const mutation = useMutation({
    mutationFn: () => autoproctorApi.sync(from, to),
    onSuccess: () => {
      toast.success('Scrape started — results appear here as each attempt is imported');
      onQueued();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not start the scrape'),
  });

  return (
    <Modal
      onClose={onClose}
      icon={DownloadCloud}
      title="Scrape AutoProctor results"
      description="Import every attempt started in this date range (IST)."
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            type="button"
            disabled={!!error || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Start scrape
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-gray-700 mb-1.5">From</span>
          <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-gray-700 mb-1.5">To</span>
          <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </label>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-rose-600">{error}</p>
      ) : (
        <p className="mt-2 text-xs text-gray-500">{days} day{days === 1 ? '' : 's'} selected.</p>
      )}
      <ul className="mt-4 space-y-1.5 text-xs text-gray-500 list-disc pl-4">
        <li>Attempts already imported are skipped, so overlapping ranges are safe to run.</li>
        <li>Each new attempt takes about 1–2 minutes (report page, two PDFs). It runs in the background.</li>
        <li>A manual scrape only imports results. Reminders and auto-drops run with the nightly sync.</li>
      </ul>
    </Modal>
  );
}

function LinkModal({ attempt, onClose, onLinked }) {
  const [q, setQ] = useState(attempt.candidate_name || '');
  const dq = useDebounced(q, 300);
  const { data: options = [], isFetching } = useQuery({
    queryKey: ['autoproctor-linkable', dq],
    queryFn: () => autoproctorApi.linkable(dq).then((r) => r.data),
    enabled: dq.trim().length >= 2,
  });
  const mutation = useMutation({
    mutationFn: (assessmentId) => autoproctorApi.link(attempt.id, assessmentId),
    onSuccess: () => { toast.success('Attempt linked — assessment marked completed'); onLinked(); onClose(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not link'),
  });

  return (
    <Modal
      onClose={onClose}
      icon={Link2}
      size="lg"
      title="Link attempt to an assessment"
      description={`${attempt.candidate_name || 'Candidate'} sat "${attempt.test_title}" as ${attempt.candidate_email}`}
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search candidate by name or email" className={cn(inputCls, 'pl-9')} />
      </div>
      <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-surface-100">
        {isFetching && <p className="py-6 text-center text-sm text-gray-400">Searching…</p>}
        {!isFetching && dq.trim().length >= 2 && options.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">No AutoProctor assessments for that candidate.</p>
        )}
        {options.map((o) => (
          <button
            key={o.assessment_id}
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(o.assessment_id)}
            className="w-full flex items-center justify-between gap-3 py-2.5 px-1 text-left hover:bg-surface-50 rounded-lg"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900 truncate">{o.candidate_name}</span>
              <span className="block text-xs text-gray-500 truncate">{o.candidate_email} · {o.job_title} · {o.title}</span>
            </span>
            <span className="shrink-0 text-[11px] text-gray-500 capitalize">{o.status} · {stageLabel(o.stage)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function ResultsTable({ rows, onOpen, onLink, onUnlink, showLink }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[960px]">
        <thead>
          <tr className="border-b border-surface-200 bg-surface-50">
            <th className={th}>Candidate</th>
            <th className={th}>Test</th>
            <th className={th}>Quiz score</th>
            <th className={th}>Trust</th>
            <th className={th}>Proctoring</th>
            <th className={th}>Submitted (IST)</th>
            <th className={th}>Application</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-surface-50 cursor-pointer" onClick={() => onOpen(a.id)}>
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{a.candidate_name || '—'}</p>
                <p className="text-xs text-gray-400">{a.candidate_email}</p>
              </td>
              <td className="px-4 py-3 text-gray-700">{a.test_title}</td>
              <td className="px-4 py-3"><ScoreBar pct={a.percentage_scored} points={a.points_scored} max={a.points_available} /></td>
              <td className="px-4 py-3"><TrustChip pct={a.trust_score_pct} /></td>
              <td className="px-4 py-3"><ViolationBadge total={a.violation_total} /></td>
              <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{formatIST(a.finished_at, 'dd MMM, h:mm a')}</td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                {a.application ? (
                  <button type="button" onClick={() => navigate(`/hr/applicants/${a.application.id}?tab=assessments`)} className="text-left">
                    <span className="block text-xs font-medium text-brand-600 hover:text-brand-700">{a.application.job_title}</span>
                    <span className="block text-[11px] text-gray-500">{stageLabel(a.application.stage)}</span>
                  </button>
                ) : showLink ? (
                  <button type="button" onClick={() => onLink(a)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                    <Link2 className="w-3.5 h-3.5" /> Link
                  </button>
                ) : (
                  <span className="text-xs text-amber-600">Not matched</span>
                )}
              </td>
              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                {a.application && a.match_method === 'manual' && (
                  <button type="button" title="Unlink" onClick={() => onUnlink(a)} className="text-gray-300 hover:text-rose-500">
                    <Unlink className="w-4 h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingTable({ rows }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr className="border-b border-surface-200 bg-surface-50">
            <th className={th}>Candidate</th>
            <th className={th}>Role · Assessment</th>
            <th className={th}>Scheduled (IST)</th>
            <th className={th}>Reminder</th>
            <th className={th}>Auto-drop on</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {rows.map((p) => (
            <tr key={p.assessment_id} className="hover:bg-surface-50 cursor-pointer" onClick={() => navigate(`/hr/applicants/${p.application_id}?tab=assessments`)}>
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{p.candidate_name}</p>
                <p className="text-xs text-gray-400">{p.candidate_email}</p>
              </td>
              <td className="px-4 py-3">
                <p className="text-gray-800">{p.job_title}</p>
                <p className="text-xs text-gray-500">{p.title}</p>
              </td>
              <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{formatIST(p.scheduled_at, 'dd MMM, h:mm a')}</td>
              <td className="px-4 py-3 text-xs">
                {p.reminder_sent_at ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700"><Mail className="w-3.5 h-3.5" /> Sent {formatIST(p.reminder_sent_at, 'dd MMM')}</span>
                ) : (
                  <span className="text-gray-500">Due {formatIST(p.reminder_due_at, 'dd MMM')}</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs whitespace-nowrap">
                <span className={cn('font-medium', p.days_left <= 2 ? 'text-rose-700' : 'text-gray-700')}>
                  {formatIST(p.drop_at, 'dd MMM')}
                </span>
                <span className="ml-1.5 text-gray-400">
                  {p.overdue ? '(next sync)' : p.days_left === 0 ? 'within 24h' : `in ${p.days_left} day${p.days_left === 1 ? '' : 's'}`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="border-b border-surface-200 bg-surface-50">
            <th className={th}>Started (IST)</th>
            <th className={th}>Type</th>
            <th className={th}>Status</th>
            <th className={cn(th, 'text-right')}>Found</th>
            <th className={cn(th, 'text-right')}>New</th>
            <th className={cn(th, 'text-right')}>Skipped</th>
            <th className={cn(th, 'text-right')}>Matched</th>
            <th className={cn(th, 'text-right')}>Failed</th>
            <th className={cn(th, 'text-right')}>Reminders</th>
            <th className={cn(th, 'text-right')}>Dropped</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">{formatIST(r.started_at, 'dd MMM, h:mm a')}</td>
              <td className="px-4 py-3 text-xs text-gray-700">
                {r.range_from ? `Manual · ${r.range_from}${r.range_to && r.range_to !== r.range_from ? ` → ${r.range_to}` : ''}` : 'Nightly'}
              </td>
              <td className="px-4 py-3 text-xs">
                <span className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium capitalize',
                  r.status === 'success' ? 'bg-emerald-50 text-emerald-700' : ACTIVE.includes(r.status) ? 'bg-brand-50 text-brand-700' : 'bg-rose-50 text-rose-700',
                )}>
                  {ACTIVE.includes(r.status) && <Loader2 className="w-3 h-3 animate-spin" />}{r.status}
                </span>
                {r.error && <p className="mt-1 text-[11px] text-rose-600 max-w-xs break-words">{r.error}</p>}
              </td>
              {['attempts_seen', 'attempts_imported', 'attempts_skipped', 'attempts_matched', 'attempts_failed', 'reminders_sent', 'candidates_dropped'].map((k) => (
                <td key={k} className={cn('px-4 py-3 text-right tabular-nums', k === 'attempts_failed' && r[k] ? 'text-rose-700 font-semibold' : 'text-gray-700')}>{r[k]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AssessmentsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState('results');
  const [search, setSearch] = useState('');
  const [testFilter, setTestFilter] = useState('');
  const [openId, setOpenId] = useState(null);
  const [linking, setLinking] = useState(null);
  const [showScrape, setShowScrape] = useState(false);
  const dSearch = useDebounced(search, 300);

  const { data: summary } = useQuery({
    queryKey: ['autoproctor-summary'],
    queryFn: () => autoproctorApi.summary().then((r) => r.data),
    // Poll while a run is queued or going, so the status line and the new
    // attempts update live and the button stays locked until it's done.
    refetchInterval: (q) => (ACTIVE.includes(q.state.data?.last_run?.status) ? 5000 : false),
  });
  const lastRun = summary?.last_run;
  const running = ACTIVE.includes(lastRun?.status);

  // Tell HR when the run they were watching finishes, and refresh the lists.
  const watched = useRef(null);
  useEffect(() => {
    if (!lastRun) return;
    if (ACTIVE.includes(lastRun.status)) { watched.current = lastRun.id; return; }
    if (watched.current === lastRun.id) {
      watched.current = null;
      if (lastRun.status === 'success') {
        toast.success(`${runLabel(lastRun)} finished — ${lastRun.attempts_imported} new attempt${lastRun.attempts_imported === 1 ? '' : 's'} imported`);
      } else {
        toast.error(`${runLabel(lastRun)} failed${lastRun.error ? `: ${lastRun.error.slice(0, 100)}` : ''}`);
      }
      refreshAll();
    }
  }, [lastRun?.id, lastRun?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const match = view === 'unmatched' ? 'unmatched' : 'all';
  const { data: attempts = [], isLoading: loadingAttempts } = useQuery({
    queryKey: ['autoproctor-attempts', match, dSearch],
    queryFn: () => autoproctorApi.attempts({ match, q: dSearch || undefined }).then((r) => r.data),
    enabled: view === 'results' || view === 'unmatched',
    refetchInterval: running ? 15000 : false,
  });
  const { data: pending = [], isLoading: loadingPending } = useQuery({
    queryKey: ['autoproctor-pending'],
    queryFn: () => autoproctorApi.pending().then((r) => r.data),
    enabled: view === 'pending',
  });
  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['autoproctor-runs'],
    queryFn: () => autoproctorApi.runs().then((r) => r.data),
    enabled: view === 'history',
    refetchInterval: running ? 5000 : false,
  });

  const tests = useMemo(() => [...new Set(attempts.map((a) => a.test_title))].sort(), [attempts]);
  const shownAttempts = testFilter ? attempts.filter((a) => a.test_title === testFilter) : attempts;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['autoproctor-summary'] });
    qc.invalidateQueries({ queryKey: ['autoproctor-attempts'] });
    qc.invalidateQueries({ queryKey: ['autoproctor-pending'] });
    qc.invalidateQueries({ queryKey: ['autoproctor-runs'] });
  };

  const unlink = useMutation({
    mutationFn: (a) => autoproctorApi.link(a.id, null),
    onSuccess: () => { toast.success('Unlinked — the assessment is pending again'); refreshAll(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not unlink'),
  });

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="AutoProctor results, synced every night at 12:00 AM IST."
        actions={
          <button
            type="button"
            onClick={() => setShowScrape(true)}
            disabled={running || summary?.enabled === false}
            title={summary?.enabled === false ? 'AutoProctor sync is turned off on the server' : running ? 'A sync is in progress — wait for it to finish' : undefined}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
            {lastRun?.status === 'queued' ? 'Queued…' : running ? 'Running…' : 'Scrape results'}
          </button>
        }
      />

      <div className={cn(
        'mb-4 rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2',
        running ? 'border-brand-200 bg-brand-50/50' : 'border-surface-200 bg-white',
      )}>
        {summary?.enabled === false ? (
          <p className="text-xs text-amber-700 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> AutoProctor sync is turned off on the server (AUTOPROCTOR_ENABLED).
          </p>
        ) : (
          <RunStatus run={lastRun} lastSuccessAt={summary?.last_success_at} />
        )}
        <p className="shrink-0 text-xs text-gray-500">
          Last synced:{' '}
          <span className="font-semibold text-gray-800">
            {summary?.last_synced_at ? formatIST(summary.last_synced_at, 'dd MMM yyyy, h:mm a') : 'Never'}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile
          icon={ClipboardCheck} tone="emerald" label="Completed (last 7 days)" value={summary?.completed_7d ?? '—'}
          hint={summary?.avg_score_7d != null ? `Avg score ${summary.avg_score_7d}% · trust ${summary.avg_trust_7d}%` : undefined}
          onClick={() => setView('results')} active={view === 'results'}
        />
        <StatTile icon={Hourglass} tone="amber" label="Awaiting completion" value={summary?.awaiting ?? '—'} onClick={() => setView('pending')} active={view === 'pending'} />
        <StatTile icon={AlarmClock} tone="rose" label="Auto-drop within 2 days" value={summary?.drop_within_2d ?? '—'} onClick={() => setView('pending')} />
        <StatTile
          icon={Link2} tone="violet" label="Unmatched attempts" value={summary?.unmatched ?? '—'}
          hint="Sat the test under another email" onClick={() => setView('unmatched')} active={view === 'unmatched'}
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
        <div className="-mx-1 px-1 overflow-x-auto">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'results', label: 'Results', icon: ListChecks },
            { value: 'pending', label: 'Awaiting', icon: Hourglass },
            { value: 'unmatched', label: 'Unmatched', icon: Link2 },
            { value: 'history', label: 'Sync history', icon: History },
          ]}
        />
        </div>
        {(view === 'results' || view === 'unmatched') && (
          <div className="flex flex-col sm:flex-row flex-1 gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search candidate, email or test" className={cn(inputCls, 'pl-9 py-2')} />
            </div>
            <select value={testFilter} onChange={(e) => setTestFilter(e.target.value)} className={cn(inputCls, 'py-2 sm:w-auto sm:max-w-[220px]')}>
              <option value="">All tests</option>
              {tests.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        {(view === 'results' || view === 'unmatched') && (
          loadingAttempts ? <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            : shownAttempts.length === 0 ? (
              <EmptyState
                icon={view === 'unmatched' ? CheckCircle2 : ClipboardCheck}
                title={view === 'unmatched' ? 'Every attempt is matched' : 'No results yet'}
                description={view === 'unmatched'
                  ? 'Attempts that don\'t match a candidate by email show up here for you to link.'
                  : 'Results arrive after the nightly sync. To pull them now, use Scrape results.'}
                action={view === 'results' && !running && summary?.enabled !== false && (
                  <button type="button" onClick={() => setShowScrape(true)} className="text-sm font-semibold text-brand-600 hover:text-brand-700">Scrape results</button>
                )}
              />
            ) : (
              <ResultsTable rows={shownAttempts} onOpen={setOpenId} onLink={setLinking} onUnlink={(a) => unlink.mutate(a)} showLink />
            )
        )}
        {view === 'pending' && (
          loadingPending ? <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            : pending.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Nobody is waiting" description="Candidates with an AutoProctor assessment they haven't submitted yet appear here, with their reminder and auto-drop dates." />
            ) : (
              <>
                <p className="px-4 py-2.5 text-xs text-gray-500 border-b border-surface-100 bg-surface-50/60">
                  A reminder goes out 3 days after scheduling. Unsubmitted candidates move to Interview Drop after 7 days, never before their deadline.
                </p>
                <PendingTable rows={pending} />
              </>
            )
        )}
        {view === 'history' && (
          loadingRuns ? <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            : runs.length === 0 ? (
              <EmptyState icon={History} title="No syncs yet" description="The nightly sync runs at 12:00 AM IST. You can also start a manual scrape." />
            ) : <RunsTable rows={runs} />
        )}
      </div>

      {openId && <AttemptDetailModal attemptId={openId} onClose={() => setOpenId(null)} />}
      {linking && <LinkModal attempt={linking} onClose={() => setLinking(null)} onLinked={refreshAll} />}
      {showScrape && <ScrapeModal onClose={() => setShowScrape(false)} onQueued={() => { refreshAll(); setView('history'); }} />}
    </div>
  );
}
