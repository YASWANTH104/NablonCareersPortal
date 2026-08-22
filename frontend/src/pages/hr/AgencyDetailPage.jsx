import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft, Plus, Trash2, Pencil, Check, X, Loader2, Power, Mail, Briefcase,
  CalendarClock, Infinity as InfinityIcon, TrendingUp, Building2, AlertCircle,
  Send, Award, Link2, ShieldCheck, CalendarPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { agenciesApi } from '@/api/agencies';
import { jobsApi } from '@/api/jobs';
import { reportsApi } from '@/api/reports';
import { formatIST } from '@/utils/formatters';
import { agencyAccent, agencyInitials } from '@/constants/agencyAccents';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import CopyLink from '@/components/shared/CopyLink';
import PipelineFunnel from '@/components/shared/PipelineFunnel';
import { Modal, EmptyState } from '@/components/ui';
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

function HeroStat({ icon: Icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={cn('w-9 h-9 shrink-0 rounded-xl flex items-center justify-center', accent ?? 'bg-surface-100 text-gray-400')}>
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-xl font-bold text-gray-900 leading-none tabular-nums">{value}</p>
        <p className="text-[11px] text-gray-500 mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}

function EditAgencyModal({ agency, onClose }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(agencySchema),
    defaultValues: {
      name: agency.name ?? '',
      contact_name: agency.contact_name ?? '',
      contact_email: agency.contact_email ?? '',
    },
  });

  const mut = useMutation({
    mutationFn: (data) => agenciesApi.update(agency.id, data),
    onSuccess: () => {
      toast.success('Agency updated');
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not update this agency'),
  });

  return (
    <Modal
      onClose={onClose}
      title={`Edit ${agency.name}`}
      description="Their portal link is unaffected by these changes."
      icon={Building2}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            form="edit-agency"
            disabled={mut.isPending}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {mut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {mut.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      }
    >
      <form
        id="edit-agency"
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
          <input {...register('name')} className={inputCls} autoFocus />
        </Field>
        <Field label="Contact name" hint="Optional" error={errors.contact_name?.message}>
          <input {...register('contact_name')} className={inputCls} placeholder="Priya Nair" />
        </Field>
        <Field label="Contact email" required error={errors.contact_email?.message}>
          <input {...register('contact_email')} type="email" className={inputCls} />
        </Field>
      </form>
    </Modal>
  );
}

function AssignmentCard({ assignment, jobSlug, onRemove, onUpdateCap, updating }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // /agency-apply is the focused, nav-free layout built for exactly this;
  // /jobs/:slug?ref=… only redirects there anyway. Falls back to the job id when
  // the slug isn't in the published-jobs list (GET /jobs caps at 100).
  const trackedLink = `${window.location.origin}/agency-apply/${jobSlug ?? assignment.job_id}?ref=${assignment.ref_token}`;

  const expiresAt = assignment.expires_at ? new Date(assignment.expires_at) : null;
  const expired = expiresAt && expiresAt < new Date();
  const expiringSoon = expiresAt && !expired && expiresAt - new Date() < 7 * 86400000;

  function save() {
    const raw = draft.trim();
    const value = raw ? parseInt(raw, 10) : null;
    if (value !== null && (Number.isNaN(value) || value < 1)) {
      toast.error('The cap must be 1 or more — leave it blank for unlimited');
      return;
    }
    onUpdateCap(assignment.id, value);
    setEditing(false);
  }

  return (
    <div
      className={cn(
        'relative bg-white rounded-2xl border overflow-hidden transition-all hover:shadow-card',
        expired ? 'border-rose-200' : 'border-surface-200'
      )}
    >
      <span className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r', expired ? 'from-rose-300 to-rose-400' : 'from-brand-300 to-brand-500')} />

      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-start gap-2 font-display font-bold text-gray-900">
              <Briefcase className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
              <span className="break-words">{assignment.job_title}</span>
            </h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {editing ? (
                <span className="inline-flex items-center gap-1.5">
                  <input
                    type="number"
                    min="1"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); save(); }
                      if (e.key === 'Escape') setEditing(false);
                    }}
                    placeholder="Unlimited"
                    className="w-28 text-xs border border-brand-400 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button onClick={save} disabled={updating} aria-label="Save cap" className="text-emerald-600 hover:text-emerald-700 disabled:opacity-40">
                    {updating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => setEditing(false)} aria-label="Cancel" className="text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => { setDraft(assignment.max_submissions ? String(assignment.max_submissions) : ''); setEditing(true); }}
                  title="Edit the submission cap"
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-100 text-gray-600 hover:bg-brand-50 hover:text-brand-700 transition-colors"
                >
                  {assignment.max_submissions ? <>Cap {assignment.max_submissions}</> : <><InfinityIcon className="w-3 h-3" /> Unlimited</>}
                  <Pencil className="w-2.5 h-2.5 opacity-60" />
                </button>
              )}
              {expiresAt && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border',
                    expired
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : expiringSoon
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-surface-100 text-gray-600 border-transparent'
                  )}
                >
                  <CalendarClock className="w-3 h-3" />
                  {expired ? 'Expired' : 'Until'} {formatIST(expiresAt, 'd MMM yyyy')}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => onRemove(assignment)}
            aria-label={`Remove the ${assignment.job_title} assignment`}
            className="shrink-0 p-2 -mt-1 -mr-1 rounded-lg text-gray-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {expired && (
          <p className="flex items-start gap-1.5 text-[11px] text-rose-700 mt-3">
            <AlertCircle className="w-3 h-3 shrink-0 mt-px" />
            Every submission against this is refused until you extend or remove it.
          </p>
        )}

        <CopyLink
          className="mt-4"
          label="Trackable apply link"
          url={trackedLink}
          hint="Candidates who apply through this link are attributed to this agency automatically."
        />
      </div>
    </div>
  );
}

