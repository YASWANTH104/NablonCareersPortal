import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import {
  Building2, Users, Plus, Trash2, Pencil, Check, X, UserPlus, Loader2, Search,
  UserCog, ShieldCheck, KeyRound, Mail, BadgeCheck, AlertCircle, Info, Clock,
  MailWarning, CircleSlash, ArrowRight, Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { jobsApi } from '@/api/jobs';
import { usersApi } from '@/api/users';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { ROLES, ADMIN_ROLES } from '@/utils/permissions';
import { useDebounced } from '@/hooks/useDebounced';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { PageHeader, Modal, StatTile, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { key: 'account', label: 'My account', icon: UserCog, blurb: 'Your details and sign-in' },
  { key: 'departments', label: 'Departments', icon: Building2, blurb: 'Used across jobs and reports' },
  { key: 'team', label: 'Team access', icon: Users, blurb: 'Who can use this console' },
];

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  hr_manager: 'HR Manager',
  interviewer: 'Interviewer',
  employee: 'Employee',
  applicant: 'Candidate',
};

const ROLE_COLORS = {
  super_admin: 'bg-red-50 text-red-700 border-red-200',
  admin: 'bg-purple-50 text-purple-700 border-purple-200',
  hr_manager: 'bg-brand-50 text-brand-700 border-brand-200',
  interviewer: 'bg-blue-50 text-blue-700 border-blue-200',
  employee: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  applicant: 'bg-surface-100 text-gray-600 border-surface-200',
};

// Spelled out because "what does Admin actually let them do" is exactly the
// question someone is asking at the moment they change a colleague's role.
const ROLE_DESCRIPTIONS = {
  admin: 'Everything HR can do, plus inviting people and changing roles.',
  hr_manager: 'Runs hiring: jobs, candidates, interviews, offers, reports.',
  interviewer: 'Sees their own interviews and publishes their availability.',
  employee: 'Refers candidates and browses open roles.',
};

// Super Admin is deliberately absent — the backend accepts it, but handing it
// out from a dropdown is not a decision this screen should make casually.
const ASSIGNABLE_ROLES = ['admin', 'hr_manager', 'interviewer', 'employee'];

const inputClass =
  'w-full border border-surface-300 rounded-lg px-3 py-2.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-400';

const deptSchema = z.object({ name: z.string().trim().min(1, 'Give the department a name') });

const inviteSchema = z.object({
  full_name: z.string().trim().min(2, 'Name required'),
  email: z.string().trim().email('Valid email required'),
  role: z.string().min(1, 'Role required'),
  department: z.string().optional(),
  employee_id: z.string().optional(),
});

const accountSchema = z.object({
  full_name: z.string().trim().min(2, 'Your name is required'),
  phone: z.string().optional(),
  department: z.string().optional(),
  date_of_birth: z.string().optional(),
});

// ── Shared bits ───────────────────────────────────────────────────────────────

function Avatar({ name, className }) {
  const initials = name
    ? name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
    : '?';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold shrink-0',
        'w-8 h-8 text-xs',
        className
      )}
    >
      {initials}
    </span>
  );
}

