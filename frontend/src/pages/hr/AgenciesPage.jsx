import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Copy, ChevronDown, ChevronRight, Trash2, Link2, Users } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { agenciesApi } from '@/api/agencies';
import { jobsApi } from '@/api/jobs';

function StageBadge({ stage }) {
  const colors = {
    applied: 'bg-blue-100 text-blue-700',
    screening: 'bg-purple-100 text-purple-700',
    assessment: 'bg-orange-100 text-orange-700',
    tr1: 'bg-indigo-100 text-indigo-700',
    tr2: 'bg-indigo-100 text-indigo-700',
    hr: 'bg-violet-100 text-violet-700',
    offer: 'bg-emerald-100 text-emerald-700',
    hired: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
  };
  const label = {
    tr1: 'TR1', tr2: 'TR2', hr: 'HR',
  }[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[stage] ?? 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium"
    >
      <Copy className="w-3 h-3" />
      {copied ? 'Copied!' : label}
    </button>
  );
}

function AgencyRow({ agency, jobs }) {
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
    <div className="border border-surface-200 rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-surface-50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
          <Building2 className="w-4 h-4 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-900 text-sm">{agency.name}</p>
            {!agency.is_active && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
            )}
          </div>
          <p className="text-xs text-gray-500">{agency.contact_name ? `${agency.contact_name} · ` : ''}{agency.contact_email}</p>
        </div>
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <CopyButton text={portalUrl} label="Copy portal link" />
          <button
            onClick={() => deactivateMutation.mutate()}
            className="text-xs text-gray-400 hover:text-gray-700"
          >
            {agency.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </div>

      {expanded && (
        <div className="border-t border-surface-200 px-5 py-4 bg-surface-50 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Job Assignments</p>
            <button
              onClick={() => setShowAssign((s) => !s)}
              className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-800"
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
                  className="w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
                    className="w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expires at (optional)</label>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAssign}
                  disabled={assignMutation.isPending}
                  className="px-4 py-2 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60"
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

          {assignments && assignments.map((a) => {
            const jobLink = `${window.location.origin}/jobs/${a.job_id}?ref=${a.ref_token}`;
            return (
              <div key={a.id} className="bg-white border border-surface-200 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{a.job_title}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-400">
                        {a.max_submissions ? `Max ${a.max_submissions} submissions` : 'Unlimited submissions'}
                      </span>
                      {a.expires_at && (
                        <span className="text-xs text-gray-400">
                          Expires {format(new Date(a.expires_at), 'MMM d, yyyy')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <CopyButton text={jobLink} label="Copy link" />
                    <button
                      onClick={() => removeMutation.mutate(a.id)}
                      disabled={removeMutation.isPending}
                      className="text-gray-300 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AgenciesPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', contact_name: '', contact_email: '' });

  const { data: agencies, isLoading } = useQuery({
    queryKey: ['agencies'],
    queryFn: () => agenciesApi.list().then((r) => r.data),
  });

  const { data: jobsData } = useQuery({
    queryKey: ['jobs-hr'],
    queryFn: () => jobsApi.list({ status: 'published', limit: 100 }).then((r) => r.data.items),
  });

  const createMutation = useMutation({
    mutationFn: (data) => agenciesApi.create(data),
    onSuccess: () => {
      toast.success('Agency created');
      setShowCreate(false);
      setForm({ name: '', contact_name: '', contact_email: '' });
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to create agency'),
  });

  const handleCreate = (e) => {
    e.preventDefault();
    if (!form.name || !form.contact_email) { toast.error('Name and contact email are required'); return; }
    createMutation.mutate(form);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Recruiting Agencies</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage agencies and generate trackable job links</p>
        </div>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Agency
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-surface-200 rounded-xl p-5 mb-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">New Agency</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Agency name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ABC Staffing"
                className="w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contact name</label>
              <input
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                placeholder="John Smith"
                className="w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contact email *</label>
              <input
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                placeholder="john@abcstaffing.com"
                className="w-full text-sm border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Agency'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && agencies?.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No agencies yet. Add one to start tracking sourced candidates.</p>
        </div>
      )}

      <div className="space-y-3">
        {agencies?.map((agency) => (
          <AgencyRow key={agency.id} agency={agency} jobs={jobsData} />
        ))}
      </div>
    </div>
  );
}
