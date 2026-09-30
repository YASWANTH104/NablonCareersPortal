import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  GraduationCap, Plus, Search, X, Power, Loader2, AlertCircle,
  ArrowUpDown, ArrowRight, Copy, Check, Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { campusesApi } from '@/api/campuses';
import { useDebounced } from '@/hooks/useDebounced';
import { agencyAccent, agencyInitials } from '@/constants/agencyAccents';
import { Modal, EmptyState, Segmented } from '@/components/ui';
import { cn } from '@/lib/utils';

const inputCls =
  'w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-400';

const campusSchema = z.object({
  name: z.string().trim().min(2, 'Give the campus a name'),
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
      toast.error('Could not copy — open the campus and copy the link from there.');
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

function CampusCard({ campus, onOpen, index }) {
  const accent = agencyAccent(campus.name, campus.is_active);
  const portalUrl = `${window.location.origin}/campus/${campus.portal_token}`;

  return (
    <article
      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
      className={cn(
        'group relative flex flex-col bg-white rounded-2xl border overflow-hidden transition-all duration-200',
        'animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both',
        campus.is_active
          ? 'border-surface-200 hover:border-brand-200 hover:shadow-card-hover hover:-translate-y-0.5'
          : 'border-surface-200 bg-surface-50/50'
      )}
    >
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
            {agencyInitials(campus.name)}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <h3
                className={cn(
                  'font-display font-bold leading-snug break-words transition-colors',
                  campus.is_active ? 'text-gray-900 group-hover:text-brand-700' : 'text-gray-500'
                )}
              >
                {campus.name}
              </h3>
              {!campus.is_active && (
                <span className="shrink-0 mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-surface-100 text-gray-500 border border-surface-200">
                  Off
                </span>
              )}
            </div>
            {campus.contact_name && (
              <p className="text-xs text-gray-500 mt-1 truncate">{campus.contact_name}</p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5 min-w-0">
              <Mail className="w-3 h-3 shrink-0" />
              <span className="truncate">{campus.contact_email}</span>
            </p>
          </div>
        </div>
      </button>

      <div className="flex items-center gap-2 px-5 py-3 border-t border-surface-100 bg-surface-50/60">
        <PortalCopyButton url={portalUrl} />
        <button
          onClick={onOpen}
          className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 group-hover:gap-1.5 transition-all"
        >
          Open campus <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </article>
  );
}

function CreateCampusModal({ onClose }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(campusSchema) });

  const mut = useMutation({
    mutationFn: (data) => campusesApi.create(data),
    onSuccess: (res) => {
      toast.success('Campus added — assign a job and share their portal link');
      queryClient.invalidateQueries({ queryKey: ['campuses'] });
      onClose();
      if (res.data?.id) navigate(`/hr/campuses/${res.data.id}`);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not add this campus'),
  });

  return (
    <Modal
      onClose={onClose}
      title="Add a campus"
      description="Their placement cell gets a private portal link — no login required."
      icon={GraduationCap}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            form="campus-form"
            disabled={mut.isPending}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {mut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {mut.isPending ? 'Adding…' : 'Add campus'}
          </button>
        </div>
      }
    >
      <form
        id="campus-form"
        onSubmit={handleSubmit((v) =>
          mut.mutate({
            name: v.name.trim(),
            contact_name: v.contact_name?.trim() || null,
            contact_email: v.contact_email.trim(),
          })
        )}
        className="space-y-4"
      >
        <Field label="Campus / university name" required error={errors.name?.message}>
          <input {...register('name')} className={inputCls} placeholder="IIT Bombay" autoFocus />
        </Field>
        <Field label="Placement cell contact" hint="Optional" error={errors.contact_name?.message}>
          <input {...register('contact_name')} className={inputCls} placeholder="Dr. Anjali Rao" />
        </Field>
        <Field label="Contact email" required error={errors.contact_email?.message}>
          <input {...register('contact_email')} type="email" className={inputCls} placeholder="placements@iitb.ac.in" />
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

export default function CampusesPage() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 200);
  const [status, setStatus] = useState('active');
  const [sort, setSort] = useState('name');

  const { data: campuses, isLoading, isError } = useQuery({
    queryKey: ['campuses'],
    queryFn: () => campusesApi.list().then((r) => r.data),
  });

  const visible = useMemo(() => {
    let list = campuses ?? [];
    if (status === 'active') list = list.filter((c) => c.is_active);
    else if (status === 'inactive') list = list.filter((c) => !c.is_active);

    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(needle) ||
          c.contact_name?.toLowerCase().includes(needle) ||
          c.contact_email?.toLowerCase().includes(needle)
      );
    }

    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [campuses, status, search, sort]);

  const kpis = useMemo(() => ({
    total: campuses?.length ?? 0,
    active: campuses?.filter((c) => c.is_active).length ?? 0,
  }), [campuses]);

  const filtersActive = Boolean(search) || status !== 'active';

  return (
    <div className="max-w-[1200px] space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white">
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-28 left-1/3 w-72 h-72 rounded-full bg-brand-300/20 blur-3xl pointer-events-none" />

        <div className="relative p-5 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="max-w-xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Sourcing partners</p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold mt-2 leading-tight">Campus Placements</h1>
              <p className="text-sm text-white/75 mt-2 leading-relaxed">
                Give a campus placement cell its own portal: they upload their student roster or share a
                self-apply link, then you bulk-schedule assessments for the whole drive in one action.
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="shrink-0 self-start sm:self-end inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand-700 bg-white rounded-xl hover:bg-white/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add campus
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2].map((i) => <div key={i} className="h-[76px] bg-white border border-surface-200 rounded-2xl animate-pulse" />)}
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-56 bg-white border border-surface-200 rounded-2xl animate-pulse" />)}
          </div>
        </>
      ) : isError ? (
        <div className="bg-white rounded-2xl border border-surface-200">
          <EmptyState
            icon={AlertCircle}
            title="Couldn’t load campuses"
            description="The request failed. Refresh the page, or check with an admin if it keeps happening."
          />
        </div>
      ) : (campuses?.length ?? 0) === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-200">
          <EmptyState
            icon={GraduationCap}
            title="No campuses yet"
            description="Add a college or university and its placement cell gets a private portal to upload their student roster, share a self-apply link, and bulk-schedule assessments for the whole drive."
            action={
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add your first campus
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile icon={GraduationCap} label="Campuses" value={kpis.total} accent="bg-brand-50 text-brand-600" />
            <KpiTile icon={Power} label="Active" value={kpis.active} accent="bg-emerald-50 text-emerald-600" />
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search campus, contact or email…"
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
                  aria-label="Sort campuses"
                  className="text-sm bg-white border border-surface-200 rounded-2xl px-3 py-3 text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="name">Name (A–Z)</option>
                  <option value="recent">Recently added</option>
                </select>
              </label>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="bg-white rounded-2xl border border-surface-200">
              <EmptyState
                icon={Search}
                title="No campuses match"
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
                {visible.map((campus, i) => (
                  <CampusCard
                    key={campus.id}
                    index={i}
                    campus={campus}
                    onOpen={() => navigate(`/hr/campuses/${campus.id}`)}
                  />
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-gray-400 px-1">
                <GraduationCap className="w-3 h-3" />
                Showing {visible.length} of {campuses.length} campus{campuses.length === 1 ? '' : 'es'}
                {status === 'active' && ' · deactivated ones hidden'}
              </p>
            </>
          )}
        </>
      )}

      {showCreate && <CreateCampusModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
