import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Plus, Copy, ChevronDown, ChevronRight, Trash2, Users,
  X, Mail, TrendingUp, Link2,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { agenciesApi } from '@/api/agencies';
import { jobsApi } from '@/api/jobs';
import { reportsApi } from '@/api/reports';

const inputCls =
  'w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500';

function StatTile({ label, value, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-surface-50 text-gray-900',
    brand: 'bg-brand-50 text-brand-700',
    green: 'bg-green-50 text-green-700',
  };
  return (
    <div className={`rounded-xl p-4 text-center ${tones[tone]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-1 opacity-70">{label}</p>
    </div>
  );
}

function CopyButton({ text, label, iconOnly = false }) {
  const [copied, setCopied] = useState(false);
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      title={label}
      className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-600 font-medium transition-colors"
    >
      <Copy className="w-3.5 h-3.5" />
      {!iconOnly && (copied ? 'Copied!' : label)}
    </button>
  );
}

function PerformanceStats({ perf }) {
  if (!perf || perf.total_submitted === 0) {
    return <p className="text-xs text-gray-400">No candidates submitted in the last 12 months</p>;
  }
  const items = [
    { label: 'Submitted', value: perf.total_submitted, cls: 'text-gray-900' },
    { label: 'In progress', value: perf.in_progress, cls: 'text-amber-600' },
    { label: 'Hired', value: perf.hired, cls: 'text-green-600' },
    { label: 'Rejected', value: perf.rejected, cls: 'text-red-400' },
  ];
  return (
    <div className="flex items-center gap-5 flex-wrap">
      {items.map((it, i) => (
        <div key={it.label} className={`flex items-baseline gap-1.5 ${i > 0 ? 'pl-5 border-l border-surface-200' : ''}`}>
          <span className={`text-sm font-bold ${it.cls}`}>{it.value}</span>
          <span className="text-xs text-gray-400">{it.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1 pl-5 border-l border-surface-200">
        <TrendingUp className="w-3.5 h-3.5 text-brand-500" />
        <span className="text-sm font-bold text-brand-600">{perf.conversion_rate}%</span>
        <span className="text-xs text-gray-400">conversion</span>
      </div>
    </div>
  );
}

function AssignmentCard({ assignment, onRemove, removing }) {
  const jobLink = `${window.location.origin}/jobs/${assignment.job_id}?ref=${assignment.ref_token}`;
  return (
    <div className="bg-white border border-surface-200 rounded-lg px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{assignment.job_title}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs px-2 py-0.5 rounded-full bg-surface-100 text-gray-500">
              {assignment.max_submissions ? `Max ${assignment.max_submissions}` : 'Unlimited'}
            </span>
            {assignment.expires_at && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-100 text-gray-500">
                Expires {format(new Date(assignment.expires_at), 'MMM d, yyyy')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <CopyButton text={jobLink} label="Copy link" />
          <button
            onClick={() => onRemove(assignment.id)}
            disabled={removing}
            className="text-gray-300 hover:text-red-400 transition-colors"
            title="Remove assignment"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AgencyCard({ agency, perf, jobs }) {
  const [expanded, setExpanded] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedJob, setSelectedJob] = useState('');
  const [maxSubs, setMaxSubs] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const queryClient = useQueryClient();

  const { data: assignments, refetch: refetchAssignments } = useQuery({
    queryKey: ['agency-assignments', agency.id],
    queryFn: () => agenciesApi.listAgencyAssignments(agency.id).then((r) => r.data),
    enabled: expanded,
  });

  const assignMutation = useMutation({
    mutationFn: (data) => agenciesApi.assignToJob(selectedJob, data),
    onSuccess: () => {
      toast.success('Agency assigned to job');
      setShowAssign(false);
      setSelectedJob('');
      setMaxSubs('');
      setExpiresAt('');
      refetchAssignments();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to assign'),
  });

  const removeMutation = useMutation({
    mutationFn: (assignmentId) => agenciesApi.removeAssignment(assignmentId),
    onSuccess: () => {
      toast.success('Assignment removed');
      refetchAssignments();
    },
    onError: () => toast.error('Failed to remove assignment'),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => agenciesApi.update(agency.id, { is_active: !agency.is_active }),
    onSuccess: () => {
      toast.success(agency.is_active ? 'Agency deactivated' : 'Agency activated');
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
    },
    onError: () => toast.error('Failed to update agency'),
  });

  const portalUrl = `${window.location.origin}/agency/${agency.portal_token}`;
  const assignedJobIds = new Set((assignments ?? []).map((a) => a.job_id));
  const availableJobs = (jobs ?? []).filter((j) => !assignedJobIds.has(j.id) && j.status === 'published');

  const handleAssign = () => {
    if (!selectedJob) { toast.error('Select a job'); return; }
    assignMutation.mutate({
      agency_id: agency.id,
      max_submissions: maxSubs ? parseInt(maxSubs) : undefined,
      expires_at: expiresAt || undefined,
    });
  };

  return (
    <div className="bg-white border border-surface-200 rounded-xl overflow-hidden hover:border-surface-300 transition-colors">
      <div
        className="flex items-start gap-4 px-5 py-4 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            agency.is_active ? 'bg-brand-100' : 'bg-surface-100'
          }`}
        >
          <Building2 className={`w-5 h-5 ${agency.is_active ? 'text-brand-600' : 'text-gray-400'}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 text-sm">{agency.name}</p>
            {!agency.is_active && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">Inactive</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5">
            <Mail className="w-3 h-3" />
            {agency.contact_name ? `${agency.contact_name} · ${agency.contact_email}` : agency.contact_email}
          </div>

          <div className="mt-3">
            <PerformanceStats perf={perf} />
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0 pt-1" onClick={(e) => e.stopPropagation()}>
          <CopyButton text={portalUrl} label="Portal link" />
          <button
            onClick={() => deactivateMutation.mutate()}
            className="text-xs text-gray-400 hover:text-gray-700 font-medium whitespace-nowrap"
          >
            {agency.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={() => setExpanded((e) => !e)} className="text-gray-300 hover:text-gray-500">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-surface-200 px-5 py-4 bg-surface-50 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-gray-400" />
              Job assignments
            </p>
            <button
              onClick={() => setShowAssign((s) => !s)}
              className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-800"
            >
              <Plus className="w-3.5 h-3.5" />
              Assign to job
            </button>
          </div>

          {showAssign && (
            <div className="bg-white border border-surface-200 rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Job</label>
                <select
                  value={selectedJob}
                  onChange={(e) => setSelectedJob(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select a published job…</option>
                  {availableJobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.title}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max submissions (optional)</label>
                  <input
                    type="number"
                    min="1"
                    value={maxSubs}
                    onChange={(e) => setMaxSubs(e.target.value)}
                    placeholder="Unlimited"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expires at (optional)</label>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAssign}
                  disabled={assignMutation.isPending}
                  className="px-4 py-2 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60 transition-colors"
                >
                  {assignMutation.isPending ? 'Assigning…' : 'Assign'}
                </button>
                <button
                  onClick={() => setShowAssign(false)}
                  className="px-4 py-2 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {assignments && assignments.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No jobs assigned yet</p>
          )}

          <div className="space-y-2">
            {assignments?.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                onRemove={removeMutation.mutate}
                removing={removeMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateAgencyModal({ onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', contact_name: '', contact_email: '' });

  const createMutation = useMutation({
    mutationFn: (data) => agenciesApi.create(data),
    onSuccess: () => {
      toast.success('Agency created');
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to create agency'),
  });

  const handleCreate = (e) => {
    e.preventDefault();
    if (!form.name || !form.contact_email) { toast.error('Name and contact email are required'); return; }
    createMutation.mutate(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-md my-8 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">Add recruiting agency</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Agency name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ABC Staffing"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contact name</label>
            <input
              value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
              placeholder="John Smith"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contact email *</label>
            <input
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
              placeholder="john@abcstaffing.com"
              className={inputCls}
            />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60 transition-colors"
          >
            {createMutation.isPending ? 'Creating…' : 'Create agency'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AgenciesPage() {
  const [showCreate, setShowCreate] = useState(false);

  const { data: agencies, isLoading } = useQuery({
    queryKey: ['agencies'],
    queryFn: () => agenciesApi.list().then((r) => r.data),
  });

  const { data: jobsData } = useQuery({
    queryKey: ['jobs-hr'],
    queryFn: () => jobsApi.list({ status: 'published', limit: 100 }).then((r) => r.data.items),
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

  const sortedAgencies = useMemo(() => {
    if (!agencies) return [];
    return [...agencies].sort((a, b) => {
      const subA = perfByAgency[a.id]?.total_submitted ?? 0;
      const subB = perfByAgency[b.id]?.total_submitted ?? 0;
      if (subB !== subA) return subB - subA;
      return a.name.localeCompare(b.name);
    });
  }, [agencies, perfByAgency]);

  const kpis = useMemo(() => {
    const totalSubmitted = (performance ?? []).reduce((s, p) => s + p.total_submitted, 0);
    const totalHired = (performance ?? []).reduce((s, p) => s + p.hired, 0);
    return {
      total: agencies?.length ?? 0,
      active: agencies?.filter((a) => a.is_active).length ?? 0,
      submitted: totalSubmitted,
      hired: totalHired,
    };
  }, [agencies, performance]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">Recruiting Agencies</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage agencies, track performance, and generate trackable job links</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add agency
        </button>
      </div>

      {!isLoading && agencies?.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatTile label="Agencies" value={kpis.total} />
          <StatTile label="Active" value={kpis.active} />
          <StatTile label="Submitted (12mo)" value={kpis.submitted} tone="brand" />
          <StatTile label="Hired (12mo)" value={kpis.hired} tone="green" />
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-surface-100 rounded-xl animate-pulse" />)}
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-surface-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && agencies?.length === 0 && (
        <div className="text-center py-20 text-gray-400 bg-white border border-surface-200 rounded-xl">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No agencies yet. Add one to start tracking sourced candidates.</p>
        </div>
      )}

      <div className="space-y-3">
        {sortedAgencies.map((agency) => (
          <AgencyCard key={agency.id} agency={agency} perf={perfByAgency[agency.id]} jobs={jobsData} />
        ))}
      </div>

      {showCreate && <CreateAgencyModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
