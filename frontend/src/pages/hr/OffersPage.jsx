import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { FileText, Send, CheckCircle, XCircle, RotateCcw, Clock, AlertCircle, Plus, Settings, Trash2, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useForm } from 'react-hook-form';
import { offersApi } from '@/api/offers';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_CONFIG = {
  draft:    { icon: Clock,         color: 'bg-gray-100 text-gray-600',    dot: 'bg-gray-400' },
  sent:     { icon: Send,          color: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500' },
  accepted: { icon: CheckCircle,   color: 'bg-green-100 text-green-700',  dot: 'bg-green-500' },
  rejected: { icon: XCircle,       color: 'bg-red-100 text-red-700',      dot: 'bg-red-500' },
  revoked:  { icon: RotateCcw,     color: 'bg-orange-100 text-orange-700',dot: 'bg-orange-400' },
  expired:  { icon: AlertCircle,   color: 'bg-yellow-100 text-yellow-700',dot: 'bg-yellow-400' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? { color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium capitalize ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  );
}

// ── Template Manager Modal ────────────────────────────────────────────────────

function TemplateModal({ onClose }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | template object
  const { register, handleSubmit, reset, setValue } = useForm();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['offer-templates'],
    queryFn: () => offersApi.listTemplates().then((r) => r.data),
  });

  const createMut = useMutation({
    mutationFn: (data) => offersApi.createTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offer-templates'] });
      toast.success('Template created');
      setEditing(null);
      reset();
    },
    onError: () => toast.error('Failed to save template'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => offersApi.updateTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offer-templates'] });
      toast.success('Template updated');
      setEditing(null);
      reset();
    },
    onError: () => toast.error('Failed to update template'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => offersApi.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offer-templates'] });
      toast.success('Template deleted');
    },
    onError: () => toast.error('Failed to delete template'),
  });

  function startEdit(template) {
    setEditing(template);
    setValue('name', template.name);
    setValue('body_html', template.body_html);
    setValue('is_default', template.is_default);
  }

  function startNew() {
    setEditing('new');
    reset({ name: '', body_html: DEFAULT_TEMPLATE_HTML, is_default: false });
  }

  function onSubmit(data) {
    if (editing === 'new') {
      createMut.mutate(data);
    } else {
      updateMut.mutate({ id: editing.id, data });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100">
          <h2 className="font-display text-lg font-bold text-gray-900">Offer Templates</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Template list */}
          <div className="w-64 border-r border-surface-100 p-4 overflow-y-auto flex-shrink-0">
            <button
              onClick={startNew}
              className="w-full flex items-center gap-2 px-3 py-2 bg-brand-50 text-brand-600 rounded-lg text-sm font-medium hover:bg-brand-100 transition-colors mb-3"
            >
              <Plus className="w-4 h-4" /> New Template
            </button>

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <div key={i} className="h-10 bg-surface-100 rounded-lg animate-pulse" />)}
              </div>
            ) : templates.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No templates yet</p>
            ) : (
              <div className="space-y-1">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                      editing?.id === t.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-surface-50 text-gray-700'
                    }`}
                    onClick={() => startEdit(t)}
                  >
                    <span className="truncate flex-1">
                      {t.name}
                      {t.is_default && <span className="ml-1 text-xs text-brand-400">(default)</span>}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm('Delete this template?')) deleteMut.mutate(t.id); }}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 p-0.5 ml-1 flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-y-auto p-6">
            {!editing ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <FileText className="w-12 h-12 mb-3" />
                <p className="text-sm">Select a template to edit or create a new one</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Template Name</label>
                  <input
                    {...register('name', { required: true })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                    placeholder="e.g. Standard Offer Letter"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    HTML Body
                    <span className="ml-2 font-normal text-gray-400">
                      Use {'{{'} {'}}'}candidate_name{'{{'} {'}}'}, {'{{'} {'}}'}designation{'{{'} {'}}'}, {'{{'} {'}}'}salary_ctc{'{{'} {'}}'}, etc.
                    </span>
                  </label>
                  <textarea
                    {...register('body_html', { required: true })}
                    rows={16}
                    className="w-full px-3 py-2 border border-surface-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-300"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" {...register('is_default')} id="is_default" className="rounded" />
                  <label htmlFor="is_default" className="text-sm text-gray-600">Set as default template</label>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={createMut.isPending || updateMut.isPending}
                    className="px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50"
                  >
                    {editing === 'new' ? 'Create Template' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditing(null); reset(); }}
                    className="px-4 py-2 border border-surface-200 text-sm text-gray-600 rounded-lg hover:bg-surface-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_TEMPLATE_HTML = `<div style="font-family: Georgia, serif; max-width: 700px; margin: 0 auto; padding: 40px; color: #111;">
  <h1 style="font-size: 24px; margin-bottom: 4px;">Offer of Employment</h1>
  <p style="color: #666; margin-bottom: 32px;">{{company_name}}</p>

  <p>Dear <strong>{{candidate_name}}</strong>,</p>

  <p>We are pleased to offer you the position of <strong>{{designation}}</strong> in the <strong>{{department}}</strong> department, effective <strong>{{joining_date}}</strong>.</p>

  <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
    <tr style="background: #f9fafb;"><td style="padding: 10px 14px; border: 1px solid #e5e7eb; font-weight: bold;">Designation</td><td style="padding: 10px 14px; border: 1px solid #e5e7eb;">{{designation}}</td></tr>
    <tr><td style="padding: 10px 14px; border: 1px solid #e5e7eb; font-weight: bold;">Department</td><td style="padding: 10px 14px; border: 1px solid #e5e7eb;">{{department}}</td></tr>
    <tr style="background: #f9fafb;"><td style="padding: 10px 14px; border: 1px solid #e5e7eb; font-weight: bold;">CTC</td><td style="padding: 10px 14px; border: 1px solid #e5e7eb;">{{salary_ctc}} {{salary_currency}} per annum</td></tr>
    <tr><td style="padding: 10px 14px; border: 1px solid #e5e7eb; font-weight: bold;">Joining Date</td><td style="padding: 10px 14px; border: 1px solid #e5e7eb;">{{joining_date}}</td></tr>
    <tr style="background: #f9fafb;"><td style="padding: 10px 14px; border: 1px solid #e5e7eb; font-weight: bold;">Work Location</td><td style="padding: 10px 14px; border: 1px solid #e5e7eb;">{{work_location}}</td></tr>
    <tr><td style="padding: 10px 14px; border: 1px solid #e5e7eb; font-weight: bold;">Probation Period</td><td style="padding: 10px 14px; border: 1px solid #e5e7eb;">{{probation_months}} months</td></tr>
  </table>

  <p>This offer is valid until <strong>{{offer_expiry_date}}</strong>. Please confirm your acceptance by that date.</p>

  <p>We look forward to welcoming you to the team.</p>

  <p style="margin-top: 32px;">Warm regards,<br /><strong>HR Team</strong><br />{{company_name}}</p>
