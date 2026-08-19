import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Pencil, X, Upload, FileText, MapPin, Calendar, Briefcase,
  Award, Plus, Loader2, ExternalLink, Ban,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { resourcesApi } from '@/api/resources';
import SkillsInput from '@/components/shared/SkillsInput';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { EMPLOYMENT_TYPES, BILLING_STATUSES, billingMeta, labelFor } from '@/constants/resourceConstants';

const inputCls =
  'w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500';

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

function EditProfileModal({ profile, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    employee_code: profile.employee_code ?? '',
    designation: profile.designation ?? '',
    department: profile.department ?? '',
    employment_type: profile.employment_type,
    billing_status: profile.billing_status,
    date_of_joining: profile.date_of_joining ?? '',
    total_experience_years: profile.total_experience_years ?? '',
    location: profile.location ?? '',
    bio: profile.bio ?? '',
  });
  const [skills, setSkills] = useState(profile.skills ?? []);

  const updateMutation = useMutation({
    mutationFn: (data) => resourcesApi.update(profile.id, data),
    onSuccess: () => {
      toast.success('Profile updated');
      queryClient.invalidateQueries({ queryKey: ['resource', profile.id] });
      queryClient.invalidateQueries({ queryKey: ['resources-stats'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to update'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    updateMutation.mutate({
      ...form,
      employee_code: form.employee_code || null,
      designation: form.designation || null,
      department: form.department || null,
      date_of_joining: form.date_of_joining || null,
      total_experience_years: form.total_experience_years ? parseFloat(form.total_experience_years) : null,
      location: form.location || null,
      bio: form.bio || null,
      skills,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg my-8 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">Edit profile</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Employee code</label>
              <input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Designation</label>
              <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Employment type</label>
              <select value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })} className={inputCls}>
                {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Billing status</label>
              <select value={form.billing_status} onChange={(e) => setForm({ ...form, billing_status: e.target.value })} className={inputCls}>
                {BILLING_STATUSES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date of joining</label>
              <input type="date" value={form.date_of_joining ?? ''} onChange={(e) => setForm({ ...form, date_of_joining: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Experience (years)</label>
              <input type="number" step="0.1" min="0" value={form.total_experience_years ?? ''} onChange={(e) => setForm({ ...form, total_experience_years: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Key skills</label>
            <SkillsInput value={skills} onChange={setSkills} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bio / notes</label>
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3} className={inputCls} />
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

function AddAllocationModal({ profile, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ project_id: '', allocation_percent: 100, role_on_project: '', start_date: '' });

  const { data: projects } = useQuery({
    queryKey: ['resource-projects'],
    queryFn: () => resourcesApi.projects.list({ status: 'active' }).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data) => resourcesApi.allocations.create(profile.id, data),
    onSuccess: () => {
      toast.success('Allocation added');
      queryClient.invalidateQueries({ queryKey: ['resource', profile.id] });
      queryClient.invalidateQueries({ queryKey: ['resources-stats'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to allocate'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.project_id) { toast.error('Select a project'); return; }
    createMutation.mutate({
      ...form,
      allocation_percent: parseInt(form.allocation_percent, 10) || 100,
      role_on_project: form.role_on_project || undefined,
      start_date: form.start_date || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-md my-8 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">Allocate to a project</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Currently allocated {profile.total_allocated_percent}%. Adding an allocation that pushes this past 100% will be rejected.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Project *</label>
            <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className={inputCls}>
              <option value="">Select a project…</option>
              {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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

function AllocationRow({ allocation, onEnd, ending }) {
  const [pendingEnd, setPendingEnd] = useState(false);
  return (
    <div className="flex items-center justify-between bg-surface-50 rounded-lg px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{allocation.project_name}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {allocation.role_on_project ? `${allocation.role_on_project} · ` : ''}
          {allocation.start_date ? format(new Date(allocation.start_date), 'MMM d, yyyy') : 'No start date'}
          {allocation.end_date ? ` – ${format(new Date(allocation.end_date), 'MMM d, yyyy')}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-sm font-bold text-brand-600">{allocation.allocation_percent}%</span>
        {!allocation.end_date && (
          <button onClick={() => setPendingEnd(true)} className="text-gray-400 hover:text-red-500" title="End allocation">
            <Ban className="w-4 h-4" />
          </button>
        )}
      </div>
      {pendingEnd && (
        <ConfirmDialog
          title="End this allocation?"
          message={`${allocation.project_name} will be freed up from this associate's current allocation, starting today.`}
          confirmLabel="End allocation"
          danger
          isPending={ending}
          onCancel={() => setPendingEnd(false)}
          onConfirm={() => { onEnd(allocation.id); setPendingEnd(false); }}
        />
      )}
    </div>
  );
}

export default function ResourceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [showAllocate, setShowAllocate] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['resource', id],
    queryFn: () => resourcesApi.get(id).then((r) => r.data),
  });

  const uploadResumeMutation = useMutation({
    mutationFn: (file) => resourcesApi.uploadResume(id, file),
    onSuccess: () => {
      toast.success('Resume uploaded');
      queryClient.invalidateQueries({ queryKey: ['resource', id] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Upload failed'),
  });

  const endAllocationMutation = useMutation({
    mutationFn: (allocationId) => resourcesApi.allocations.end(allocationId),
    onSuccess: () => {
      toast.success('Allocation ended');
      queryClient.invalidateQueries({ queryKey: ['resource', id] });
      queryClient.invalidateQueries({ queryKey: ['resources-stats'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to end allocation'),
  });

  if (isLoading || !profile) {
    return <div className="h-64 bg-surface-100 rounded-xl animate-pulse" />;
  }

  const billing = billingMeta(profile.billing_status);

  return (
    <div>
      <button onClick={() => navigate('/hr/resources')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Resource Management
      </button>

      <div className="bg-white border border-surface-200 rounded-xl p-5 sm:p-6 mb-6">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-14 h-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-lg flex-shrink-0 overflow-hidden">
              {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : initials(profile.full_name)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-lg font-bold text-gray-900">{profile.full_name}</h1>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${billing.badge}`}>{billing.label}</span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{profile.designation || '—'}{profile.department ? ` · ${profile.department}` : ''}</p>
              <p className="text-xs text-gray-400 mt-1">{profile.email}</p>
            </div>
          </div>
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-surface-100">
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1"><Briefcase className="w-3 h-3" /> Employment</p>
            <p className="text-sm font-medium text-gray-800 mt-0.5">{labelFor(EMPLOYMENT_TYPES, profile.employment_type)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" /> Joined</p>
            <p className="text-sm font-medium text-gray-800 mt-0.5">{profile.date_of_joining ? format(new Date(profile.date_of_joining), 'MMM d, yyyy') : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1"><Award className="w-3 h-3" /> Experience</p>
            <p className="text-sm font-medium text-gray-800 mt-0.5">{profile.total_experience_years != null ? `${profile.total_experience_years} yrs` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</p>
            <p className="text-sm font-medium text-gray-800 mt-0.5">{profile.location || '—'}</p>
          </div>
        </div>

        {profile.skills?.length > 0 && (
          <div className="mt-5 pt-5 border-t border-surface-100">
            <p className="text-xs text-gray-400 mb-2">Key skills</p>
            <div className="flex flex-wrap gap-1.5">
              {profile.skills.map((s) => (
                <span key={s} className="text-xs px-2.5 py-1 rounded-full bg-brand-50 text-brand-700">{s}</span>
              ))}
            </div>
          </div>
        )}

        {profile.bio && (
          <div className="mt-5 pt-5 border-t border-surface-100">
            <p className="text-xs text-gray-400 mb-1">Bio</p>
            <p className="text-sm text-gray-700 whitespace-pre-line">{profile.bio}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-surface-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Resume</h2>
          {profile.resume_url ? (
            <a
              href={profile.resume_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-800 mb-4"
            >
              <FileText className="w-4 h-4" /> {profile.resume_name || 'View resume'} <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <p className="text-sm text-gray-400 mb-4">No resume uploaded yet.</p>
          )}
          <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-600 border border-surface-200 rounded-lg hover:bg-surface-50 cursor-pointer">
            {uploadResumeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {profile.resume_url ? 'Replace resume' : 'Upload resume'}
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadResumeMutation.mutate(e.target.files[0])}
            />
          </label>
        </div>

        <div className="bg-white border border-surface-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">Current allocations ({profile.total_allocated_percent}%)</h2>
            <button
              onClick={() => setShowAllocate(true)}
              className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-800"
            >
              <Plus className="w-3.5 h-3.5" /> Allocate
            </button>
          </div>
          {profile.current_allocations.length === 0 ? (
            <p className="text-sm text-gray-400">Not currently allocated to any project — on the bench.</p>
          ) : (
            <div className="space-y-2">
              {profile.current_allocations.map((a) => (
                <AllocationRow
                  key={a.id}
                  allocation={a}
                  onEnd={endAllocationMutation.mutate}
                  ending={endAllocationMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showEdit && <EditProfileModal profile={profile} onClose={() => setShowEdit(false)} />}
      {showAllocate && <AddAllocationModal profile={profile} onClose={() => setShowAllocate(false)} />}
    </div>
  );
}