function RoleBadge({ role, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap',
        ROLE_COLORS[role] ?? ROLE_COLORS.applicant,
        className
      )}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function Card({ title, description, icon: Icon, action, children, bodyClassName }) {
  return (
    <section className="bg-white rounded-2xl border border-surface-200 overflow-hidden">
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-4 border-b border-surface-200">
          <div className="flex items-start gap-2.5 min-w-0">
            {Icon && (
              <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                <Icon className="w-4 h-4" />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="font-display font-semibold text-gray-900 text-sm">{title}</h2>
              {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn('px-4 sm:px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  );
}

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

function Notice({ icon: Icon = Info, tone = 'info', children }) {
  const tones = {
    info: 'bg-surface-50 border-surface-200 text-gray-600',
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
  };
  return (
    <div className={cn('flex items-start gap-2.5 text-xs rounded-xl border p-3', tones[tone])}>
      <Icon className="w-4 h-4 shrink-0 mt-px opacity-70" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ── My account ────────────────────────────────────────────────────────────────

function AccountSection() {
  const qc = useQueryClient();
  const { user: storeUser, setUser } = useAuthStore();

  // Shares MyProfilePage's key so the two stay in step. refetchOnWindowFocus is
  // off deliberately: a background refetch mid-edit would reset the form under
  // the user's fingers.
  const { data: me, isLoading } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => usersApi.me().then((r) => r.data),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => jobsApi.listDepartments().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const {
    register, handleSubmit, reset,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(accountSchema),
    defaultValues: { full_name: '', phone: '', department: '', date_of_birth: '' },
  });

  useEffect(() => {
    if (!me) return;
    reset({
      full_name: me.full_name ?? '',
      phone: me.phone ?? '',
      department: me.department ?? '',
      date_of_birth: me.date_of_birth ?? '',
    });
  }, [me, reset]);

  // User.department is a free-text column, not the Department FK, so a value
  // can legitimately sit outside the managed list — keep it as an option rather
  // than silently dropping it the first time someone saves this form.
  const departmentOptions = useMemo(() => {
    const names = (departments ?? []).map((d) => d.name);
    if (me?.department && !names.includes(me.department)) names.unshift(me.department);
    return names;
  }, [departments, me?.department]);

  const saveMut = useMutation({
    mutationFn: (values) =>
      usersApi.updateMe({
        full_name: values.full_name,
        phone: values.phone || null,
        department: values.department || null,
        date_of_birth: values.date_of_birth || null,
      }),
    onSuccess: (res) => {
      toast.success('Your details were saved');
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      // Keeps the sidebar footer and topbar in sync without a reload. Merged
      // rather than replaced — the stored user can carry fields the PATCH
      // response doesn't echo back.
      setUser({ ...storeUser, ...res.data });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not save your details'),
  });

  const resetPwMut = useMutation({
    mutationFn: () => authApi.forgotPassword(me?.email),
    onSuccess: () => toast.success('Check your inbox — the reset link is valid for a short while.'),
    onError: () => toast.error('Could not send the reset email. Try again in a moment.'),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 rounded-2xl bg-white border border-surface-200 animate-pulse" />
        ))}
      </div>
    );
  }

  // Without this the form would render as a set of empty fields that silently
  // PATCH nothing useful, which reads as "my details are blank" rather than
  // "we couldn't load them".
  if (!me) {
    return (
      <div className="bg-white rounded-2xl border border-surface-200">
        <EmptyState
          icon={AlertCircle}
          title="Couldn’t load your account"
          description="The request for your profile failed. Refresh the page and try again."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Identity */}
      <section className="bg-white rounded-2xl border border-surface-200 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Avatar name={me?.full_name} className="w-14 h-14 text-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-bold text-gray-900 truncate">{me?.full_name}</h2>
              <RoleBadge role={me?.role} />
            </div>
            <p className="text-sm text-gray-500 mt-0.5 truncate">{me?.email}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-gray-400">
              {me?.employee_id && <span>ID {me.employee_id}</span>}
              {me?.created_at && <span>Joined {format(new Date(me.created_at), 'MMM yyyy')}</span>}
              {me?.last_login_at && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Last sign-in {format(new Date(me.last_login_at), 'd MMM, h:mm a')}
                </span>
              )}
              <span
                className={cn(
                  'inline-flex items-center gap-1 font-medium',
                  me?.is_verified ? 'text-emerald-600' : 'text-amber-600'
                )}
              >
                {me?.is_verified ? <BadgeCheck className="w-3.5 h-3.5" /> : <MailWarning className="w-3.5 h-3.5" />}
                {me?.is_verified ? 'Email verified' : 'Email not verified'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Editable details */}
      <Card
        title="Personal details"
        description="Shown to colleagues on interviews, notes and offers you touch."
        icon={UserCog}
      >
        <form onSubmit={handleSubmit((v) => saveMut.mutate(v))} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name" required error={errors.full_name?.message}>
              <input {...register('full_name')} className={inputClass} placeholder="Jane Smith" />
            </Field>
            <Field label="Phone" hint="Optional" error={errors.phone?.message}>
              <input {...register('phone')} className={inputClass} placeholder="+91 98765 43210" />
            </Field>
            <Field label="Department" hint="Optional">
              <select {...register('department')} className={cn(inputClass, 'bg-white')}>
                <option value="">Not set</option>
                {departmentOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </Field>
            <Field label="Date of birth" hint="Optional">
              <input {...register('date_of_birth')} type="date" className={inputClass} />
            </Field>
          </div>

          <Field label="Email address" hint="Managed by your administrator">
            <input value={me?.email ?? ''} readOnly disabled className={cn(inputClass, 'bg-surface-50 text-gray-500 cursor-not-allowed')} />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-1">
            {isDirty && (
              <button
                type="button"
                onClick={() =>
                  reset({
                    full_name: me?.full_name ?? '',
                    phone: me?.phone ?? '',
                    department: me?.department ?? '',
                    date_of_birth: me?.date_of_birth ?? '',
                  })
                }
                className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-lg hover:bg-surface-50 transition-colors"
              >
                Discard
              </button>
            )}
            <button
              type="submit"
              disabled={!isDirty || saveMut.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saveMut.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </Card>

      {/* Password */}
      <Card title="Password" description="Change the password you use to sign in." icon={KeyRound}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-gray-500 flex-1">
            We’ll email <span className="font-medium text-gray-700">{me?.email}</span> a secure link to set a new
            password. Your current password keeps working until you use it.
          </p>
          <button
            onClick={() => resetPwMut.mutate()}
            disabled={resetPwMut.isPending || !me?.email}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {resetPwMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {resetPwMut.isPending ? 'Sending…' : 'Email me a reset link'}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ── Departments ───────────────────────────────────────────────────────────────

function DepartmentRow({ dept, onRename, onDelete, isBusy }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(dept.name);

  useEffect(() => { setVal(dept.name); }, [dept.name]);

  function commit() {
    const next = val.trim();
    if (!next) { toast.error('A department needs a name'); return; }
    if (next !== dept.name) onRename(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-4 sm:px-5 py-2.5 bg-brand-50/40">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setVal(dept.name); setEditing(false); }
          }}
          className="flex-1 min-w-0 text-sm border border-brand-400 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
          autoFocus
        />
        <button onClick={commit} aria-label="Save" className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={() => { setVal(dept.name); setEditing(false); }}
          aria-label="Cancel"
          className="p-1.5 text-gray-400 hover:bg-surface-100 rounded-lg"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 hover:bg-surface-50 transition-colors">
      <span className="flex items-center gap-2.5 min-w-0">
        <span className="w-7 h-7 shrink-0 rounded-lg bg-surface-100 text-gray-400 flex items-center justify-center">
          <Building2 className="w-3.5 h-3.5" />
        </span>
        <span className="text-sm text-gray-900 truncate">{dept.name}</span>
      </span>
      {/* Always rendered rather than revealed on hover — a hover-only control is
          simply unreachable on a touch screen. */}
      <span className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setEditing(true)}
          aria-label={`Rename ${dept.name}`}
          className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          disabled={isBusy}
          aria-label={`Delete ${dept.name}`}
          className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
  );
}

function DepartmentsSection() {
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(deptSchema) });

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: () => jobsApi.listDepartments().then((r) => r.data),
  });

  // Every job/report surface reads this list, so a rename or delete has to
  // invalidate both cache keys the app uses for it.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['departments'] });
    qc.invalidateQueries({ queryKey: ['job-departments'] });
  };

  const createMut = useMutation({
    mutationFn: (name) => jobsApi.createDepartment(name),
    onSuccess: () => { toast.success('Department added'); reset(); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not add that department'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, name }) => jobsApi.updateDepartment(id, name),
    onSuccess: () => { toast.success('Department renamed'); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not rename that department'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => jobsApi.deleteDepartment(id),
    onSuccess: () => { toast.success('Department deleted'); setPendingDelete(null); invalidate(); },
    onError: (err) => {
      toast.error(err.response?.data?.detail ?? 'Could not delete that department');
      setPendingDelete(null);
    },
  });

  return (
    <div className="space-y-4">
      <Card
        title="Departments"
        description={
          isLoading
            ? 'Loading…'
            : `${departments.length} department${departments.length !== 1 ? 's' : ''} · used on jobs, offers and reports`
        }
        icon={Building2}
        bodyClassName="p-0 sm:p-0"
      >
        {/* Add sits at the top: it's the primary action here, and it used to be
            buried under the whole list. */}
        <form
          onSubmit={handleSubmit((data) => createMut.mutate(data.name.trim()))}
          className="flex items-start gap-2 px-4 sm:px-5 py-3.5 border-b border-surface-200 bg-surface-50/50"
        >
          <div className="flex-1 min-w-0">
            <input
              {...register('name')}
              placeholder="Add a department — e.g. Data Engineering"
              className={cn(inputClass, 'bg-white')}
            />
            {errors.name && (
              <p className="flex items-center gap-1 text-[11px] text-rose-600 mt-1">
                <AlertCircle className="w-3 h-3 shrink-0" /> {errors.name.message}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={createMut.isPending}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </form>

        {isLoading ? (
          <div className="divide-y divide-surface-100">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 px-5 flex items-center">
                <div className="h-3 w-40 bg-surface-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : departments.length === 0 ? (
          <EmptyState
            compact
            icon={Building2}
            title="No departments yet"
            description="Add your first one above. Departments group jobs on the board and split every report."
          />
        ) : (
          <div className="divide-y divide-surface-100">
            {departments.map((d) => (
              <DepartmentRow
                key={d.id}
                dept={d}
                isBusy={deleteMut.isPending && pendingDelete?.id === d.id}
                onRename={(name) => updateMut.mutate({ id: d.id, name })}
                onDelete={() => setPendingDelete(d)}
              />
            ))}
          </div>
        )}
      </Card>

      {pendingDelete && (
        <ConfirmDialog
          danger
          title={`Delete “${pendingDelete.name}”?`}
          message="Deleting a department is permanent. If any job is still assigned to it, the delete will be refused — reassign those jobs first."
          confirmLabel="Delete department"
          isPending={deleteMut.isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteMut.mutate(pendingDelete.id)}
        />
      )}
    </div>
  );
}

// ── Team ──────────────────────────────────────────────────────────────────────

function InviteModal({ departments, onClose }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'employee' },
  });
  const role = watch('role');

  const inviteMut = useMutation({
    mutationFn: (data) => usersApi.invite(data),
    onSuccess: (res) => {
      toast.success(`Invitation sent to ${res.data?.email ?? 'them'}`);
      qc.invalidateQueries({ queryKey: ['team-users'] });
      qc.invalidateQueries({ queryKey: ['team-roster'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not send that invitation'),
  });

  const onSubmit = (values) => {
    const payload = { full_name: values.full_name, email: values.email, role: values.role };
    if (values.department) payload.department = values.department;
    if (values.employee_id) payload.employee_id = values.employee_id;
    inviteMut.mutate(payload);
  };

  return (
    <Modal
      onClose={onClose}
      title="Invite a team member"
      description="They’ll get an email with a link to set their own password."
      icon={UserPlus}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            form="invite-form"
            disabled={inviteMut.isPending}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {inviteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {inviteMut.isPending ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
      }
    >
      <form id="invite-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name" required error={errors.full_name?.message}>
            <input {...register('full_name')} className={inputClass} placeholder="Jane Smith" autoFocus />
          </Field>
          <Field label="Work email" required error={errors.email?.message}>
            <input {...register('email')} type="email" className={inputClass} placeholder="jane@nablon.ai" />
          </Field>
          <Field label="Department" hint="Optional">
            <select {...register('department')} className={cn(inputClass, 'bg-white')}>
              <option value="">Not set</option>
              {(departments ?? []).map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Employee ID" hint="Optional">
            <input {...register('employee_id')} className={inputClass} placeholder="EMP-001" />
          </Field>
        </div>

        <div>
          <span className="block text-xs font-semibold text-gray-700 mb-2">Role</span>
          <div className="space-y-1.5">
            {ASSIGNABLE_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setValue('role', r, { shouldValidate: true })}
                aria-pressed={role === r}
                className={cn(
                  'w-full flex items-start gap-3 text-left px-3 py-2.5 rounded-xl border transition-all',
                  role === r ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-surface-200 hover:border-brand-300'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center',
                    role === r ? 'border-brand-500' : 'border-surface-300'
                  )}
                >
                  {role === r && <span className="w-2 h-2 rounded-full bg-brand-500" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{ROLE_LABELS[r]}</span>
                    {r === 'admin' && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-purple-700 bg-purple-50 border border-purple-200 rounded px-1 py-px">
                        Elevated
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">{ROLE_DESCRIPTIONS[r]}</span>
                </span>
              </button>
            ))}
          </div>
          <input type="hidden" {...register('role')} />
        </div>
      </form>
    </Modal>
  );
}

function ChangeRoleModal({ member, onClose, onSave, isPending }) {
  const [role, setRole] = useState(member.role);
  const changed = role !== member.role;

  return (
    <Modal
      onClose={onClose}
      title={`Change role for ${member.full_name}`}
      description="Takes effect the next time they load the console."
      icon={ShieldCheck}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            disabled={!changed || isPending}
            onClick={() => onSave(role)}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {isPending ? 'Saving…' : 'Update role'}
          </button>
        </div>
      }
    >
      <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 border border-surface-200 mb-4">
        <Avatar name={member.full_name} className="w-9 h-9 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{member.full_name}</p>
          <p className="text-xs text-gray-500 truncate">{member.email}</p>
        </div>
        <span className="flex items-center gap-1.5 shrink-0">
          <RoleBadge role={member.role} />
          {changed && (
            <>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
              <RoleBadge role={role} />
            </>
          )}
        </span>
      </div>

      <div className="space-y-1.5">
        {ASSIGNABLE_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            aria-pressed={role === r}
            className={cn(
              'w-full flex items-start gap-3 text-left px-3 py-2.5 rounded-xl border transition-all',
              role === r ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-surface-200 hover:border-brand-300'
            )}
          >
            <span
              className={cn(
                'mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center',
                role === r ? 'border-brand-500' : 'border-surface-300'
              )}
            >
              {role === r && <span className="w-2 h-2 rounded-full bg-brand-500" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{ROLE_LABELS[r]}</span>
                {r === member.role && <span className="text-[10px] text-gray-400">current</span>}
              </span>
              <span className="block text-xs text-gray-500 mt-0.5">{ROLE_DESCRIPTIONS[r]}</span>
            </span>
          </button>
        ))}
      </div>

      {role === 'admin' && role !== member.role && (
        <div className="mt-4">
          <Notice tone="warn" icon={ShieldCheck}>
            Admins can invite people, change anyone’s role and deactivate accounts — including yours.
          </Notice>
        </div>
      )}
    </Modal>
  );
}

function statusOf(member) {
  if (!member.is_active) return 'inactive';
  if (!member.is_verified) return 'invited';
  return 'active';
}

const STATUS_STYLES = {
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: BadgeCheck },
  invited: { label: 'Invite pending', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: MailWarning },
  inactive: { label: 'Deactivated', className: 'bg-surface-100 text-gray-500 border-surface-200', icon: CircleSlash },
};

function StatusBadge({ member }) {
  const s = STATUS_STYLES[statusOf(member)];
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap', s.className)}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

function TeamSection() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuthStore();
  // Inviting, changing roles and deactivating are all ADMIN/SUPER_ADMIN on the
  // backend, while GET /users is open to HR managers too. Showing those
  // controls to an HR manager — as this page used to — walked them into three
  // separate 403s, so they are gated here to match.
  const canManage = ADMIN_ROLES.includes(currentUser?.role);

  const [showInvite, setShowInvite] = useState(false);
  const [roleTarget, setRoleTarget] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [includeCandidates, setIncludeCandidates] = useState(false);

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => jobsApi.listDepartments().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // `internal_only` and `role` AND together on the backend, so sending both
  // when the filter *is* a role would guarantee an empty list.
  const { data: members = [], isLoading, isError, isFetching } = useQuery({
    queryKey: ['team-users', { roleFilter, search, includeCandidates }],
    queryFn: () =>
      usersApi
        .list({
          ...(roleFilter ? { role: roleFilter } : {}),
          ...(!roleFilter && !includeCandidates ? { internal_only: true } : {}),
          ...(search ? { search } : {}),
        })
        .then((r) => (Array.isArray(r.data) ? r.data : [])),
  });

  const visible = useMemo(
    () => (statusFilter ? members.filter((m) => statusOf(m) === statusFilter) : members),
    [members, statusFilter]
  );

  // Deliberately its own unfiltered query: the tiles describe the whole team,
  // so deriving them from the filtered list would make them jump around as you
  // type in the search box.
  const { data: roster = [] } = useQuery({
    queryKey: ['team-roster'],
    queryFn: () => usersApi.list({ internal_only: true }).then((r) => (Array.isArray(r.data) ? r.data : [])),
    staleTime: 60_000,
  });

  const stats = useMemo(
    () => ({
      total: roster.length,
      active: roster.filter((m) => statusOf(m) === 'active').length,
      invited: roster.filter((m) => statusOf(m) === 'invited').length,
      inactive: roster.filter((m) => statusOf(m) === 'inactive').length,
    }),
    [roster]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['team-users'] });
    qc.invalidateQueries({ queryKey: ['team-roster'] });
  };

  const roleMut = useMutation({
    mutationFn: ({ id, role }) => usersApi.changeRole(id, role),
    onSuccess: () => { toast.success('Role updated'); setRoleTarget(null); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not change that role'),
  });

  const toggleMut = useMutation({
    mutationFn: (id) => usersApi.toggleActive(id),
    onSuccess: (_res, id) => {
      const was = members.find((m) => m.id === id);
      toast.success(was?.is_active ? 'Account deactivated' : 'Account reactivated');
      setStatusTarget(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail ?? 'Could not update that account');
      setStatusTarget(null);
    },
  });

  const filtersActive = Boolean(search || roleFilter || statusFilter);

  function clearFilters() {
    setSearchInput('');
    setRoleFilter('');
    setStatusFilter('');
  }

  return (
    <div className="space-y-4">
      {!canManage && (
        <Notice icon={ShieldCheck}>
          You can see who has access, but inviting people, changing roles and deactivating accounts are
          admin-only actions. Ask an admin if you need one of those.
        </Notice>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Team members" value={stats.total} icon={Users} tone="brand" />
        <StatTile label="Active" value={stats.active} icon={BadgeCheck} tone="emerald" />
        <StatTile label="Invite pending" value={stats.invited} icon={MailWarning} tone="amber" />
        <StatTile label="Deactivated" value={stats.inactive} icon={CircleSlash} tone="slate" />
      </div>

      <Card
        title="Who has access"
        description="Everyone who can sign in to the hiring console."
        icon={Users}
        bodyClassName="p-0 sm:p-0"
        action={
          canManage ? (
            <button
              onClick={() => setShowInvite(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
            >
              <UserPlus className="w-4 h-4" /> Invite
            </button>
          ) : null
        }
      >
        {/* Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-2.5 px-4 sm:px-5 py-3.5 border-b border-surface-200 bg-surface-50/50">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full pl-9 pr-9 py-2.5 text-sm bg-white border border-surface-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-gray-400 hover:bg-surface-100 flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className={cn(inputClass, 'w-auto bg-white py-2')}
            >
              <option value="">All roles</option>
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={cn(inputClass, 'w-auto bg-white py-2')}
            >
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="invited">Invite pending</option>
              <option value="inactive">Deactivated</option>
            </select>
            {filtersActive && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-sm font-medium text-gray-500 hover:text-brand-600 rounded-lg hover:bg-white transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Candidate accounts are hidden by default — GET /users returns every
            applicant too, which buried the actual team in the noise. */}
        {!roleFilter && (
          <label className="flex items-center gap-2 px-4 sm:px-5 py-2.5 border-b border-surface-100 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeCandidates}
              onChange={(e) => setIncludeCandidates(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-surface-300 text-brand-500 focus:ring-brand-500"
            />
            <span className="text-xs text-gray-500">Include candidate accounts</span>
            {isFetching && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
          </label>
        )}

        {isLoading ? (
          <div className="divide-y divide-surface-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 px-5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-surface-100 animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 bg-surface-100 rounded animate-pulse" />
                  <div className="h-3 w-48 bg-surface-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn’t load the team"
            description="The request for the user list failed. Refresh the page, or check with an admin if it keeps happening."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Users}
            title={filtersActive ? 'Nobody matches those filters' : 'No team members yet'}
            description={
              filtersActive
                ? 'Try a different name, role or status.'
                : 'Invite your first colleague and they’ll show up here.'
            }
            action={
              filtersActive ? (
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors"
                >
                  Clear filters
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50">
                  <th className="px-4 sm:px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Member</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Role</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Status</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Last sign-in</th>
                  <th className="px-4 sm:px-5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    {canManage ? 'Manage' : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {visible.map((m) => {
                  const isSelf = String(m.id) === String(currentUser?.id);
                  // Super Admin isn't in ASSIGNABLE_ROLES, so offering "change
                  // role" on one would only ever be able to demote them.
                  const roleEditable = canManage && !isSelf && m.role !== ROLES.SUPER_ADMIN;
                  return (
                    <tr key={m.id} className={cn('hover:bg-surface-50 transition-colors', !m.is_active && 'opacity-60')}>
                      <td className="px-4 sm:px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={m.full_name} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 font-medium text-gray-900 text-sm">
                              <span className="truncate">{m.full_name}</span>
                              {isSelf && (
                                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-brand-700 bg-brand-50 border border-brand-200 rounded px-1 py-px">
                                  You
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-400 truncate">{m.email}</p>
                            {(m.employee_id || m.department) && (
                              <p className="text-[11px] text-gray-400 truncate">
                                {[m.employee_id, m.department].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><RoleBadge role={m.role} /></td>
                      <td className="px-4 py-3"><StatusBadge member={m} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {m.last_login_at ? format(new Date(m.last_login_at), 'd MMM yyyy') : '—'}
                      </td>
                      <td className="px-4 sm:px-5 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {roleEditable && (
                            <button
                              onClick={() => setRoleTarget(m)}
                              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-white hover:text-brand-600 hover:border-brand-200 transition-colors"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" /> Role
                            </button>
                          )}
                          {canManage && !isSelf && (
                            <button
                              onClick={() => setStatusTarget(m)}
                              className={cn(
                                'text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors',
                                m.is_active
                                  ? 'border-surface-200 text-gray-600 hover:border-rose-200 hover:text-rose-600 hover:bg-rose-50'
                                  : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                              )}
                            >
                              {m.is_active ? 'Deactivate' : 'Reactivate'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showInvite && <InviteModal departments={departments} onClose={() => setShowInvite(false)} />}

      {roleTarget && (
        <ChangeRoleModal
          member={roleTarget}
          isPending={roleMut.isPending}
          onClose={() => setRoleTarget(null)}
          onSave={(role) => roleMut.mutate({ id: roleTarget.id, role })}
        />
      )}

      {statusTarget && (
        <ConfirmDialog
          danger={statusTarget.is_active}
          title={statusTarget.is_active ? `Deactivate ${statusTarget.full_name}?` : `Reactivate ${statusTarget.full_name}?`}
          message={
            statusTarget.is_active
              ? 'They lose access immediately and stay signed out until reactivated. Their history, notes and interview feedback are kept.'
              : 'They get their previous access back and can sign in again straight away.'
          }
          confirmLabel={statusTarget.is_active ? 'Deactivate' : 'Reactivate'}
          isPending={toggleMut.isPending}
          onCancel={() => setStatusTarget(null)}
          onConfirm={() => toggleMut.mutate(statusTarget.id)}
        />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [section, setSection] = useState('account');

  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title="Settings"
        description="Your account, the departments jobs are filed under, and who can use this console."
      />

      <div className="grid lg:grid-cols-[232px_1fr] gap-4 lg:gap-6 items-start">
        {/* Section nav — a vertical rail on desktop, a scrollable row on mobile */}
        <nav
          aria-label="Settings sections"
          className="lg:sticky lg:top-0 flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 -mx-1 px-1 lg:mx-0 lg:px-0"
        >
          {SECTIONS.map(({ key, label, icon: Icon, blurb }) => {
            const active = section === key;
            return (
              <button
                key={key}
                onClick={() => setSection(key)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'shrink-0 lg:w-full flex items-center lg:items-start gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors',
                  active
                    ? 'bg-brand-50 border-brand-200 text-brand-700'
                    : 'bg-white border-surface-200 text-gray-600 hover:bg-surface-50 hover:text-gray-900'
                )}
              >
                <Icon className={cn('w-4 h-4 shrink-0 lg:mt-0.5', active ? 'text-brand-500' : 'text-gray-400')} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold whitespace-nowrap lg:whitespace-normal">{label}</span>
                  <span className={cn('hidden lg:block text-[11px] mt-0.5', active ? 'text-brand-600/80' : 'text-gray-400')}>
                    {blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {section === 'account' && <AccountSection />}
          {section === 'departments' && <DepartmentsSection />}
          {section === 'team' && <TeamSection />}
        </div>
      </div>
    </div>
  );
}