</div>`;

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OffersPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('');
  const [page, setPage] = useState(1);
  const [showTemplates, setShowTemplates] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['offers', { status: activeTab, page }],
    queryFn: () =>
      offersApi.list({ status: activeTab || undefined, page, limit: 20 }).then((r) => r.data),
    keepPreviousData: true,
  });

  const offers = data?.items ?? [];

  return (
    <div>
      {showTemplates && <TemplateModal onClose={() => setShowTemplates(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">Offer Letters</h1>
          <p className="text-sm text-gray-500 mt-0.5">{data?.total ?? 0} offer{data?.total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/hr/applicants')}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors"
          >
            <Send className="w-4 h-4" /> Create Offer
          </button>
          <button
            onClick={() => setShowTemplates(true)}
            className="flex items-center gap-2 px-4 py-2 border border-surface-200 text-sm text-gray-600 rounded-xl hover:bg-surface-50 transition-colors"
          >
            <Settings className="w-4 h-4" /> Manage Templates
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 bg-surface-100 rounded-xl p-1 mb-6 w-fit flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setActiveTab(tab.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : offers.length === 0 ? (
        <div className="text-center py-20">
          <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium text-sm">No offers found</p>
          <p className="text-gray-400 text-xs mt-1 mb-4">
            To send an offer: open an applicant's profile → go to the <strong>Offer</strong> tab → click <strong>Generate Offer Letter</strong>
          </p>
          <button
            onClick={() => navigate('/hr/applicants')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
          >
            <Send className="w-3.5 h-3.5" /> Go to Applicants
          </button>
        </div>
      ) : (
        <div className="bg-white border border-surface-200 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-100 text-xs text-gray-400 uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Candidate</th>
                <th className="text-left px-5 py-3 font-medium">Role / Job</th>
                <th className="text-left px-5 py-3 font-medium">Salary</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Sent / Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50">
              {offers.map((offer) => (
                <tr
                  key={offer.id}
                  className="hover:bg-surface-50/50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/hr/offers/${offer.id}`)}
                >
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-gray-900">{offer.candidate_name ?? '—'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{offer.candidate_email ?? ''}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm text-gray-800">{offer.designation}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{offer.job_title ?? ''}</p>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-700">
                    {offer.salary_ctc
                      ? `${Number(offer.salary_ctc).toLocaleString()} ${offer.salary_currency}`
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={offer.status} />
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-400">
                    {offer.sent_at
                      ? format(parseISO(offer.sent_at), 'MMM d, yyyy')
                      : format(parseISO(offer.created_at), 'MMM d, yyyy')
                    }
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/hr/offers/${offer.id}`); }}
                      className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium px-2 py-1 hover:bg-brand-50 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">{page} / {data.pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
