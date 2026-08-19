import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Plus, Search, Sparkles, X,
  Building2, Calendar, Loader2, UserCog, FolderKanban,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { resourcesApi } from '@/api/resources';
import SkillsInput from '@/components/shared/SkillsInput';
import {
  EMPLOYMENT_TYPES, BILLING_STATUSES, PROJECT_STATUSES, EXAMPLE_QUERIES,
  billingMeta, projectStatusMeta,
} from '@/constants/resourceConstants';

const inputCls =
  'w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500';

function StatTile({ label, value, tone = 'neutral', onClick, active }) {
  const tones = {
    neutral: 'bg-surface-50 text-gray-900',
    brand: 'bg-brand-50 text-brand-700',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl p-4 text-center transition-all ${tones[tone]} ${onClick ? 'cursor-pointer hover:brightness-95' : 'cursor-default'} ${active ? 'ring-2 ring-brand-500' : ''}`}
    >
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-1 opacity-70">{label}</p>
    </button>
  );
}

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

function AssociateCard({ profile, onClick }) {
  const billing = billingMeta(profile.billing_status);
  return (
    <div
      onClick={onClick}
      className="bg-white border border-surface-200 rounded-xl p-4 cursor-pointer hover:border-brand-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center flex-shrink-0 font-semibold text-sm overflow-hidden">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : initials(profile.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 text-sm truncate">{profile.full_name}</p>
          <p className="text-xs text-gray-500 truncate">{profile.designation || '—'}{profile.department ? ` · ${profile.department}` : ''}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${billing.badge}`}>
          {billing.label}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {profile.current_allocations.length === 0 ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Not allocated</span>
        ) : (
          profile.current_allocations.map((a) => (
            <span key={a.id} className="text-xs px-2 py-0.5 rounded-full bg-surface-100 text-gray-600">
              {a.project_name} · {a.allocation_percent}%
            </span>
          ))
        )}
      </div>

      {profile.skills?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {profile.skills.slice(0, 4).map((s) => (
            <span key={s} className="text-[11px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-600">{s}</span>
          ))}
          {profile.skills.length > 4 && <span className="text-[11px] text-gray-400">+{profile.skills.length - 4}</span>}
        </div>
      )}
    </div>
  );
}

