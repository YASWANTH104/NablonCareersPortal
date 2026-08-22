import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Building2, Plus, Search, X, Power, Loader2, AlertCircle, Award,
  Send, ArrowUpDown, ArrowRight, Crown, Copy, Check, Briefcase, Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { agenciesApi } from '@/api/agencies';
import { reportsApi } from '@/api/reports';
import { useDebounced } from '@/hooks/useDebounced';
import { agencyAccent, agencyInitials } from '@/constants/agencyAccents';
import PipelineFunnel from '@/components/shared/PipelineFunnel';
import { Modal, EmptyState, Segmented } from '@/components/ui';
import { cn } from '@/lib/utils';

const inputCls =
  'w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-400';

const agencySchema = z.object({
  name: z.string().trim().min(2, 'Give the agency a name'),
  contact_name: z.string().optional(),
  contact_email: z.string().trim().email('A valid contact email is required'),
});

function Field({ label, required, error, hint, children }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-xs font-semibold text-gray-700">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </span>
        {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
      </span>
      {children}
      {error && (
        <span className="flex items-center gap-1 text-[11px] text-rose-600 mt-1">
          <AlertCircle className="w-3 h-3 shrink-0" /> {error}
        </span>
      )}
    </label>
  );
}

function KpiTile({ icon: Icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-3.5 bg-white rounded-2xl border border-surface-200 p-4 transition-shadow hover:shadow-card">
      <span className={cn('w-11 h-11 shrink-0 rounded-xl flex items-center justify-center', accent)}>
        <Icon className="w-5 h-5" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-2xl font-bold text-gray-900 leading-none tabular-nums">{value}</p>
        <p className="text-[11px] text-gray-500 mt-1.5 truncate">{label}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <p className={cn('font-display text-xl font-bold leading-none tabular-nums', tone ?? 'text-gray-900')}>{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mt-1.5 truncate">{label}</p>
    </div>
  );
}

// Copy sits on the card so the portal link — the whole reason this page exists —
// is one click from the list, without navigating anywhere.
function PortalCopyButton({ url }) {
  const [copied, setCopied] = useState(false);

  async function copy(e) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — open the partner and copy the link from there.');
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
        copied
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-surface-200 bg-white text-gray-500 hover:text-brand-600 hover:border-brand-300'
      )}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Link copied' : 'Portal link'}
    </button>
  );
}

