import { useMemo, useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  BellOff, BellRing, RefreshCw, Search, User, Users, CircleDashed, ChevronRight, CheckCircle2,
  Hourglass, Moon, CalendarClock, MessageSquareText, ClipboardCheck, FileSignature, Inbox,
  PauseCircle, Copy, X,
} from 'lucide-react';
import { actionCenterApi } from '@/api/actionCenter';
import { Segmented, EmptyState, Modal } from '@/components/ui';
import { STAGE_MAP } from '@/constants/pipelineStages';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';

// ── Constants ────────────────────────────────────────────────────────────────

const QUERY_KEY = 'action-center';

const SCOPES = [
  { value: 'mine', label: 'My queue', icon: User },
  { value: 'team', label: 'Team', icon: Users },
  { value: 'unclaimed', label: 'Unclaimed', icon: CircleDashed },
];

const TABS = [
  { key: 'todo', label: 'To do' },
  { key: 'waiting', label: 'Waiting on others' },
  { key: 'snoozed', label: 'Snoozed' },
];

const SNOOZE_OPTIONS = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
];

// Status colours have one fixed meaning on this page and always appear with a
// text label or count beside them — never colour alone.
const STATUS = {
  overdue: { label: 'Overdue', fill: 'bg-rose-500', pill: 'bg-rose-50 text-rose-700' },
  due:     { label: 'Due',     fill: 'bg-amber-400', pill: 'bg-amber-50 text-amber-800' },
  waiting: { label: 'Waiting', fill: 'bg-slate-300', pill: 'bg-slate-100 text-slate-600' },
  snoozed: { label: 'Snoozed', fill: 'bg-violet-400', pill: 'bg-violet-50 text-violet-700' },
};

// What kind of work an action is. The icon makes a long list scannable by type.
const CATEGORY_ICON = {
  triage: Inbox,
  interviews: CalendarClock,
  feedback: MessageSquareText,
  assessment: ClipboardCheck,
  offer: FileSignature,
  hold: PauseCircle,
  hygiene: Copy,
};

// Pipeline position for the mini progress track. Agency/campus candidates sit
// the assessment before the screening call (constants/pipelineStages.js), so
// the order is per source — otherwise their track would jump backwards.
const PIPELINE = ['applied', 'screening', 'assessment', 'tr1', 'tr2', 'final_tr', 'hr', 'offer'];
const PIPELINE_PRESCREENED = ['applied', 'assessment', 'screening', 'tr1', 'tr2', 'final_tr', 'hr', 'offer'];

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const IST = { timeZone: 'Asia/Kolkata' };
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...IST });
const fmtWeekday = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', ...IST });

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase() || '?';
}

function greeting(firstName) {
  const h = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, ...IST }));
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return firstName ? `${part}, ${firstName}` : part;
}

function relativeTime(ts, now) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 30) return 'just now';
  if (s < 90) return '1 min ago';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', ...IST });
}

function timing(item) {
  if (item.snoozed) return { text: `Back ${fmtDay(item.snoozed.until)}`, tone: 'snoozed' };
  if (item.severity === 'overdue') {
    return { text: `${Math.max(1, Math.round(item.overdue_by_days))}d overdue`, tone: 'overdue' };
  }
  if (item.severity === 'due') {
    const left = Math.floor((new Date(item.due_at) - Date.now()) / DAY_MS);
    return { text: left < 1 ? 'Due today' : `Due in ${left}d`, tone: 'due' };
  }
  const d = Math.round(item.age_days);
  return { text: d < 1 ? 'Since today' : `${d}d waiting`, tone: 'waiting' };
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Writes a change into every cached scope of the Action Center at once, so an
// optimistic snooze shows up whichever scope tab is open.
function patchCachedItems(qc, fn) {
  qc.setQueriesData({ queryKey: [QUERY_KEY] }, (old) => (old ? { ...old, items: old.items.map(fn) } : old));
}

// ── Small presentational pieces ─────────────────────────────────────────────

function Avatar({ name, size = 'md', dashed = false }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full flex items-center justify-center font-semibold select-none',
        size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-9 h-9 text-xs',
        dashed ? 'border border-dashed border-gray-300 text-gray-400 bg-white' : 'bg-brand-50 text-brand-700 ring-1 ring-brand-100',
      )}
      aria-hidden="true"
    >
      {dashed ? '?' : initials(name)}
    </span>
  );
}