function NLSearchBar({ onResult }) {
  const [query, setQuery] = useState('');

  const searchMutation = useMutation({
    mutationFn: (q) => resourcesApi.search(q).then((r) => r.data),
    onSuccess: (data) => onResult(data),
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Search failed'),
  });

  const run = (q) => {
    setQuery(q);
    searchMutation.mutate(q);
  };

  return (
    <div className="bg-white border border-surface-200 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-brand-500" />
        <p className="text-sm font-semibold text-gray-800">Ask about your resource pool</p>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) run(query); }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='e.g. "Show all associates who are not allocated"'
            className={`${inputCls} pl-9`}
          />
        </div>
        <button
          type="submit"
          disabled={searchMutation.isPending || !query.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60 transition-colors flex-shrink-0"
        >
          {searchMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Ask
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {EXAMPLE_QUERIES.map((q) => (
          <button
            key={q}
            onClick={() => run(q)}
            className="text-xs px-2.5 py-1 rounded-full bg-surface-100 text-gray-500 hover:bg-brand-50 hover:text-brand-600 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddAssociateModal({ onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    user_id: '', employee_code: '', designation: '', department: '',
    employment_type: 'full_time', billing_status: 'non_billable',
    date_of_joining: '', total_experience_years: '', location: '', bio: '',
  });
  const [skills, setSkills] = useState([]);

  const { data: onboardable, isLoading } = useQuery({
    queryKey: ['resources-onboardable'],
    queryFn: () => resourcesApi.onboardableUsers().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data) => resourcesApi.create(data),
    onSuccess: () => {
      toast.success('Associate added to resource pool');
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['resources-stats'] });
      queryClient.invalidateQueries({ queryKey: ['resources-onboardable'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to add associate'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.user_id) { toast.error('Select a person'); return; }
    createMutation.mutate({
      ...form,
      employee_code: form.employee_code || undefined,
      designation: form.designation || undefined,
      department: form.department || undefined,
      date_of_joining: form.date_of_joining || undefined,
      total_experience_years: form.total_experience_years ? parseFloat(form.total_experience_years) : undefined,
      location: form.location || undefined,
      bio: form.bio || undefined,
      skills,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg my-8 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">Add associate to resource pool</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Person *</label>
            <select
              value={form.user_id}
              onChange={(e) => setForm({ ...form, user_id: e.target.value })}
              className={inputCls}
              disabled={isLoading}
            >
              <option value="">
                {isLoading ? 'Loading…' : (onboardable?.length ? 'Select a person…' : 'No internal users left to onboard')}
              </option>
              {onboardable?.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name} · {u.email} ({u.role})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Employee code</label>
              <input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} placeholder="NAB-0142" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Designation</label>
              <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="Software Engineer II" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Engineering" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Bengaluru" className={inputCls} />
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
              <input type="date" value={form.date_of_joining} onChange={(e) => setForm({ ...form, date_of_joining: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Experience (years)</label>
              <input type="number" step="0.1" min="0" value={form.total_experience_years} onChange={(e) => setForm({ ...form, total_experience_years: e.target.value })} placeholder="3.5" className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Key skills</label>
            <SkillsInput value={skills} onChange={setSkills} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bio / notes</label>
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={2} className={inputCls} />
          </div>

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60 transition-colors"
          >
            {createMutation.isPending ? 'Adding…' : 'Add associate'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AddProjectModal({ onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', client_name: '', description: '', status: 'active', start_date: '', end_date: '' });

  const createMutation = useMutation({
    mutationFn: (data) => resourcesApi.projects.create(data),
    onSuccess: () => {
      toast.success('Project created');
      queryClient.invalidateQueries({ queryKey: ['resource-projects'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to create project'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Project name is required'); return; }
    createMutation.mutate({
      ...form,
      client_name: form.client_name || undefined,
      description: form.description || undefined,
      start_date: form.start_date || undefined,
      end_date: form.end_date || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-md my-8 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">Add project</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Project name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Core Banking Migration" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
            <input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} placeholder="Fortune 500 Bank" className={inputCls} />
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
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={inputCls} />
            </div>
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60 transition-colors"
          >
            {createMutation.isPending ? 'Creating…' : 'Create project'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ProjectCard({ project, onClick }) {
  const status = projectStatusMeta(project.status);
  return (
    <div onClick={onClick} className="bg-white border border-surface-200 rounded-xl p-4 cursor-pointer hover:border-brand-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{project.name}</p>
          {project.client_name && (
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5 truncate">
              <Building2 className="w-3 h-3" /> {project.client_name}
            </p>
          )}
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${status.badge}`}>{status.label}</span>
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {project.headcount} allocated</span>
        {project.start_date && (
          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {format(new Date(project.start_date), 'MMM yyyy')}</span>
        )}
      </div>
    </div>
  );
}

function AssociatesTab() {
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [filters, setFilters] = useState({ billing_status: '', employment_type: '', department: '', skill: '', unallocated: '' });

  const { data: stats } = useQuery({
    queryKey: ['resources-stats'],
    queryFn: () => resourcesApi.stats().then((r) => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['resource-projects'],
    queryFn: () => resourcesApi.projects.list().then((r) => r.data),
  });

  const activeFilters = useMemo(() => {
    const params = {};
    if (filters.billing_status) params.billing_status = filters.billing_status;
    if (filters.employment_type) params.employment_type = filters.employment_type;
    if (filters.department) params.department = filters.department;
    if (filters.skill) params.skill = filters.skill;
    if (filters.project_id) params.project_id = filters.project_id;
    if (filters.unallocated === 'true') params.unallocated = true;
    return params;
  }, [filters]);

  const { data: resources, isLoading } = useQuery({
    queryKey: ['resources', activeFilters],
    queryFn: () => resourcesApi.list(activeFilters).then((r) => r.data),
    enabled: !searchResult,
  });

  const setQuickFilter = (patch) => {
    setSearchResult(null);
    setFilters((f) => ({ ...f, ...patch }));
  };

  const displayList = searchResult ? searchResult.results : resources;

  return (
    <div>
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
          <StatTile label="Total associates" value={stats.total} onClick={() => setQuickFilter({ billing_status: '', employment_type: '', unallocated: '' })} />
          <StatTile label="Billable" value={stats.billable} tone="green" active={filters.billing_status === 'billable'} onClick={() => setQuickFilter({ billing_status: 'billable', unallocated: '' })} />
          <StatTile label="Bench" value={stats.bench} tone="amber" active={filters.billing_status === 'bench'} onClick={() => setQuickFilter({ billing_status: 'bench', unallocated: '' })} />
          <StatTile label="Training" value={stats.training} tone="blue" active={filters.billing_status === 'training'} onClick={() => setQuickFilter({ billing_status: 'training', unallocated: '' })} />
          <StatTile label="Interns" value={stats.interns} tone="brand" active={filters.employment_type === 'intern'} onClick={() => setQuickFilter({ employment_type: 'intern' })} />
          <StatTile label="Unallocated" value={stats.unallocated} tone="amber" active={filters.unallocated === 'true'} onClick={() => setQuickFilter({ unallocated: 'true', billing_status: '' })} />
        </div>
      )}

      <NLSearchBar onResult={setSearchResult} />

      {searchResult ? (
        <div className="flex items-center justify-between bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-brand-500 flex-shrink-0" />
            <p className="text-sm text-brand-800 truncate">
              {searchResult.summary}
              {!searchResult.is_ai_interpreted && <span className="text-brand-400"> (keyword match)</span>}
            </p>
          </div>
          <button onClick={() => setSearchResult(null)} className="text-xs font-semibold text-brand-600 hover:text-brand-800 flex-shrink-0 ml-3">
            Clear
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select value={filters.billing_status} onChange={(e) => setFilters({ ...filters, billing_status: e.target.value })} className={`${inputCls} w-auto`}>
            <option value="">All billing statuses</option>
            {BILLING_STATUSES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          <select value={filters.employment_type} onChange={(e) => setFilters({ ...filters, employment_type: e.target.value })} className={`${inputCls} w-auto`}>
            <option value="">All employment types</option>
            {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={filters.project_id ?? ''} onChange={(e) => setFilters({ ...filters, project_id: e.target.value })} className={`${inputCls} w-auto`}>
            <option value="">All projects</option>
            {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })} placeholder="Department" className={`${inputCls} w-36`} />
          <input value={filters.skill} onChange={(e) => setFilters({ ...filters, skill: e.target.value })} placeholder="Skill" className={`${inputCls} w-32`} />
          <label className="flex items-center gap-1.5 text-xs text-gray-600 px-2">
            <input type="checkbox" checked={filters.unallocated === 'true'} onChange={(e) => setFilters({ ...filters, unallocated: e.target.checked ? 'true' : '' })} />
            Unallocated only
          </label>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">{displayList?.length ?? 0} associate{displayList?.length === 1 ? '' : 's'}</p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add associate
        </button>
      </div>

      {isLoading && !searchResult ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-32 bg-surface-100 rounded-xl animate-pulse" />)}
        </div>
      ) : displayList?.length === 0 ? (
        <div className="text-center py-20 text-gray-400 bg-white border border-surface-200 rounded-xl">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No associates match this view.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayList?.map((p) => (
            <AssociateCard key={p.id} profile={p} onClick={() => navigate(`/hr/resources/${p.id}`)} />
          ))}
        </div>
      )}

      {showAdd && <AddAssociateModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function ProjectsTab() {
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['resource-projects'],
    queryFn: () => resourcesApi.projects.list().then((r) => r.data),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{projects?.length ?? 0} project{projects?.length === 1 ? '' : 's'}</p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add project
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-surface-100 rounded-xl animate-pulse" />)}
        </div>
      ) : projects?.length === 0 ? (
        <div className="text-center py-20 text-gray-400 bg-white border border-surface-200 rounded-xl">
          <FolderKanban className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No projects yet. Add one to start allocating associates.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects?.map((p) => (
            <ProjectCard key={p.id} project={p} onClick={() => navigate(`/hr/resources/projects/${p.id}`)} />
          ))}
        </div>
      )}

      {showAdd && <AddProjectModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

export default function ResourcesPage() {
  const [tab, setTab] = useState('associates');

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">Resource Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track associates, project allocation, and billing status across the bench</p>
        </div>
        <div className="flex bg-surface-100 rounded-lg p-1">
          <button
            onClick={() => setTab('associates')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'associates' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            <UserCog className="w-4 h-4" /> Associates
          </button>
          <button
            onClick={() => setTab('projects')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'projects' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            <FolderKanban className="w-4 h-4" /> Projects
          </button>
        </div>
      </div>

      {tab === 'associates' ? <AssociatesTab /> : <ProjectsTab />}
    </div>
  );
}
