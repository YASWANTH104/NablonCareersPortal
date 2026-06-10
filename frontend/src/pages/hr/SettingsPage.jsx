import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Users, Plus, Trash2, Edit2, Check, X, UserPlus, Loader2, Search, MoreVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import { jobsApi } from '@/api/jobs';
import { usersApi } from '@/api/users';
import client from '@/api/client';
import { useAuthStore } from '@/store/authStore';

const TABS = [
  { key: 'departments', label: 'Departments', icon: Building2 },
  { key: 'team',        label: 'Team',         icon: Users },
];

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  hr_manager: 'HR Manager',
  interviewer: 'Interviewer',
  employee: 'Employee',
  applicant: 'Applicant',
};

const ROLE_COLORS = {
  super_admin: 'bg-red-50 text-red-700',
  admin: 'bg-purple-50 text-purple-700',
  hr_manager: 'bg-brand-50 text-brand-700',
  interviewer: 'bg-blue-50 text-blue-700',
  employee: 'bg-green-50 text-green-700',
  applicant: 'bg-gray-100 text-gray-600',
};

const ASSIGNABLE_ROLES = ['admin', 'hr_manager', 'interviewer', 'employee'];

const deptSchema = z.object({ name: z.string().min(1, 'Required') });

const inviteSchema = z.object({
  full_name: z.string().min(2, 'Name required'),
  email: z.string().email('Valid email required'),
  role: z.string().min(1, 'Role required'),
  department: z.string().optional(),
  employee_id: z.string().optional(),
});

// ── Departments ──────────────────────────────────────────────────────────────

