import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft, Plus, Trash2, Pencil, Check, X, Loader2, Power, Mail, Briefcase,
  CalendarClock, GraduationCap, AlertCircle, Link2, ShieldCheck, CalendarPlus,
  ClipboardList, Users, CheckCircle2, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { campusesApi } from '@/api/campuses';
import { jobsApi } from '@/api/jobs';
import { applicationsApi } from '@/api/applications';
import { assessmentsApi } from '@/api/assessments';
import { formatIST } from '@/utils/formatters';
import { agencyAccent, agencyInitials } from '@/constants/agencyAccents';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import CopyLink from '@/components/shared/CopyLink';
import { Modal, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';

const inputCls =
  'w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-400';

const campusSchema = z.object({
  name: z.string().trim().min(2, 'Give the campus a name'),
  contact_name: z.string().optional(),
  contact_email: z.string().trim().email('A valid contact email is required'),
});

const ASSESSMENT_TYPES = [
  { value: 'online_test', label: 'Online Test' },
  { value: 'coding_challenge', label: 'Coding Challenge' },
  { value: 'aptitude', label: 'Aptitude' },
  { value: 'case_study', label: 'Case Study' },
  { value: 'assignment', label: 'Assignment' },
];

const OPEN_STAGES = new Set(['applied', 'screening', 'assessment', 'tr1', 'tr2', 'final_tr', 'hr', 'offer']);

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

function EditCampusModal({ campus, onClose }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(campusSchema),
    defaultValues: {
      name: campus.name ?? '',
      contact_name: campus.contact_name ?? '',
      contact_email: campus.contact_email ?? '',
    },
  });

  const mut = useMutation({
    mutationFn: (data) => campusesApi.update(campus.id, data),
    onSuccess: () => {
      toast.success('Campus updated');
      queryClient.invalidateQueries({ queryKey: ['campuses'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not update this campus'),
  });

  return (
    <Modal
      onClose={onClose}
      title={`Edit ${campus.name}`}
      description="Their portal link is unaffected by these changes."
      icon={GraduationCap}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            form="edit-campus"
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
        id="edit-campus"
        onSubmit={handleSubmit((v) =>
          mut.mutate({
            name: v.name.trim(),
            contact_name: v.contact_name?.trim() || null,
            contact_email: v.contact_email.trim(),
          })
        )}
        className="space-y-4"
      >
        <Field label="Campus name" required error={errors.name?.message}>
          <input {...register('name')} className={inputCls} autoFocus />
        </Field>
        <Field label="Placement cell contact" hint="Optional" error={errors.contact_name?.message}>
          <input {...register('contact_name')} className={inputCls} placeholder="Dr. Anjali Rao" />
        </Field>
        <Field label="Contact email" required error={errors.contact_email?.message}>
          <input {...register('contact_email')} type="email" className={inputCls} />
        </Field>
      </form>
    </Modal>
  );
}

// ── Bulk schedule assessments ────────────────────────────────────────────────

function BulkScheduleModal({ assignment, onClose }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(new Set());
  const [results, setResults] = useState(null);
  const [form, setForm] = useState({
    title: '', assessment_type: 'online_test', deadline: '', duration_mins: '',
    platform_link: '', instructions: '',
  });

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['campus-assignment-candidates', assignment.id],
    queryFn: () =>
      applicationsApi
        .list({ job_id: assignment.job_id, campus_id: assignment.campus_id, limit: 300 })
        .then((r) => r.data.items),
  });

  const eligible = useMemo(
    () => (candidates ?? []).filter((c) => OPEN_STAGES.has(c.stage)),
    [candidates]
  );

  const allSelected = eligible.length > 0 && selected.size === eligible.length;
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const mut = useMutation({
    mutationFn: () =>
      assessmentsApi
        .bulkCreate({
          application_ids: [...selected],
          title: form.title.trim(),
          assessment_type: form.assessment_type,
          deadline: new Date(form.deadline).toISOString(),
          duration_mins: form.duration_mins ? parseInt(form.duration_mins, 10) : undefined,
          platform_link: form.platform_link.trim(),
          instructions: form.instructions.trim() || undefined,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      setResults(data.results);
      queryClient.invalidateQueries({ queryKey: ['hr-applications'] });
      queryClient.invalidateQueries({ queryKey: ['campus-assignment-candidates', assignment.id] });
      if (data.created > 0) {
        toast.success(
          `Assessment scheduled for ${data.created} candidate${data.created !== 1 ? 's' : ''}`
          + (data.moved_to_assessment ? `, ${data.moved_to_assessment} moved to Assessment` : '')
          + '. Emails are on their way.',
        );
      }
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Bulk scheduling failed'),
  });

  const canSubmit = selected.size > 0 && form.title.trim() && form.deadline && form.platform_link.trim();

  if (results) {
    const created = results.filter((r) => r.status === 'success').length;
    return (
      <Modal onClose={onClose} title="Assessments scheduled" icon={ClipboardList} size="md">
        <p className="text-sm text-gray-600 mb-3">
          <span className="font-semibold text-emerald-600">{created} scheduled</span>
          {results.length - created > 0 && <span className="text-rose-500"> · {results.length - created} failed</span>}
          {results.some((r) => r.stage_moved) && (
            <span className="text-gray-600"> · {results.filter((r) => r.stage_moved).length} moved to Assessment</span>
          )}
        </p>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-surface-200 divide-y divide-surface-100">
          {results.map((r, i) => {
            const candidate = eligible.find((c) => c.id === r.application_id);
            return (
              <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
                {r.status === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-gray-800 font-medium truncate">{candidate?.applicant?.full_name ?? r.application_id}</p>
                  {r.status === 'error' && <p className="text-rose-500 text-xs">{r.error}</p>}
                  {r.status === 'success' && (
                    <p className={r.stage_moved ? 'text-xs text-emerald-600' : 'text-xs text-amber-600'}>
                      {r.stage_moved ? 'Moved to Assessment' : r.stage_note}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600">
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onClose}
      title="Bulk-schedule an assessment"
      description={assignment.job_title}
      icon={ClipboardList}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <p className="text-xs text-gray-400">{selected.size} of {eligible.length} selected</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={() => mut.mutate()}
              disabled={!canSubmit || mut.isPending}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {mut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {mut.isPending ? 'Scheduling…' : `Schedule for ${selected.size || ''}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3.5 mb-5">
        <Field label="Assessment title" required>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className={inputCls}
            placeholder="Online Aptitude Round"
          />
        </Field>
        <Field label="Type">
          <select
            value={form.assessment_type}
            onChange={(e) => setForm((f) => ({ ...f, assessment_type: e.target.value }))}
            className={cn(inputCls, 'bg-white')}
          >
            {ASSESSMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Deadline" required>
          <input
            type="datetime-local"
            value={form.deadline}
            onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Field label="Duration (minutes)" hint="Optional">
          <input
            type="number"
            min="1"
            value={form.duration_mins}
            onChange={(e) => setForm((f) => ({ ...f, duration_mins: e.target.value }))}
            className={inputCls}
            placeholder="60"
          />
        </Field>
        <Field label="Platform link" required hint="Where they take the test">
          <input
            value={form.platform_link}
            onChange={(e) => setForm((f) => ({ ...f, platform_link: e.target.value }))}
            className={inputCls}
            placeholder="https://…"
          />
        </Field>
        <Field label="Instructions" hint="Optional">
          <input
            value={form.instructions}
            onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            className={inputCls}
            placeholder="Any notes for the candidate"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Who is this for?</p>
        {eligible.length > 0 && (
          <button
            onClick={() => setSelected(allSelected ? new Set() : new Set(eligible.map((c) => c.id)))}
            className="text-[11px] font-semibold text-brand-600 hover:text-brand-700"
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => <div key={i} className="h-11 bg-surface-100 rounded-xl animate-pulse" />)}
        </div>
      ) : eligible.length === 0 ? (
        <EmptyState compact icon={Users} title="No candidates yet" description="Nobody has been submitted for this drive, or everyone here is already closed out." />
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1.5 -mx-1 px-1">
          {eligible.map((c) => (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className={cn(
                'w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl border transition-all',
                selected.has(c.id) ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-surface-200 hover:border-brand-200 hover:bg-surface-50'
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 truncate">{c.applicant?.full_name}</span>
                <span className="block text-[11px] text-gray-400">{c.applicant?.email}</span>
              </span>
              {selected.has(c.id) && <Check className="w-4 h-4 text-brand-500 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Assignment card ───────────────────────────────────────────────────────────

function AssignmentCard({ assignment, jobSlug, onRemove, onUpdateCap, updating, onBulkSchedule }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // /campus-apply is the focused, nav-free layout built for exactly this;
  // falls back to the job id when the slug isn't in the published-jobs list
  // (GET /jobs caps at 100) — same fallback AgencyDetailPage uses.
  const trackedLink = `${window.location.origin}/campus-apply/${jobSlug ?? assignment.job_id}?ref=${assignment.ref_token}`;

  const expiresAt = assignment.expires_at ? new Date(assignment.expires_at) : null;
  const expired = expiresAt && expiresAt < new Date();
  const driveDate = assignment.drive_date ? new Date(assignment.drive_date) : null;

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
    <div className={cn('relative bg-white rounded-2xl border overflow-hidden transition-all hover:shadow-card', expired ? 'border-rose-200' : 'border-surface-200')}>
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
                    type="number" min="1" autoFocus value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setEditing(false); }}
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
                  {assignment.max_submissions ? <>Cap {assignment.max_submissions}</> : 'Unlimited'}
                  <Pencil className="w-2.5 h-2.5 opacity-60" />
                </button>
              )}
              {driveDate && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                  <CalendarClock className="w-3 h-3" /> Drive {formatIST(driveDate, 'd MMM yyyy')}
                </span>
              )}
              {expiresAt && (
                <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border', expired ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-surface-100 text-gray-600 border-transparent')}>
                  <CalendarClock className="w-3 h-3" /> {expired ? 'Expired' : 'Until'} {formatIST(expiresAt, 'd MMM yyyy')}
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

        <CopyLink
          className="mt-4"
          label="Student self-apply link"
          url={trackedLink}
          hint="Students who apply through this link are attributed to this campus automatically."
        />

        <button
          onClick={() => onBulkSchedule(assignment)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-xl hover:bg-brand-100 transition-colors"
        >
          <ClipboardList className="w-4 h-4" /> Bulk-schedule assessments
        </button>
      </div>
    </div>
  );
}

export default function CampusDetailPage() {
  const { campusId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showEdit, setShowEdit] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedJob, setSelectedJob] = useState('');
  const [driveDate, setDriveDate] = useState('');
  const [maxSubs, setMaxSubs] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingToggle, setPendingToggle] = useState(false);
  const [bulkFor, setBulkFor] = useState(null);

  const { data: campuses, isLoading } = useQuery({
    queryKey: ['campuses'],
    queryFn: () => campusesApi.list().then((r) => r.data),
  });
  const campus = (campuses ?? []).find((c) => String(c.id) === String(campusId));

  const { data: jobsData } = useQuery({
    queryKey: ['jobs-hr'],
    queryFn: () => jobsApi.list({ status: 'published', limit: 100 }).then((r) => r.data.items),
  });

  const { data: assignments, isLoading: assignmentsLoading, refetch: refetchAssignments } = useQuery({
    queryKey: ['campus-assignments', campusId],
    queryFn: () => campusesApi.listCampusAssignments(campusId).then((r) => r.data),
    enabled: Boolean(campusId),
  });

  const assignMutation = useMutation({
    mutationFn: (data) => campusesApi.assignToJob(selectedJob, data),
    onSuccess: () => {
      toast.success('Drive created — the campus portal can submit for it now');
      setShowAssign(false);
      setSelectedJob(''); setDriveDate(''); setMaxSubs(''); setExpiresAt('');
      refetchAssignments();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not create this drive'),
  });

  const removeMutation = useMutation({
    mutationFn: (id) => campusesApi.removeAssignment(id),
    onSuccess: () => { toast.success('Drive removed'); setPendingRemove(null); refetchAssignments(); },
    onError: (err) => { toast.error(err.response?.data?.detail ?? 'Could not remove this drive'); setPendingRemove(null); },
  });

  const capMutation = useMutation({
    mutationFn: ({ assignmentId, maxSubmissions }) => campusesApi.updateAssignment(assignmentId, { max_submissions: maxSubmissions }),
    onSuccess: () => { toast.success('Submission cap updated'); refetchAssignments(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not update the cap'),
  });

  const toggleMutation = useMutation({
    mutationFn: () => campusesApi.update(campus.id, { is_active: !campus.is_active }),
    onSuccess: () => {
      toast.success(campus.is_active ? 'Campus deactivated' : 'Campus reactivated');
      setPendingToggle(false);
      queryClient.invalidateQueries({ queryKey: ['campuses'] });
    },
    onError: (err) => { toast.error(err.response?.data?.detail ?? 'Could not update this campus'); setPendingToggle(false); },
  });

  const slugByJobId = useMemo(() => new Map((jobsData ?? []).map((j) => [String(j.id), j.slug])), [jobsData]);
  const assignedIds = new Set((assignments ?? []).map((a) => String(a.job_id)));
  const availableJobs = (jobsData ?? []).filter((j) => !assignedIds.has(String(j.id)));

  const backLink = (
    <Link to="/hr/campuses" className="group inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 mb-4">
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
      Campus Placements
    </Link>
  );

  if (isLoading) {
    return (
      <div className="max-w-[1100px]">
        {backLink}
        <div className="space-y-4 animate-pulse">
          <div className="h-40 bg-white border border-surface-200 rounded-3xl" />
          <div className="grid lg:grid-cols-2 gap-4">
            {[1, 2].map((i) => <div key={i} className="h-52 bg-white border border-surface-200 rounded-2xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!campus) {
    return (
      <div className="max-w-[1100px]">
        {backLink}
        <div className="bg-white rounded-2xl border border-surface-200">
          <EmptyState
            icon={GraduationCap}
            title="Campus not found"
            description="It may have been removed. Head back to the list and pick another campus."
            action={
              <button onClick={() => navigate('/hr/campuses')} className="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors">
                Back to campuses
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const accent = agencyAccent(campus.name, campus.is_active);
  const portalUrl = `${window.location.origin}/campus/${campus.portal_token}`;

  return (
    <div className="max-w-[1100px] space-y-5">
      {backLink}

      <header className="relative bg-white rounded-3xl border border-surface-200 overflow-hidden shadow-card">
        <span className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', accent.bar)} />
        <div className="p-5 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <span className={cn('w-16 h-16 shrink-0 rounded-2xl flex items-center justify-center font-display text-xl font-bold', accent.tile)}>
              {agencyInitials(campus.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl sm:text-2xl font-bold text-gray-900 leading-tight break-words">{campus.name}</h1>
                <span className={cn('text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border', campus.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-surface-100 text-gray-500 border-surface-200')}>
                  {campus.is_active ? 'Active' : 'Deactivated'}
                </span>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-gray-500 mt-1.5">
                <Mail className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="break-all">{campus.contact_name ? `${campus.contact_name} · ${campus.contact_email}` : campus.contact_email}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setShowEdit(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-gray-600 bg-white border border-surface-200 rounded-xl hover:text-brand-600 hover:border-brand-300 transition-colors">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              <button
                onClick={() => (campus.is_active ? setPendingToggle(true) : toggleMutation.mutate())}
                disabled={toggleMutation.isPending}
                className={cn('inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold border rounded-xl transition-colors disabled:opacity-40', campus.is_active ? 'text-gray-600 bg-white border-surface-200 hover:text-rose-600 hover:border-rose-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100')}
              >
                {toggleMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                {campus.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-surface-100 p-5 sm:p-7">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-gray-900 mb-1">
            <ShieldCheck className="w-4 h-4 text-brand-500" /> Portal access
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            The one link this placement cell needs. No login — the link <em>is</em> the credential.
          </p>
          <CopyLink
            url={portalUrl}
            icon={GraduationCap}
            hint={campus.is_active ? 'Opens their workspace: upload a student roster, share the self-apply link, bulk-schedule assessments.' : 'Returns "portal not found" while the campus is deactivated.'}
          />
        </div>
      </header>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-gray-900">
            <Link2 className="w-4 h-4 text-gray-400" /> Placement drives
            {!assignmentsLoading && <span className="text-xs font-semibold text-gray-500 bg-surface-100 rounded-full px-2 py-0.5">{assignments?.length ?? 0}</span>}
          </h2>
          <button onClick={() => setShowAssign((s) => !s)} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-brand-700 bg-white border border-brand-200 rounded-xl hover:bg-brand-50 transition-colors">
            <Plus className="w-4 h-4" /> New drive
          </button>
        </div>

        {showAssign && (
          <div className="bg-white border border-brand-200 rounded-2xl p-5 mb-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-gray-900 mb-4">
              <CalendarPlus className="w-4 h-4 text-brand-500" /> Open a job to {campus.name}
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <Field label="Job" required>
                <select value={selectedJob} onChange={(e) => setSelectedJob(e.target.value)} className={cn(inputCls, 'bg-white')}>
                  <option value="">Select a published job…</option>
                  {availableJobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
              </Field>
              <Field label="Drive date" hint="Optional">
                <input type="date" value={driveDate} onChange={(e) => setDriveDate(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Submission cap" hint="Blank = unlimited">
                <input type="number" min="1" value={maxSubs} onChange={(e) => setMaxSubs(e.target.value)} placeholder="Unlimited" className={inputCls} />
              </Field>
              <Field label="Access until" hint="Optional">
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
              </Field>
            </div>
            {availableJobs.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-2">Every published job is already assigned to this campus.</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAssign(false)} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700">Cancel</button>
              <button
                onClick={() => {
                  if (!selectedJob) { toast.error('Pick a job first'); return; }
                  assignMutation.mutate({
                    campus_id: campus.id,
                    drive_date: driveDate || undefined,
                    max_submissions: maxSubs ? parseInt(maxSubs, 10) : undefined,
                    expires_at: expiresAt || undefined,
                  });
                }}
                disabled={assignMutation.isPending || !selectedJob}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {assignMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {assignMutation.isPending ? 'Creating…' : 'Create drive'}
              </button>
            </div>
          </div>
        )}

        {assignmentsLoading ? (
          <div className="grid lg:grid-cols-2 gap-4">
            {[1, 2].map((i) => <div key={i} className="h-56 bg-white border border-surface-200 rounded-2xl animate-pulse" />)}
          </div>
        ) : (assignments?.length ?? 0) === 0 ? (
          <div className="bg-white rounded-2xl border border-surface-200">
            <EmptyState
              icon={Briefcase}
              title="No drives yet"
              description="Open a job to this campus and it gets a student self-apply link plus a portal to upload their roster and bulk-schedule assessments."
              action={
                <button onClick={() => setShowAssign(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors">
                  <Plus className="w-4 h-4" /> Open the first drive
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
                onBulkSchedule={setBulkFor}
              />
            ))}
          </div>
        )}
      </section>

      {showEdit && <EditCampusModal campus={campus} onClose={() => setShowEdit(false)} />}
      {bulkFor && <BulkScheduleModal assignment={bulkFor} onClose={() => setBulkFor(null)} />}

      {pendingRemove && (
        <ConfirmDialog
          danger
          title="Remove this drive?"
          message={`${campus.name} will no longer see "${pendingRemove.job_title}" or be able to submit for it, and their self-apply link stops attributing candidates. Anyone already submitted is kept.`}
          confirmLabel="Remove drive"
          isPending={removeMutation.isPending}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => removeMutation.mutate(pendingRemove.id)}
        />
      )}

      {pendingToggle && (
        <ConfirmDialog
          danger
          title={`Deactivate ${campus.name}?`}
          message="Their portal link stops working immediately and they can't submit new students. Drives and everyone already submitted are kept — you can reactivate at any time."
          confirmLabel="Deactivate"
          isPending={toggleMutation.isPending}
          onCancel={() => setPendingToggle(false)}
          onConfirm={() => toggleMutation.mutate()}
        />
      )}
    </div>
  );
}