function PipelineTrack({ stage, source }) {
  const order = source === 'agency' || source === 'campus' ? PIPELINE_PRESCREENED : PIPELINE;
  const at = order.indexOf(stage);
  const meta = STAGE_MAP[stage];
  return (
    <div className="flex items-center gap-2 min-w-0" title={`Stage ${at + 1} of ${order.length}: ${meta?.label ?? stage}`}>
      <div className="flex gap-0.5" aria-hidden="true">
        {order.map((s, i) => (
          <span
            key={s}
            className={cn(
              'h-1.5 w-2.5 rounded-full',
              i < at ? 'bg-brand-300' : i === at ? 'bg-brand-600' : 'bg-surface-200',
            )}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium text-gray-600 truncate">{meta?.label ?? stage}</span>
    </div>
  );
}

function StatusBar({ counts }) {
  const order = ['overdue', 'due', 'waiting', 'snoozed'];
  const total = order.reduce((s, k) => s + counts[k], 0);
  return (
    <div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-100 gap-[2px]"
        role="img"
        aria-label={order.map((k) => `${counts[k]} ${STATUS[k].label.toLowerCase()}`).join(', ')}
      >
        {total > 0 && order.map((k) => counts[k] > 0 && (
          <span key={k} className={cn('h-full first:rounded-l-full last:rounded-r-full', STATUS[k].fill)}
            style={{ width: `${(counts[k] / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
        {order.map((k) => (
          <li key={k} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className={cn('w-2 h-2 rounded-full', STATUS[k].fill)} aria-hidden="true" />
            <span className="font-semibold text-gray-900 tabular-nums">{counts[k]}</span> {STATUS[k].label.toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Snooze dialog ────────────────────────────────────────────────────────────

function SnoozeDialog({ item, onClose, onConfirm }) {
  const [days, setDays] = useState(1);
  const [note, setNote] = useState('');
  const until = (d) => Date.now() + d * DAY_MS;

  return (
    <Modal
      onClose={onClose}
      title="Snooze this action"
      description={`${item.candidate_name} · ${item.title}`}
      icon={BellOff}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-surface-200 rounded-lg hover:bg-surface-50">
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(days, note.trim())}
            className="px-4 py-2 text-sm font-semibold text-white bg-brand-500 rounded-lg hover:bg-brand-600 shadow-sm">
            Snooze until {fmtWeekday(until(days))}
          </button>
        </div>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => { e.preventDefault(); onConfirm(days, note.trim()); }}
      >
        <fieldset>
          <legend className="text-sm font-medium text-gray-700 mb-2">Bring it back</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup">
            {SNOOZE_OPTIONS.map((o) => {
              const active = days === o.days;
              return (
                <button
                  key={o.days}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setDays(o.days)}
                  className={cn(
                    'rounded-xl border px-3 py-3 text-left transition-all',
                    active ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-surface-200 hover:border-surface-300 hover:bg-surface-50',
                  )}
                >
                  <p className={cn('text-sm font-semibold', active ? 'text-brand-700' : 'text-gray-800')}>{o.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{fmtWeekday(until(o.days))}</p>
                </button>
              );
            })}
          </div>
        </fieldset>
        <div>
          <label htmlFor="snooze-note" className="text-sm font-medium text-gray-700">
            Reason <span className="font-normal text-gray-400">· optional, shown to the team</span>
          </label>
          <textarea
            id="snooze-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onConfirm(days, note.trim()); }}
            maxLength={500}
            rows={2}
            placeholder="e.g. Candidate travelling, call back Monday"
            className="mt-1.5 w-full text-sm border border-surface-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <BellRing className="w-3.5 h-3.5" /> It comes back early if the candidate moves to another stage.
        </p>
      </form>
    </Modal>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function ActionRow({ item, scope, onSnooze, onWake }) {
  const t = timing(item);
  const Icon = CATEGORY_ICON[item.category] ?? Inbox;
  const href = `/hr/applicants/${item.application_id}?tab=${item.tab}`;
  const sub = item.snoozed
    ? [item.snoozed.by_name && `Snoozed by ${item.snoozed.by_name}`, item.snoozed.note && `“${item.snoozed.note}”`]
      .filter(Boolean).join(' · ')
    : item.detail;

  return (
    <li className="group relative grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.15fr)_9.5rem_7.5rem_auto] items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3.5 hover:bg-surface-50/80 transition-colors">
      <Avatar name={item.candidate_name} />

      {/* Who + where in the pipeline */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to={href}
            className="font-semibold text-sm text-gray-900 truncate group-hover:text-brand-700 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-500 focus-visible:after:rounded-lg"
          >
            {item.candidate_name}
          </Link>
          {scope === 'mine' && item.unclaimed && (
            <span className="shrink-0 px-1.5 rounded border border-dashed border-gray-300 text-[10px] leading-4 text-gray-500"
              title="Nobody owns this candidate yet. It's in your queue because you posted the job.">
              Unclaimed
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate mb-1">{item.job_title}</p>
        <PipelineTrack stage={item.stage} source={item.source} />
      </div>

      {/* What to do — on mobile this wraps under the name */}
      <div className="col-span-3 col-start-1 row-start-2 md:col-span-1 md:col-start-auto md:row-start-auto min-w-0 flex items-start gap-3 pl-[3.25rem] md:pl-0">
        <span className="hidden md:flex mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-surface-100 text-gray-500 items-center justify-center" aria-hidden="true">
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
          {sub && <p className="text-xs text-gray-500 truncate mt-0.5">{sub}</p>}
        </div>
      </div>

      {/* Who's on it */}
      <div className="hidden md:flex items-center gap-2 min-w-0">
        {scope === 'unclaimed' ? (
          <span className="text-xs text-gray-500 truncate">{item.job_poster_name ? `Job by ${item.job_poster_name}` : '—'}</span>
        ) : scope === 'team' ? (
          <>
            <Avatar name={item.handler_name} size="sm" dashed={item.unclaimed} />
            <span className={cn('text-xs truncate', item.unclaimed ? 'italic text-gray-400 pr-1' : 'text-gray-700')}>
              {item.unclaimed ? 'Unclaimed' : item.handler_name}
            </span>
          </>
        ) : null}
      </div>

      {/* When */}
      <span className={cn(
        'row-start-1 col-start-3 md:row-start-auto md:col-start-auto justify-self-end md:justify-self-start',
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap tabular-nums',
        STATUS[t.tone].pill,
      )}>
        {t.text}
      </span>

      {/* Row actions */}
      <div className="hidden md:flex relative z-10 items-center justify-end gap-1 w-[4.5rem]">
        {item.snoozed ? (
          <button type="button" onClick={() => onWake(item)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-violet-700 rounded-md hover:bg-violet-50">
            <BellRing className="w-3.5 h-3.5" /> Wake
          </button>
        ) : item.severity !== 'waiting' && (
          <button type="button" onClick={() => onSnooze(item)} title="Snooze"
            aria-label={`Snooze “${item.title}” for ${item.candidate_name}`}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-white hover:shadow-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">
            <BellOff className="w-4 h-4" />
          </button>
        )}
        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
      </div>

      {/* Mobile row actions — hover doesn't exist on touch, so always visible */}
      <div className="md:hidden relative z-10 col-span-3 row-start-3 flex justify-end -mt-1">
        {item.snoozed ? (
          <button type="button" onClick={() => onWake(item)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-violet-700 border border-violet-200 rounded-md">
            <BellRing className="w-3.5 h-3.5" /> Wake
          </button>
        ) : item.severity !== 'waiting' && (
          <button type="button" onClick={() => onSnooze(item)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 border border-surface-200 rounded-md">
            <BellOff className="w-3.5 h-3.5" /> Snooze
          </button>
        )}
      </div>
    </li>
  );
}

function Group({ tone, title, hint, items, rowProps }) {
  return (
    <section className="bg-white border border-surface-200 rounded-2xl shadow-card overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-surface-100">
        <span className={cn('w-2 h-2 rounded-full', STATUS[tone].fill)} aria-hidden="true" />
        <h2 className="font-display text-sm font-semibold text-gray-900">{title}</h2>
        <span className={cn('px-1.5 rounded-md text-[11px] font-semibold leading-5 tabular-nums', STATUS[tone].pill)}>{items.length}</span>
        {hint && <span className="ml-auto text-xs text-gray-400 truncate">{hint}</span>}
      </header>
      <ul className="divide-y divide-surface-100">
        {items.map((i) => <ActionRow key={i.key} item={i} {...rowProps} />)}
      </ul>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ActionCenterPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const now = useNow();
  const searchRef = useRef(null);

  const [scope, setScope] = useState('mine');
  const [tab, setTab] = useState('todo');
  const [category, setCategory] = useState('');
  const [personId, setPersonId] = useState(null);
  const [search, setSearch] = useState('');
  const [snoozing, setSnoozing] = useState(null);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: [QUERY_KEY, scope],
    queryFn: () => actionCenterApi.list({ scope, include_snoozed: true }).then((r) => r.data),
    placeholderData: keepPreviousData,
    // Always revalidate on arrival: this page is where people come back to
    // after acting on a candidate, so a cached list is exactly the wrong thing.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  useEffect(() => { setPersonId(null); }, [scope]);

  // "/" focuses search, the convention from GitHub / Linear / Gmail.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const refreshPipeline = () => {
    qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    qc.invalidateQueries({ queryKey: ['action-center-count'] });
  };

  // Snooze and wake are optimistic: the row moves tabs the instant you click,
  // and rolls back if the server refuses. They opt out of the global
  // post-mutation refresh because they reconcile the cache themselves.
  const optimistic = (apply) => ({
    meta: { skipPipelineRefresh: true },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: [QUERY_KEY] });
      const snapshot = qc.getQueriesData({ queryKey: [QUERY_KEY] });
      patchCachedItems(qc, (i) => apply(i, vars));
      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, value]) => qc.setQueryData(key, value));
      toast.error(e.response?.data?.detail ?? 'That didn’t save. Please try again.');
    },
    onSettled: refreshPipeline,
  });

  const wakeMut = useMutation({
    mutationFn: (item) => actionCenterApi.unsnooze(item.application_id, item.type),
    ...optimistic((i, item) => (i.key === item.key ? { ...i, snoozed: null } : i)),
  });

  const snoozeMut = useMutation({
    mutationFn: ({ item, days, note }) => actionCenterApi.snooze({
      application_id: item.application_id, action_type: item.type, days, note: note || null,
    }),
    ...optimistic((i, { item, days, note }) => (
      i.key === item.key
        ? { ...i, snoozed: { until: new Date(Date.now() + days * DAY_MS).toISOString(), note: note || null, by_name: user?.full_name } }
        : i
    )),
  });

  const confirmSnooze = (days, note) => {
    const item = snoozing;
    setSnoozing(null);
    snoozeMut.mutate({ item, days, note });
    toast((tt) => (
      <span className="flex items-center gap-3 text-sm">
        <span>Snoozed <strong>{item.candidate_name}</strong> until {fmtWeekday(Date.now() + days * DAY_MS)}</span>
        <button type="button" className="font-semibold text-brand-600 hover:underline"
          onClick={() => { toast.dismiss(tt.id); wakeMut.mutate(item); }}>
          Undo
        </button>
      </span>
    ), { duration: 6000 });
  };

  // Everything except the tab filter, so tab counts always match what you'd
  // see after switching tabs.
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => {
      if (category && i.category !== category) return false;
      if (personId === 'unclaimed' ? !i.unclaimed : personId && i.handler_id !== personId) return false;
      if (q && !`${i.candidate_name} ${i.job_title} ${i.title}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, category, personId, search]);

  const buckets = useMemo(() => ({
    overdue: base.filter((i) => !i.snoozed && i.severity === 'overdue'),
    due: base.filter((i) => !i.snoozed && i.severity === 'due'),
    waiting: base.filter((i) => !i.snoozed && i.severity === 'waiting'),
    snoozed: base.filter((i) => i.snoozed),
  }), [base]);

  const counts = {
    overdue: buckets.overdue.length,
    due: buckets.due.length,
    waiting: buckets.waiting.length,
    snoozed: buckets.snoozed.length,
  };
  const tabCount = { todo: counts.overdue + counts.due, waiting: counts.waiting, snoozed: counts.snoozed };
  const categories = data?.summary?.by_category ?? [];
  const people = data?.summary?.by_handler ?? [];
  const filtered = Boolean(category || personId || search);
  const firstName = user?.full_name?.split(' ')[0];
  const oldest = (list) => (list.length ? Math.round(Math.max(...list.map((i) => i.age_days))) : 0);

  const headline = isLoading
    ? 'Loading your queue…'
    : tabCount.todo === 0
      ? 'Nothing needs you right now.'
      : `${tabCount.todo} ${tabCount.todo === 1 ? 'candidate needs' : 'candidates need'} action${counts.overdue ? `, ${counts.overdue} overdue` : ''}.`;

  const rowProps = { scope, onSnooze: setSnoozing, onWake: (item) => wakeMut.mutate(item) };

  const empty = {
    todo: filtered
      ? { icon: Search, title: 'No matches', description: 'Nothing in To do matches these filters.' }
      : { icon: CheckCircle2, title: "You're all caught up", description: scope === 'mine' ? 'Nothing in your queue needs action right now.' : 'Nothing needs action right now.' },
    waiting: { icon: Hourglass, title: 'Nothing waiting', description: 'No candidate is waiting on an interview, a reply or an approval.' },
    snoozed: { icon: Moon, title: 'Nothing snoozed', description: 'Snooze an item from To do to hide it until a set date.' },
  }[tab];

  return (
    <div className="max-w-6xl mx-auto">
      {/* ── Hero: who you are, what's on your plate, how it's split ── */}
      <section className="relative overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-card mb-6">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-white pointer-events-none" aria-hidden="true" />
        <div className="relative p-5 sm:p-6 grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">Action Center</p>
            <h1 className="font-display text-2xl font-bold text-gray-900 mt-1">{greeting(firstName)}</h1>
            <p className="text-sm text-gray-600 mt-1">{headline}</p>
          </div>
          <div>
            <StatusBar counts={counts} />
          </div>
        </div>
        <div className="relative flex items-center justify-between gap-3 px-5 sm:px-6 py-2.5 border-t border-surface-100 bg-white/70 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className={cn('w-1.5 h-1.5 rounded-full', isFetching ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500')} aria-hidden="true" />
            {isFetching ? 'Updating…' : `Live · updated ${relativeTime(dataUpdatedAt, now)}`}
          </span>
          <button type="button" onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 font-medium text-gray-600 hover:text-gray-900">
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} /> Refresh
          </button>
        </div>
      </section>

      {/* ── Scope + search ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <Segmented value={scope} onChange={setScope} options={SCOPES} />
        <div className="relative sm:ml-auto sm:w-80">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate or job"
            className="w-full pl-9 pr-9 py-2 text-sm border border-surface-200 rounded-lg bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {search ? (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="hidden sm:block absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 rounded border border-surface-200 text-[10px] text-gray-400 font-mono">/</kbd>
          )}
        </div>
      </div>

      {/* ── Team load: who is behind, at a glance; click to filter ── */}
      {scope === 'team' && people.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-medium text-gray-500 mb-2">Team load</p>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {people.map((p) => {
              const key = p.handler_id ?? 'unclaimed';
              const active = personId === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPersonId(active ? null : key)}
                  className={cn(
                    'flex items-center gap-2.5 pl-2 pr-3.5 py-2 rounded-xl border bg-white whitespace-nowrap transition-all',
                    active ? 'border-brand-400 ring-2 ring-brand-100 shadow-card' : 'border-surface-200 hover:border-surface-300 hover:shadow-card',
                  )}
                >
                  <Avatar name={p.name} size="sm" dashed={!p.handler_id} />
                  <span className="text-left">
                    <span className={cn('block text-sm font-medium leading-tight', p.handler_id ? 'text-gray-900' : 'italic text-gray-500 pr-1')}>
                      {p.handler_id ? p.name : 'Unclaimed'}
                    </span>
                    <span className="flex gap-2 text-[11px] leading-tight mt-0.5 tabular-nums">
                      {p.overdue > 0 && <span className="text-rose-600 font-semibold">{p.overdue} overdue</span>}
                      {p.due > 0 && <span className="text-amber-700 font-medium">{p.due} due</span>}
                      {p.overdue === 0 && p.due === 0 && <span className="text-emerald-600">On track</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tabs + type filter ── */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-surface-200 mb-5">
        <nav className="flex gap-6 -mb-px overflow-x-auto" role="tablist">
          {TABS.map((tb) => {
            const active = tab === tb.key;
            const urgent = tb.key === 'todo' && counts.overdue > 0;
            return (
              <button
                key={tb.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tb.key)}
                className={cn(
                  'flex items-center gap-2 pb-3 border-b-2 text-sm font-medium whitespace-nowrap transition-colors',
                  active ? 'border-brand-500 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800',
                )}
              >
                {tb.label}
                <span className={cn(
                  'min-w-[1.375rem] px-1.5 rounded-full text-[11px] font-semibold leading-5 text-center tabular-nums',
                  urgent ? 'bg-rose-500 text-white' : active ? 'bg-brand-50 text-brand-700' : 'bg-surface-100 text-gray-500',
                )}>
                  {tabCount[tb.key]}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 mb-2">
          {filtered && (
            <button type="button" onClick={() => { setCategory(''); setPersonId(null); setSearch(''); }}
              className="text-xs font-medium text-brand-600 hover:underline">
              Clear filters
            </button>
          )}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by action type"
            className="text-sm border border-surface-200 rounded-lg pl-3 pr-8 py-1.5 bg-white text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All action types</option>
            {categories.map((c) => <option key={c.category} value={c.category}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── List ── */}
      <div className={cn('transition-opacity', isFetching && !isLoading && 'opacity-80')}>
        {isLoading ? (
          <div className="bg-white border border-surface-200 rounded-2xl shadow-card divide-y divide-surface-100">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-surface-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-surface-100 rounded w-1/4" />
                  <div className="h-2.5 bg-surface-100 rounded w-1/3" />
                </div>
                <div className="h-5 w-20 bg-surface-100 rounded" />
              </div>
            ))}
          </div>
        ) : tabCount[tab] === 0 ? (
          <div className="bg-white border border-surface-200 rounded-2xl shadow-card">
            <EmptyState
              icon={empty.icon}
              title={empty.title}
              description={empty.description}
              action={tab === 'todo' && !filtered && scope === 'mine' ? (
                <button type="button" onClick={() => setScope('team')} className="text-sm font-medium text-brand-600 hover:underline">
                  See the team's queue
                </button>
              ) : null}
            />
          </div>
        ) : tab === 'todo' ? (
          <div className="space-y-5">
            {counts.overdue > 0 && (
              <Group tone="overdue" title="Overdue" hint={`Oldest ${oldest(buckets.overdue)} days`} items={buckets.overdue} rowProps={rowProps} />
            )}
            {counts.due > 0 && (
              <Group tone="due" title="Due" hint="Within the time limit" items={buckets.due} rowProps={rowProps} />
            )}
          </div>
        ) : (
          <Group
            tone={tab}
            title={tab === 'waiting' ? 'Waiting on others' : 'Snoozed'}
            hint={tab === 'waiting' ? 'Candidate, interview panel or director' : 'Hidden until their date'}
            items={buckets[tab]}
            rowProps={rowProps}
          />
        )}
      </div>

      {snoozing && <SnoozeDialog item={snoozing} onClose={() => setSnoozing(null)} onConfirm={confirmSnooze} />}
    </div>
  );
}