function AgencyCard({ agency, perf, onOpen, index, isTopPartner }) {
  const accent = agencyAccent(agency.name, agency.is_active);
  const submitted = perf?.total_submitted ?? 0;
  const counts = {
    inProgress: perf?.in_progress ?? 0,
    hired: perf?.hired ?? 0,
    rejected: perf?.rejected ?? 0,
  };
  const portalUrl = `${window.location.origin}/agency/${agency.portal_token}`;

  return (
    <article
      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
      className={cn(
        'group relative flex flex-col bg-white rounded-2xl border overflow-hidden transition-all duration-200',
        'animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both',
        agency.is_active
          ? 'border-surface-200 hover:border-brand-200 hover:shadow-card-hover hover:-translate-y-0.5'
          : 'border-surface-200 bg-surface-50/50'
      )}
    >
      {/* Accent rail — grows on hover, gives each partner its own identity */}
      <span
        className={cn(
          'absolute inset-x-0 top-0 h-1 bg-gradient-to-r transition-all duration-300 group-hover:h-1.5',
          accent.bar
        )}
      />

      <button onClick={onOpen} className="flex-1 text-left p-5 pt-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset">
        <div className="flex items-start gap-3.5">
          <span
            className={cn(
              'w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center font-display text-sm font-bold',
              accent.tile
            )}
          >
            {agencyInitials(agency.name)}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <h3
                className={cn(
                  'font-display font-bold leading-snug break-words transition-colors',
                  agency.is_active ? 'text-gray-900 group-hover:text-brand-700' : 'text-gray-500'
                )}
              >
                {agency.name}
              </h3>
              {isTopPartner && (
                <span
                  title="Most hires in the last 12 months"
                  className="shrink-0 inline-flex items-center gap-0.5 mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200"
                >
                  <Crown className="w-2.5 h-2.5" /> Top
                </span>
              )}
              {!agency.is_active && (
                <span className="shrink-0 mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-surface-100 text-gray-500 border border-surface-200">
                  Off
                </span>
              )}
            </div>
            {agency.contact_name && (
              <p className="text-xs text-gray-500 mt-1 truncate">{agency.contact_name}</p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5 min-w-0">
              <Mail className="w-3 h-3 shrink-0" />
              <span className="truncate">{agency.contact_email}</span>
            </p>
          </div>
        </div>

        {/* Headline numbers */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          <Metric label="Submitted" value={submitted} />
          <Metric label="Hired" value={counts.hired} tone={counts.hired > 0 ? 'text-emerald-600' : undefined} />
          <Metric
            label="Conversion"
            value={submitted > 0 ? `${perf.conversion_rate}%` : '—'}
            tone={submitted > 0 && perf.conversion_rate > 0 ? 'text-brand-600' : 'text-gray-300'}
          />
        </div>

        {/* Outcomes */}
        <div className="mt-4 pt-4 border-t border-surface-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Outcomes · 12 mo</p>
          <PipelineFunnel counts={counts} total={submitted} size="sm" />
        </div>
      </button>

      {/* Footer actions — siblings of the body button, never nested inside it */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-surface-100 bg-surface-50/60">
        <PortalCopyButton url={portalUrl} />
        <button
          onClick={onOpen}
          className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 group-hover:gap-1.5 transition-all"
        >
          Open partner <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </article>
  );
}

function CreateAgencyModal({ onClose }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(agencySchema) });

  const mut = useMutation({
    mutationFn: (data) => agenciesApi.create(data),
    onSuccess: (res) => {
      toast.success('Agency added — assign a job and share their portal link');
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
      onClose();
      // Straight into the new partner: assigning a job and copying the portal
      // link is always the next thing, and both live there.
      if (res.data?.id) navigate(`/hr/agencies/${res.data.id}`);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not add this agency'),
  });

  return (
    <Modal
      onClose={onClose}
      title="Add a recruiting agency"
      description="They get a private portal link — no login required."
      icon={Building2}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            form="agency-form"
            disabled={mut.isPending}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {mut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {mut.isPending ? 'Adding…' : 'Add agency'}
          </button>
        </div>
      }
    >
      <form
        id="agency-form"
        onSubmit={handleSubmit((v) =>
          mut.mutate({
            name: v.name.trim(),
            contact_name: v.contact_name?.trim() || null,
            contact_email: v.contact_email.trim(),
          })
        )}
        className="space-y-4"
      >
        <Field label="Agency name" required error={errors.name?.message}>
          <input {...register('name')} className={inputCls} placeholder="Apex Talent Partners" autoFocus />
        </Field>
        <Field label="Contact name" hint="Optional" error={errors.contact_name?.message}>
          <input {...register('contact_name')} className={inputCls} placeholder="Priya Nair" />
        </Field>
        <Field label="Contact email" required error={errors.contact_email?.message}>
          <input {...register('contact_email')} type="email" className={inputCls} placeholder="priya@apextalent.com" />
        </Field>
      </form>
    </Modal>
  );
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All' },
  { value: 'inactive', label: 'Off' },
];

export default function AgenciesPage() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 200);
  const [status, setStatus] = useState('active');
  const [sort, setSort] = useState('submissions');

  const { data: agencies, isLoading, isError } = useQuery({
    queryKey: ['agencies'],
    queryFn: () => agenciesApi.list().then((r) => r.data),
  });

  const { data: performance } = useQuery({
    queryKey: ['agency-performance-dashboard'],
    queryFn: () => reportsApi.agencyPerformance({ days: 365 }).then((r) => r.data),
  });

  const perfByAgency = useMemo(() => {
    const map = {};
    (performance ?? []).forEach((p) => { map[p.agency_id] = p; });
    return map;
  }, [performance]);

  // Only a badge worth showing when there's a real contest — with one partner
  // hiring, "top" says nothing.
  const topPartnerId = useMemo(() => {
    const withHires = (performance ?? []).filter((p) => p.hired > 0);
    if (withHires.length < 2) return null;
    return withHires.reduce((best, p) => (p.hired > best.hired ? p : best)).agency_id;
  }, [performance]);

  const visible = useMemo(() => {
    let list = agencies ?? [];
    if (status === 'active') list = list.filter((a) => a.is_active);
    else if (status === 'inactive') list = list.filter((a) => !a.is_active);

    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (a) =>
          a.name?.toLowerCase().includes(needle) ||
          a.contact_name?.toLowerCase().includes(needle) ||
          a.contact_email?.toLowerCase().includes(needle)
      );
    }

    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      const key = sort === 'hires' ? 'hired' : 'total_submitted';
      const diff = (perfByAgency[b.id]?.[key] ?? 0) - (perfByAgency[a.id]?.[key] ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [agencies, status, search, sort, perfByAgency]);

  // KPIs describe the whole roster, never the filtered view.
  const kpis = useMemo(() => ({
    total: agencies?.length ?? 0,
    active: agencies?.filter((a) => a.is_active).length ?? 0,
    submitted: (performance ?? []).reduce((s, p) => s + p.total_submitted, 0),
    hired: (performance ?? []).reduce((s, p) => s + p.hired, 0),
  }), [agencies, performance]);

  const filtersActive = Boolean(search) || status !== 'active';

  return (
    <div className="max-w-[1200px] space-y-5">
      {/* ── Header ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white">
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-28 left-1/3 w-72 h-72 rounded-full bg-brand-300/20 blur-3xl pointer-events-none" />

        <div className="relative p-5 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="max-w-xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Sourcing partners</p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold mt-2 leading-tight">Recruiting Agencies</h1>
              <p className="text-sm text-white/75 mt-2 leading-relaxed">
                Give a partner a private portal, cap what they can send, and see exactly what each one turns into.
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="shrink-0 self-start sm:self-end inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand-700 bg-white rounded-xl hover:bg-white/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add agency
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-[76px] bg-white border border-surface-200 rounded-2xl animate-pulse" />)}
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-72 bg-white border border-surface-200 rounded-2xl animate-pulse" />)}
          </div>
        </>
      ) : isError ? (
        <div className="bg-white rounded-2xl border border-surface-200">
          <EmptyState
            icon={AlertCircle}
            title="Couldn’t load agencies"
            description="The request failed. Refresh the page, or check with an admin if it keeps happening."
          />
        </div>
      ) : (agencies?.length ?? 0) === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-200">
          <EmptyState
            icon={Building2}
            title="No agencies yet"
            description="Add a recruiting partner and they get a private portal to submit candidates and book interview slots — with everything they send attributed back to them."
            action={
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add your first agency
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile icon={Building2} label="Partners" value={kpis.total} accent="bg-brand-50 text-brand-600" />
            <KpiTile icon={Power} label="Active" value={kpis.active} accent="bg-emerald-50 text-emerald-600" />
            <KpiTile icon={Send} label="Submitted · 12 mo" value={kpis.submitted} accent="bg-violet-50 text-violet-600" />
            <KpiTile icon={Award} label="Hired · 12 mo" value={kpis.hired} accent="bg-amber-50 text-amber-600" />
          </div>

          {/* ── Toolbar ── */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search agency, contact or email…"
                className="w-full pl-10 pr-9 py-3 bg-white border border-surface-200 rounded-2xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-300"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-gray-400 hover:bg-surface-100 flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Segmented value={status} onChange={setStatus} options={STATUS_OPTIONS} size="md" className="bg-white border border-surface-200 shadow-sm" />
              <label className="inline-flex items-center gap-1.5 shrink-0">
                <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  aria-label="Sort agencies"
                  className="text-sm bg-white border border-surface-200 rounded-2xl px-3 py-3 text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="submissions">Most submitted</option>
                  <option value="hires">Most hires</option>
                  <option value="name">Name (A–Z)</option>
                </select>
              </label>
            </div>
          </div>

          {/* ── Cards ── */}
          {visible.length === 0 ? (
            <div className="bg-white rounded-2xl border border-surface-200">
              <EmptyState
                icon={Search}
                title="No agencies match"
                description="Try a different search, or widen the status filter."
                action={
                  filtersActive ? (
                    <button
                      onClick={() => { setSearchInput(''); setStatus('all'); }}
                      className="px-4 py-2 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors"
                    >
                      Clear filters
                    </button>
                  ) : null
                }
              />
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {visible.map((agency, i) => (
                  <AgencyCard
                    key={agency.id}
                    index={i}
                    agency={agency}
                    perf={perfByAgency[agency.id]}
                    isTopPartner={topPartnerId != null && String(topPartnerId) === String(agency.id)}
                    onOpen={() => navigate(`/hr/agencies/${agency.id}`)}
                  />
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-gray-400 px-1">
                <Briefcase className="w-3 h-3" />
                Showing {visible.length} of {agencies.length} partner{agencies.length === 1 ? '' : 's'}
                {status === 'active' && ' · deactivated ones hidden'}
              </p>
            </>
          )}
        </>
      )}

      {showCreate && <CreateAgencyModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
