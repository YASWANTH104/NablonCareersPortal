import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, X, Plus, Building2, Calendar, Users, Ban } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { resourcesApi } from '@/api/resources';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { PROJECT_STATUSES, projectStatusMeta } from '@/constants/resourceConstants';

const inputCls =
  'w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500';

function EditProjectModal({ project, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: project.name, client_name: project.client_name ?? '', description: project.description ?? '',
    status: project.status, start_date: project.start_date ?? '', end_date: project.end_date ?? '',
  });

  const updateMutation = useMutation({
    mutationFn: (data) => resourcesApi.projects.update(project.id, data),
    onSuccess: () => {
      toast.success('Project updated');
      queryClient.invalidateQueries({ queryKey: ['resource-project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['resource-projects'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to update'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    updateMutation.mutate({
      ...form,
      client_name: form.client_name || null,
      description: form.description || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-md my-8 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">Edit project</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Project name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
            <input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={inputCls} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
              <input type="date" value={form.start_date ?? ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
              <input type="date" value={form.end_date ?? ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={inputCls} />
            </div>
          </div>
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="w-full px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60 transition-colors"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AllocateAssociateModal({ projectId, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ employee_profile_id: '', allocation_percent: 100, role_on_project: '', start_date: '' });

  const { data: associates } = useQuery({
    queryKey: ['resources', {}],
    queryFn: () => resourcesApi.list().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: ({ employee_profile_id, ...data }) => resourcesApi.allocations.create(employee_profile_id, data),
    onSuccess: () => {
      toast.success('Associate allocated');
      queryClient.invalidateQueries({ queryKey: ['resource-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['resources-stats'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to allocate'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.employee_profile_id) { toast.error('Select an associate'); return; }
    createMutation.mutate({
      ...form,
      project_id: projectId,
      allocation_percent: parseInt(form.allocation_percent, 10) || 100,
      role_on_project: form.role_on_project || undefined,
      start_date: form.start_date || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-md my-8 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">Allocate an associate</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Associate *</label>
            <select value={form.employee_profile_id} onChange={(e) => setForm({ ...form, employee_profile_id: e.target.value })} className={inputCls}>
              <option value="">Select an associate…</option>
              {associates?.map((a) => (
                <option key={a.id} value={a.id}>{a.full_name} · {a.total_allocated_percent}% allocated</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Allocation %</label>
              <input type="number" min="1" max="100" value={form.allocation_percent} onChange={(e) => setForm({ ...form, allocation_percent: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role on project</label>
              <input value={form.role_on_project} onChange={(e) => setForm({ ...form, role_on_project: e.target.value })} placeholder="Backend Engineer" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Start date</label>
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60 transition-colors"
          >
            {createMutation.isPending ? 'Allocating…' : 'Allocate'}
          </button>
        </form>
      </div>
    </div>
  );
}

function RosterRow({ member, onEnd, ending }) {
  const [pendingEnd, setPendingEnd] = useState(false);
  const isCurrent = !member.end_date;
  return (
    <tr className={isCurrent ? '' : 'opacity-50'}>
      <td className="px-4 py-3">
        <Link to={`/hr/resources/${member.employee_profile_id}`} className="text-sm font-medium text-gray-800 hover:text-brand-600">
          {member.full_name}
        </Link>
        <p className="text-xs text-gray-400">{member.designation || '—'}</p>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{member.role_on_project || '—'}</td>
      <td className="px-4 py-3 text-sm font-semibold text-brand-600">{member.allocation_percent}%</td>
      <td className="px-4 py-3 text-xs text-gray-500">
        {member.start_date ? format(new Date(member.start_date), 'MMM d, yyyy') : '—'}
        {member.end_date ? ` – ${format(new Date(member.end_date), 'MMM d, yyyy')}` : ''}
      </td>
      <td className="px-4 py-3 text-right">
        {isCurrent && (
          <button onClick={() => setPendingEnd(true)} className="text-gray-400 hover:text-red-500" title="End allocation">
            <Ban className="w-4 h-4" />
          </button>
        )}
        {pendingEnd && (
          <ConfirmDialog
            title="End this allocation?"
            message={`${member.full_name} will be freed up from this project, starting today.`}
            confirmLabel="End allocation"
            danger
            isPending={ending}
            onCancel={() => setPendingEnd(false)}
            onConfirm={() => { onEnd(member.allocation_id); setPendingEnd(false); }}
          />
        )}
      </td>
    </tr>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [showAllocate, setShowAllocate] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ['resource-project', id],
    queryFn: () => resourcesApi.projects.get(id).then((r) => r.data),
  });

  const endAllocationMutation = useMutation({
    mutationFn: (allocationId) => resourcesApi.allocations.end(allocationId),
    onSuccess: () => {
      toast.success('Allocation ended');
      queryClient.invalidateQueries({ queryKey: ['resource-project', id] });
      queryClient.invalidateQueries({ queryKey: ['resources-stats'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to end allocation'),
  });

  if (isLoading || !project) {
    return <div className="h-64 bg-surface-100 rounded-xl animate-pulse" />;
  }

  const status = projectStatusMeta(project.status);
  const current = project.roster.filter((m) => !m.end_date);
  const past = project.roster.filter((m) => m.end_date);

  return (
    <div>
      <button onClick={() => navigate('/hr/resources')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Resource Management
      </button>

      <div className="bg-white border border-surface-200 rounded-xl p-5 sm:p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-lg font-bold text-gray-900">{project.name}</h1>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.badge}`}>{status.label}</span>
            </div>
            {project.client_name && (
              <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                <Building2 className="w-3.5 h-3.5" /> {project.client_name}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        </div>

        {project.description && <p className="text-sm text-gray-600 mt-4">{project.description}</p>}

        <div className="flex items-center gap-5 mt-4 pt-4 border-t border-surface-100 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {project.headcount} currently allocated</span>
          {project.start_date && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Start {format(new Date(project.start_date), 'MMM d, yyyy')}</span>}
          {project.end_date && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> End {format(new Date(project.end_date), 'MMM d, yyyy')}</span>}
        </div>
      </div>

      <div className="bg-white border border-surface-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-900">Roster</h2>
          <button
            onClick={() => setShowAllocate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Allocate associate
          </button>
        </div>

        {project.roster.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No one allocated to this project yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-surface-100">
                  <th className="px-4 py-2 font-medium">Associate</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Allocation</th>
                  <th className="px-4 py-2 font-medium">Dates</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {current.map((m) => <RosterRow key={m.allocation_id} member={m} onEnd={endAllocationMutation.mutate} ending={endAllocationMutation.isPending} />)}
                {past.map((m) => <RosterRow key={m.allocation_id} member={m} onEnd={endAllocationMutation.mutate} ending={endAllocationMutation.isPending} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showEdit && <EditProjectModal project={project} onClose={() => setShowEdit(false)} />}
      {showAllocate && <AllocateAssociateModal projectId={id} onClose={() => setShowAllocate(false)} />}
    </div>
  );
}