export default function AgencyDetailPage() {
  const { agencyId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showEdit, setShowEdit] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedJob, setSelectedJob] = useState('');
  const [maxSubs, setMaxSubs] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingToggle, setPendingToggle] = useState(false);

  // There is no GET /agencies/{id} for HR, so the detail comes out of the same
  // list the index page already has cached — opening a partner is instant.
  const { data: agencies, isLoading } = useQuery({
    queryKey: ['agencies'],
    queryFn: () => agenciesApi.list().then((r) => r.data),
  });
  const agency = (agencies ?? []).find((a) => String(a.id) === String(agencyId));

  const { data: jobsData } = useQuery({
    queryKey: ['jobs-hr'],
    queryFn: () => jobsApi.list({ status: 'published', limit: 100 }).then((r) => r.data.items),
  });

  const { data: performance } = useQuery({
    queryKey: ['agency-performance-dashboard'],
    queryFn: () => reportsApi.agencyPerformance({ days: 365 }).then((r) => r.data),
  });
  const perf = (performance ?? []).find((p) => String(p.agency_id) === String(agencyId));

  const { data: assignments, isLoading: assignmentsLoading, refetch: refetchAssignments } = useQuery({
    queryKey: ['agency-assignments', agencyId],
    queryFn: () => agenciesApi.listAgencyAssignments(agencyId).then((r) => r.data),
    enabled: Boolean(agencyId),
  });

  const assignMutation = useMutation({
    mutationFn: (data) => agenciesApi.assignToJob(selectedJob, data),
    onSuccess: () => {
      toast.success('Job assigned — the agency can submit for it now');
      setShowAssign(false);
      setSelectedJob('');
      setMaxSubs('');
      setExpiresAt('');
      refetchAssignments();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not assign this job'),
  });

  const removeMutation = useMutation({
    mutationFn: (id) => agenciesApi.removeAssignment(id),
    onSuccess: () => { toast.success('Assignment removed'); setPendingRemove(null); refetchAssignments(); },
    onError: (err) => { toast.error(err.response?.data?.detail ?? 'Could not remove this assignment'); setPendingRemove(null); },
  });

  const capMutation = useMutation({
    mutationFn: ({ assignmentId, maxSubmissions }) => agenciesApi.updateAssignment(assignmentId, maxSubmissions),
    onSuccess: () => { toast.success('Submission cap updated'); refetchAssignments(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not update the cap'),
  });

  const toggleMutation = useMutation({
    mutationFn: () => agenciesApi.update(agency.id, { is_active: !agency.is_active }),
    onSuccess: () => {
      toast.success(agency.is_active ? 'Agency deactivated' : 'Agency reactivated');
      setPendingToggle(false);
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
    },
    onError: (err) => { toast.error(err.response?.data?.detail ?? 'Could not update this agency'); setPendingToggle(false); },
  });

  const slugByJobId = useMemo(() => new Map((jobsData ?? []).map((j) => [String(j.id), j.slug])), [jobsData]);
  const assignedIds = new Set((assignments ?? []).map((a) => String(a.job_id)));
  const availableJobs = (jobsData ?? []).filter((j) => !assignedIds.has(String(j.id)));

  const backLink = (
    <Link to="/hr/agencies" className="group inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 mb-4">
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
      Agencies
    </Link>
  );

  if (isLoading) {
    return (
      <div className="max-w-[1100px]">
        {backLink}
        <div className="space-y-4 animate-pulse">
          <div className="h-48 bg-white border border-surface-200 rounded-3xl" />
          <div className="grid lg:grid-cols-2 gap-4">
            {[1, 2].map((i) => <div key={i} className="h-44 bg-white border border-surface-200 rounded-2xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="max-w-[1100px]">
        {backLink}
        <div className="bg-white rounded-2xl border border-surface-200">
          <EmptyState
            icon={Building2}
            title="Agency not found"
            description="It may have been removed. Head back to the list and pick another partner."
            action={
              <button
                onClick={() => navigate('/hr/agencies')}
                className="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors"
              >
                Back to agencies
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const accent = agencyAccent(agency.name, agency.is_active);
  const portalUrl = `${window.location.origin}/agency/${agency.portal_token}`;
  const submitted = perf?.total_submitted ?? 0;
  const counts = {
    inProgress: perf?.in_progress ?? 0,
    hired: perf?.hired ?? 0,
    rejected: perf?.rejected ?? 0,
  };

  return (
    <div className="max-w-[1100px] space-y-5">
      {backLink}

      {/* ── Hero ── */}
      <header className="relative bg-white rounded-3xl border border-surface-200 overflow-hidden shadow-card">
        <span className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', accent.bar)} />

        <div className="p-5 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <span
              className={cn(
                'w-16 h-16 shrink-0 rounded-2xl flex items-center justify-center font-display text-xl font-bold',
                accent.tile
              )}
            >
              {agencyInitials(agency.name)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl sm:text-2xl font-bold text-gray-900 leading-tight break-words">
                  {agency.name}
                </h1>
                <span
                  className={cn(
                    'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border',
                    agency.is_active
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-surface-100 text-gray-500 border-surface-200'
                  )}
                >
                  {agency.is_active ? 'Active' : 'Deactivated'}
                </span>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-gray-500 mt-1.5">
                <Mail className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="break-all">
                  {agency.contact_name ? `${agency.contact_name} · ${agency.contact_email}` : agency.contact_email}
                </span>
              </p>
              {agency.created_at && (
                <p className="text-[11px] text-gray-400 mt-1">
                  Partner since {formatIST(agency.created_at, 'MMMM yyyy')}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowEdit(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-gray-600 bg-white border border-surface-200 rounded-xl hover:text-brand-600 hover:border-brand-300 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              <button
                onClick={() => (agency.is_active ? setPendingToggle(true) : toggleMutation.mutate())}
                disabled={toggleMutation.isPending}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold border rounded-xl transition-colors disabled:opacity-40',
                  agency.is_active
                    ? 'text-gray-600 bg-white border-surface-200 hover:text-rose-600 hover:border-rose-200'
                    : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                )}
              >
                {toggleMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                {agency.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>

        {/* Headline numbers */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-surface-100 divide-x divide-surface-100">
          <HeroStat icon={Send} label="Submitted · 12 mo" value={submitted} accent="bg-brand-50 text-brand-600" />
          <HeroStat icon={Award} label="Hired · 12 mo" value={counts.hired} accent="bg-emerald-50 text-emerald-600" />
          <HeroStat
            icon={TrendingUp}
            label="Conversion"
            value={submitted > 0 ? `${perf.conversion_rate}%` : '—'}
            accent="bg-violet-50 text-violet-600"
          />
          <HeroStat
            icon={Briefcase}
            label="Jobs assigned"
            value={assignmentsLoading ? '…' : assignments?.length ?? 0}
            accent="bg-amber-50 text-amber-600"
          />
        </div>
      </header>

      {/* ── Portal + outcomes ── */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <section className="bg-white rounded-2xl border border-surface-200 p-5">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-gray-900 mb-1">
            <ShieldCheck className="w-4 h-4 text-brand-500" />
            Portal access
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            The one link this partner needs. No login — the link <em>is</em> the credential, so share it like one.
          </p>
          <CopyLink
            url={portalUrl}
            icon={Building2}
            hint={
              agency.is_active
                ? 'Opens their workspace: submit candidates, book interview slots, track progress.'
                : 'Returns “portal not found” while the agency is deactivated.'
            }
          />
        </section>

        <section className="bg-white rounded-2xl border border-surface-200 p-5">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-gray-900 mb-1">
            <Send className="w-4 h-4 text-brand-500" />
            Outcomes · last 12 months
          </h2>
          {submitted > 0 ? (
            <>
              <p className="text-xs text-gray-500 mb-4">
                <span className="font-semibold text-gray-800 tabular-nums">{submitted}</span> candidates submitted
              </p>
              <PipelineFunnel counts={counts} total={submitted} />
            </>
          ) : (
            <p className="text-xs text-gray-400 mt-3">
              Nothing submitted in the last 12 months. Assign a job below and share their portal link to get started.
            </p>
          )}
        </section>
      </div>

      {/* ── Assignments ── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-gray-900">
            <Link2 className="w-4 h-4 text-gray-400" />
            Job assignments
            {!assignmentsLoading && (
              <span className="text-xs font-semibold text-gray-500 bg-surface-100 rounded-full px-2 py-0.5">
                {assignments?.length ?? 0}
              </span>
            )}
          </h2>
          <button
            onClick={() => setShowAssign((s) => !s)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-brand-700 bg-white border border-brand-200 rounded-xl hover:bg-brand-50 transition-colors"
          >
            <Plus className="w-4 h-4" /> Assign a job
          </button>
        </div>

        {showAssign && (
          <div className="bg-white border border-brand-200 rounded-2xl p-5 mb-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-gray-900 mb-4">
              <CalendarPlus className="w-4 h-4 text-brand-500" />
              Open a job to {agency.name}
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <Field label="Job" required>
                <select value={selectedJob} onChange={(e) => setSelectedJob(e.target.value)} className={cn(inputCls, 'bg-white')}>
                  <option value="">Select a published job…</option>
                  {availableJobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.title}</option>
                  ))}
                </select>
              </Field>
              <Field label="Submission cap" hint="Blank = unlimited">
                <input type="number" min="1" value={maxSubs} onChange={(e) => setMaxSubs(e.target.value)} placeholder="Unlimited" className={inputCls} />
              </Field>
              <Field label="Access until" hint="Optional">
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
              </Field>
            </div>
            {availableJobs.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-2">Every published job is already assigned to this agency.</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAssign(false)} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!selectedJob) { toast.error('Pick a job first'); return; }
                  assignMutation.mutate({
                    agency_id: agency.id,
                    max_submissions: maxSubs ? parseInt(maxSubs, 10) : undefined,
                    expires_at: expiresAt || undefined,
                  });
                }}
                disabled={assignMutation.isPending || !selectedJob}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {assignMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {assignMutation.isPending ? 'Assigning…' : 'Assign job'}
              </button>
            </div>
          </div>
        )}

        {assignmentsLoading ? (
          <div className="grid lg:grid-cols-2 gap-4">
            {[1, 2].map((i) => <div key={i} className="h-48 bg-white border border-surface-200 rounded-2xl animate-pulse" />)}
          </div>
        ) : (assignments?.length ?? 0) === 0 ? (
          <div className="bg-white rounded-2xl border border-surface-200">
            <EmptyState
              icon={Briefcase}
              title="No jobs assigned yet"
              description="Assign one and this partner gets a trackable apply link, plus the ability to submit candidates and book interview slots from their portal."
              action={
                <button
                  onClick={() => setShowAssign(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Assign the first job
                </button>
              }
            />
          </div>
        ) : (
          <div className={cn('grid gap-4', assignments.length > 1 && 'lg:grid-cols-2')}>
            {assignments.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                jobSlug={slugByJobId.get(String(a.job_id))}
                onRemove={setPendingRemove}
                onUpdateCap={(assignmentId, maxSubmissions) => capMutation.mutate({ assignmentId, maxSubmissions })}
                updating={capMutation.isPending}
              />
            ))}
          </div>
        )}
      </section>

      {showEdit && <EditAgencyModal agency={agency} onClose={() => setShowEdit(false)} />}

      {pendingRemove && (
        <ConfirmDialog
          danger
          title="Remove this job assignment?"
          message={`${agency.name} will no longer see “${pendingRemove.job_title}” or be able to submit for it, and their trackable link stops attributing candidates. Anyone already submitted is kept.`}
          confirmLabel="Remove assignment"
          isPending={removeMutation.isPending}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => removeMutation.mutate(pendingRemove.id)}
        />
      )}

      {pendingToggle && (
        <ConfirmDialog
          danger
          title={`Deactivate ${agency.name}?`}
          message="Their portal link stops working immediately and they can't submit new candidates. Assignments and everyone already submitted are kept — you can reactivate at any time."
          confirmLabel="Deactivate"
          isPending={toggleMutation.isPending}
          onCancel={() => setPendingToggle(false)}
          onConfirm={() => toggleMutation.mutate()}
        />
      )}
    </div>
  );
}