function InlineEditRow({ name, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);

  return editing ? (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="flex-1 text-sm border border-brand-400 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
        autoFocus
      />
      <button onClick={() => { onSave(val); setEditing(false); }} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg">
        <Check className="w-4 h-4" />
      </button>
      <button onClick={() => setEditing(false)} className="p-1.5 text-gray-400 hover:bg-surface-100 rounded-lg">
        <X className="w-4 h-4" />
      </button>
    </div>
  ) : (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-50 group">
      <span className="text-sm text-gray-900">{name}</span>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setEditing(true)} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function DepartmentsTab() {
  const qc = useQueryClient();
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(deptSchema) });

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: () => jobsApi.listDepartments().then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['departments'] });

  const createMut = useMutation({
    mutationFn: (name) => client.post('/jobs/departments', { name }),
    onSuccess: () => { toast.success('Department created'); reset(); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, name }) => client.put(`/jobs/departments/${id}`, { name }),
    onSuccess: () => { toast.success('Renamed'); invalidate(); },
    onError: () => toast.error('Failed to rename'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => client.delete(`/jobs/departments/${id}`),
    onSuccess: () => { toast.success('Deleted'); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Cannot delete — has jobs assigned'),
  });

  return (
    <div className="max-w-md">
      <p className="text-sm text-gray-500 mb-4">Manage departments used across jobs and reports.</p>

      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden mb-4">
        {isLoading ? (
          <div className="p-4 text-sm text-gray-400">Loading...</div>
        ) : departments.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">No departments yet.</div>
        ) : (
          <div className="divide-y divide-surface-100">
            {departments.map((d) => (
              <InlineEditRow
                key={d.id}
                name={d.name}
                onSave={(name) => updateMut.mutate({ id: d.id, name })}
                onDelete={() => deleteMut.mutate(d.id)}
              />
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit((data) => createMut.mutate(data.name))} className="flex gap-2">
        <div className="flex-1">
          <input
            {...register('name')}
            placeholder="New department name"
            className="w-full text-sm border border-surface-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
        </div>
        <button
          type="submit"
          disabled={createMut.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-xl hover:bg-brand-600 disabled:opacity-50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </form>
    </div>
  );
}

// ── Team ─────────────────────────────────────────────────────────────────────

function InviteModal({ onClose }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'employee' },
  });

  const inviteMut = useMutation({
    mutationFn: (data) => client.post('/users/invite', data),
    onSuccess: () => {
      toast.success('User invited');
      qc.invalidateQueries({ queryKey: ['team-users'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to invite'),
  });

  const onSubmit = (values) => {
    const payload = { ...values };
    if (!payload.department) delete payload.department;
    if (!payload.employee_id) delete payload.employee_id;
    inviteMut.mutate(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display font-bold text-gray-900">Invite Team Member</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input {...register('full_name')} className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Jane Smith" />
            {errors.full_name && <p className="mt-1 text-xs text-red-500">{errors.full_name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input {...register('email')} type="email" className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="jane@nablon.ai" />
            {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
            <select {...register('role')} className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white">
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <input {...register('department')} className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Engineering" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Employee ID</label>
              <input {...register('employee_id')} className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="EMP-001" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || inviteMut.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
            >
              {(isSubmitting || inviteMut.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Send Invite
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UserRow({ user, currentUserId }) {
  const qc = useQueryClient();
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['team-users'] });
  const isSelf = String(user.id) === String(currentUserId);

  const roleMut = useMutation({
    mutationFn: (role) => client.patch(`/users/${user.id}/role`, { role }),
    onSuccess: () => { toast.success('Role updated'); invalidate(); setShowRoleMenu(false); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed'),
  });

  const toggleMut = useMutation({
    mutationFn: () => client.patch(`/users/${user.id}/deactivate`),
    onSuccess: () => { toast.success(user.is_active ? 'User deactivated' : 'User reactivated'); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed'),
  });

  return (
    <tr className="hover:bg-surface-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
            <span className="text-brand-700 font-semibold text-sm">
              {user.full_name?.charAt(0)?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div>
            <p className="font-medium text-gray-900 text-sm">{user.full_name}</p>
            {user.employee_id && <p className="text-xs text-gray-400">{user.employee_id}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-gray-500 text-xs">{user.email}</td>
      <td className="px-4 py-3">
        <div className="relative inline-block">
          <button
            onClick={() => !isSelf && setShowRoleMenu((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] ?? 'bg-gray-100 text-gray-600'} ${isSelf ? 'cursor-default' : 'cursor-pointer hover:opacity-80'}`}
          >
            {ROLE_LABELS[user.role] ?? user.role}
            {!isSelf && <MoreVertical className="w-3 h-3 ml-0.5" />}
          </button>
          {showRoleMenu && !isSelf && (
            <div className="absolute top-full left-0 mt-1 z-10 bg-white border border-surface-200 rounded-xl shadow-lg py-1 min-w-[140px]">
              {ASSIGNABLE_ROLES.filter((r) => r !== user.role).map((r) => (
                <button
                  key={r}
                  onClick={() => roleMut.mutate(r)}
                  disabled={roleMut.isPending}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-surface-50 flex items-center gap-2"
                >
                  <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[r]}`}>
                    {ROLE_LABELS[r]}
                  </span>
                </button>
              ))}
              <button
                onClick={() => setShowRoleMenu(false)}
                className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-surface-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium ${user.is_active ? 'text-green-600' : 'text-gray-400'}`}>
          {user.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        {!isSelf && (
          <button
            onClick={() => toggleMut.mutate()}
            disabled={toggleMut.isPending}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              user.is_active
                ? 'border-red-200 text-red-600 hover:bg-red-50'
                : 'border-green-200 text-green-600 hover:bg-green-50'
            } disabled:opacity-50`}
          >
            {user.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
      </td>
    </tr>
  );
}

function TeamTab() {
  const { user: currentUser } = useAuthStore();
  const [showInvite, setShowInvite] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['team-users', roleFilter],
    queryFn: () => usersApi.list(roleFilter ? { role: roleFilter } : undefined).then((r) => r.data).catch(() => []),
  });

  const filtered = Array.isArray(data)
    ? data.filter((u) => !search || u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()))
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">All users with access to this portal.</p>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-xl hover:bg-brand-600 transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" /> Invite
        </button>
      </div>

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-surface-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-surface-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-gray-700"
        >
          <option value="">All Roles</option>
          {Object.entries(ROLE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-surface-100">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 px-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-surface-100 animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 bg-surface-100 rounded animate-pulse" />
                  <div className="h-3 w-48 bg-surface-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            {search ? 'No users match your search.' : 'No team members yet. Invite someone to get started.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {filtered.map((u) => (
                <UserRow key={u.id} user={u} currentUserId={currentUser?.id} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('departments');

  return (
    <div>
      <div className="flex gap-1 bg-surface-100 rounded-xl p-1 mb-6 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'departments' && <DepartmentsTab />}
      {activeTab === 'team'        && <TeamTab />}
    </div>
  );
}
