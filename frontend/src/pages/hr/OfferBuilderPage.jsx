import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft, Eye, Save, Send, RotateCcw, XCircle,
  AlertTriangle, ExternalLink, Copy, FileText, Check, Link2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { offersApi } from '@/api/offers';

const STATUS_CONFIG = {
  draft:             { label: 'Draft',                      color: 'text-gray-600 bg-gray-100',   dot: 'bg-gray-400' },
  pending_director:  { label: 'Awaiting Director Approval',  color: 'text-amber-700 bg-amber-50',  dot: 'bg-amber-400' },
  director_rejected: { label: 'Rejected by Director',        color: 'text-red-700 bg-red-50',      dot: 'bg-red-500' },
  sent:              { label: 'Awaiting Candidate Signature',color: 'text-blue-700 bg-blue-50',    dot: 'bg-blue-500' },
  accepted:          { label: 'Accepted',                    color: 'text-green-700 bg-green-50',  dot: 'bg-green-500' },
  rejected:          { label: 'Declined by Candidate',       color: 'text-red-700 bg-red-50',      dot: 'bg-red-500' },
  revoked:           { label: 'Revoked',                     color: 'text-orange-700 bg-orange-50',dot: 'bg-orange-400' },
  expired:           { label: 'Expired',                     color: 'text-yellow-700 bg-yellow-50',dot: 'bg-yellow-500' },
};

const BANNERS = {
  director_rejected: { tone: 'red',    text: 'The director rejected this offer. Revise the details below and resend it for approval.' },
  rejected:           { tone: 'red',    text: 'The candidate declined this offer.' },
  revoked:            { tone: 'orange', text: 'This offer was revoked and is no longer active.' },
  expired:            { tone: 'yellow', text: 'This offer expired before it was signed.' },
};

const BANNER_STYLES = {
  red:    'bg-red-50 border-red-200 text-red-700',
  orange: 'bg-orange-50 border-orange-200 text-orange-700',
  yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
};

const schema = z.object({
  designation:      z.string().min(1, 'Designation is required'),
  salary_ctc:       z.coerce.number().positive().optional().or(z.literal('')),
  salary_currency:  z.string().default('INR'),
  joining_date:     z.string().optional(),
  work_location:    z.string().optional(),
  probation_months: z.coerce.number().int().min(0).default(3),
  template_id:      z.string().uuid().optional().or(z.literal('')),
  expires_at:       z.string().optional(),
});

function renderTemplate(html, values) {
  if (!html) return '<p style="color:#999;font-style:italic">No template selected.</p>';
  const vars = {
    candidate_name:   values.candidate_name ?? '',
    designation:      values.designation ?? '',
    department:       values.department_name ?? '',
    salary_ctc:       values.salary_ctc ? String(values.salary_ctc) : '',
    salary_currency:  values.salary_currency ?? 'INR',
    joining_date:     values.joining_date ?? '',
    probation_months: String(values.probation_months ?? 3),
    work_location:    values.work_location ?? '',
    offer_expiry_date: values.expires_at ? values.expires_at.split('T')[0] : '',
    company_name:     'Nablon AI',
  };
  let result = html;
  Object.entries(vars).forEach(([k, v]) => {
    result = result.replaceAll(`{{${k}}}`, v);
  });
  return result;
}

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-IN', { dateStyle: 'long' });
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return '—';
  return `${currency ?? 'INR'} ${Number(amount).toLocaleString('en-IN')}`;
}

// ── Approval pipeline stepper ─────────────────────────────────────────────────

function deriveSteps(offer) {
  const status = offer?.status ?? 'draft';

  let directorState = 'pending';
  if (offer?.director_approved_at) directorState = 'complete';
  else if (status === 'pending_director') directorState = 'current';
  else if (status === 'director_rejected') directorState = 'error';
  else if (status === 'revoked') directorState = 'error';

  let candidateState = 'pending';
  if (status === 'accepted') candidateState = 'complete';
  else if (status === 'rejected') candidateState = 'error';
  else if (status === 'expired') candidateState = 'error';
  else if (status === 'sent') candidateState = 'current';
  else if (status === 'revoked' && offer?.sent_at) candidateState = 'error';

  return [
    {
      key: 'director',
      title: 'Director Approval',
      state: directorState,
      complete: {
        caption: offer?.director_approved_at ? `Approved ${formatDate(offer.director_approved_at)}` : 'Approved',
        signature: offer?.director_signature,
      },
      current: { caption: 'Sent to director for review' },
      error: {
        caption: status === 'director_rejected' ? 'Rejected by director' : 'Revoked before approval',
      },
      pending: { caption: 'Not yet sent' },
    },
    {
      key: 'candidate',
      title: 'Candidate Signature',
      state: candidateState,
      complete: {
        caption: offer?.signed_at ? `Signed ${formatDate(offer.signed_at)}` : 'Signed',
        signature: offer?.candidate_signature,
      },
      current: { caption: 'Awaiting candidate signature' },
      error: {
        caption:
          status === 'rejected' ? `Declined${offer?.accepted_at ? ' ' + formatDate(offer.accepted_at) : ''}`
          : status === 'expired' ? 'Offer expired unsigned'
          : 'Revoked',
      },
      pending: { caption: 'Not yet sent' },
    },
  ];
}

function StepIcon({ state }) {
  const base = 'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 z-10 bg-white';
  if (state === 'complete') return <div className={`${base} bg-green-500 border-green-500 text-white`}><Check className="w-4 h-4" /></div>;
  if (state === 'error') return <div className={`${base} border-red-400 text-red-500`}><XCircle className="w-4 h-4" /></div>;
  if (state === 'current') return <div className={`${base} border-brand-500`}><span className="w-2.5 h-2.5 rounded-full bg-brand-500 animate-pulse" /></div>;
  return <div className={`${base} border-surface-300 text-surface-300`}><span className="w-2 h-2 rounded-full bg-surface-300" /></div>;
}

function ApprovalStepper({ offer, respondLink, onCopyLink }) {
  const steps = deriveSteps(offer);
  return (
    <div className="bg-white border border-surface-200 rounded-2xl p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Approval Pipeline</p>
      <div>
        {steps.map((step, idx) => {
          const detail = step[step.state] ?? step.pending;
          const isLast = idx === steps.length - 1;
          return (
            <div key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <StepIcon state={step.state} />
                {!isLast && (
                  <div className={`w-0.5 flex-1 min-h-[28px] ${step.state === 'complete' ? 'bg-green-300' : 'bg-surface-200'}`} />
                )}
              </div>
              <div className={`pb-6 ${isLast ? 'pb-1' : ''} flex-1 min-w-0`}>
                <p className={`text-sm font-semibold ${step.state === 'pending' ? 'text-gray-400' : 'text-gray-900'}`}>
                  {step.title}
                </p>
                <p className={`text-xs mt-0.5 ${step.state === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                  {detail.caption}
                </p>

                {detail.signature && (
                  <img
                    src={detail.signature}
                    alt={`${step.title} signature`}
                    className="mt-2 max-h-14 border border-surface-200 rounded-lg bg-white p-1.5"
                  />
                )}

                {step.key === 'candidate' && step.state === 'current' && respondLink && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    <code className="text-xs bg-surface-50 border border-surface-200 rounded px-2 py-0.5 text-gray-500 truncate">
                      {respondLink}
                    </code>
                    <button
                      onClick={onCopyLink}
                      className="p-1 hover:bg-surface-100 rounded flex-shrink-0"
                      title="Copy candidate link"
                    >
                      <Copy className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Read-only summary (offer no longer editable) ──────────────────────────────

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-surface-100 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right">{value ?? '—'}</span>
    </div>
  );
}

function OfferSummary({ offer }) {
  return (
    <div className="bg-white border border-surface-200 rounded-2xl p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Offer Details</p>
      <SummaryRow label="Designation" value={offer.designation} />
      <SummaryRow label="Department" value={offer.department_name} />
      <SummaryRow label="CTC" value={formatMoney(offer.salary_ctc, offer.salary_currency)} />
      <SummaryRow label="Joining Date" value={offer.joining_date} />
      <SummaryRow label="Work Location" value={offer.work_location} />
      <SummaryRow label="Probation" value={offer.probation_months != null ? `${offer.probation_months} months` : null} />
      <SummaryRow label="Offer Expiry" value={offer.expires_at ? formatDate(offer.expires_at) : null} />
    </div>
  );
}

export default function OfferBuilderPage() {
  const { applicationId, offerId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = Boolean(applicationId);

  const [previewHtml, setPreviewHtml] = useState('');
  const [showConfirmSend, setShowConfirmSend] = useState(false);
  const [showConfirmRevoke, setShowConfirmRevoke] = useState(false);
  const [activePanel, setActivePanel] = useState('form'); // 'form' | 'preview' on mobile

  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isDirty } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      designation: '',
      salary_ctc: '',
      salary_currency: 'INR',
      joining_date: '',
      work_location: '',
      probation_months: 3,
      template_id: '',
      expires_at: '',
    },
  });

  // Fetch existing offer (edit mode)
  const { data: offer, isLoading: offerLoading } = useQuery({
    queryKey: ['offer', offerId],
    queryFn: () => offersApi.getById(offerId).then((r) => r.data),
    enabled: Boolean(offerId),
  });

  // Fetch templates
  const { data: templates = [] } = useQuery({
    queryKey: ['offer-templates'],
    queryFn: () => offersApi.listTemplates().then((r) => r.data),
  });

  // Populate form when offer loads
  useEffect(() => {
    if (offer) {
      reset({
        designation:      offer.designation ?? '',
        salary_ctc:       offer.salary_ctc ?? '',
        salary_currency:  offer.salary_currency ?? 'INR',
        joining_date:     offer.joining_date ?? '',
        work_location:    offer.work_location ?? '',
        probation_months: offer.probation_months ?? 3,
        template_id:      offer.template_id ?? '',
        expires_at:       offer.expires_at ? offer.expires_at.split('T')[0] : '',
      });
    }
  }, [offer, reset]);

  // Set default template for new offers
  useEffect(() => {
    if (isNew && templates.length > 0) {
      const def = templates.find((t) => t.is_default) ?? templates[0];
      if (def) setValue('template_id', def.id);
    }
  }, [isNew, templates, setValue]);

  const watchedValues = watch();

  // Live preview: update when form values or template changes
  useEffect(() => {
    const selectedTemplateId = watchedValues.template_id;
    const tmpl = templates.find((t) => t.id === selectedTemplateId);
    const enriched = {
      ...watchedValues,
      candidate_name: offer?.candidate_name ?? '',
      department_name: offer?.department_name ?? '',
    };
    setPreviewHtml(renderTemplate(tmpl?.body_html ?? '', enriched));
  }, [watchedValues, templates, offer]);

  // Mutations
  const createMut = useMutation({
    mutationFn: (data) => offersApi.create({ ...data, application_id: applicationId }),
    onSuccess: (res) => {
      toast.success('Offer draft created');
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      // Seed the application-offer cache so navigating back shows the offer immediately
      queryClient.setQueryData(['application-offer', applicationId], res.data);
      navigate(`/hr/offers/${res.data.id}`, { replace: true });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to create offer'),
  });

  const updateMut = useMutation({
    mutationFn: (data) => offersApi.update(offerId, data),
    onSuccess: () => {
      toast.success('Offer saved');
      queryClient.invalidateQueries({ queryKey: ['offer', offerId] });
      queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to save offer'),
  });

  const sendMut = useMutation({
    mutationFn: () => offersApi.send(offerId),
    onSuccess: () => {
      toast.success('Offer sent for director approval');
      queryClient.invalidateQueries({ queryKey: ['offer', offerId] });
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      setShowConfirmSend(false);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to send offer'),
  });

  const revokeMut = useMutation({
    mutationFn: () => offersApi.revoke(offerId),
    onSuccess: () => {
      toast.success('Offer revoked');
      queryClient.invalidateQueries({ queryKey: ['offer', offerId] });
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      setShowConfirmRevoke(false);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to revoke offer'),
  });

  function onSave(data) {
    const payload = {
      designation:      data.designation,
      salary_ctc:       data.salary_ctc || null,
      salary_currency:  data.salary_currency,
      joining_date:     data.joining_date || null,
      work_location:    data.work_location || null,
      probation_months: Number(data.probation_months),
      template_id:      data.template_id || null,
      expires_at:       data.expires_at ? new Date(data.expires_at).toISOString() : null,
    };
    if (isNew) {
      createMut.mutate(payload);
    } else {
      updateMut.mutate(payload);
    }
  }

  async function handleSendClick() {
    // Save first if dirty
    if (isDirty) {
      await handleSubmit(onSave)();
    }
    setShowConfirmSend(true);
  }

  const isEditable = !offer || ['draft', 'director_rejected'].includes(offer.status);
  const status = offer?.status ?? 'draft';
  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const banner = BANNERS[status];

  const respondLink = offer?.candidate_token
    ? `${window.location.origin}/offers/respond/${offer.candidate_token}`
    : null;

  function copyRespondLink() {
    if (!respondLink) return;
    navigator.clipboard.writeText(respondLink);
    toast.success('Link copied');
  }

  if (offerLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => {
              const appId = isNew ? applicationId : offer?.application_id;
              if (appId) navigate(`/hr/applicants/${appId}?tab=offer`);
              else navigate(-1);
            }}
            className="p-2 hover:bg-surface-100 rounded-lg transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Offer Letter</p>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="font-display text-xl font-bold text-gray-900 truncate">
                {isNew ? 'New Offer' : offer?.candidate_name ?? '...'}
              </h1>
              {!isNew && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusCfg.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                  {statusCfg.label}
                </span>
              )}
            </div>
            {offer?.job_title && (
              <p className="text-sm text-gray-500">{offer.job_title}</p>
            )}
          </div>
        </div>

        {/* Mobile panel toggle */}
        <div className="flex gap-1 bg-surface-100 rounded-xl p-1 lg:hidden flex-shrink-0">
          {['form', 'preview'].map((p) => (
            <button
              key={p}
              onClick={() => setActivePanel(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                activePanel === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
              }`}
            >
              {p === 'form' ? 'Edit' : 'Preview'}
            </button>
          ))}
        </div>
      </div>

      {/* Status banner (terminal negative states) */}
      {banner && (
        <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 mb-5 flex-shrink-0 ${BANNER_STYLES[banner.tone]}`}>
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{banner.text}</p>
        </div>
      )}

      {/* Split layout */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* Left column */}
        <div className={`flex-shrink-0 w-96 overflow-y-auto space-y-5 ${activePanel === 'preview' ? 'hidden lg:block' : ''}`}>
          {/* Candidate card */}
          {offer && (
            <div className="bg-white border border-surface-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-sm font-bold flex-shrink-0">
                {offer.candidate_name?.[0] ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{offer.candidate_name}</p>
                <p className="text-xs text-gray-400 truncate">{offer.candidate_email}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/hr/applicants/${offer.application_id}?tab=offer`)}
                className="p-1.5 hover:bg-surface-100 rounded-lg flex-shrink-0"
                title="View application"
              >
                <ExternalLink className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          )}

          {/* Approval pipeline */}
          {offer && (
            <ApprovalStepper offer={offer} respondLink={respondLink} onCopyLink={copyRespondLink} />
          )}

          {/* Details: editable form or read-only summary */}
          {isEditable ? (
            <form onSubmit={handleSubmit(onSave)} className="bg-white border border-surface-200 rounded-2xl p-5 space-y-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Offer Details</p>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Template</label>
                <select
                  {...register('template_id')}
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                >
                  <option value="">No template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Designation *</label>
                <input
                  {...register('designation')}
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                  placeholder="e.g. Senior Engineer"
                />
                {errors.designation && <p className="text-red-500 text-xs mt-1">{errors.designation.message}</p>}
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">CTC</label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('salary_ctc')}
                    className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                    placeholder="1200000"
                  />
                </div>
                <div className="w-20">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
                  <select
                    {...register('salary_currency')}
                    className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                  >
                    {['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AED'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Joining Date</label>
                <input
                  type="date"
                  {...register('joining_date')}
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Work Location</label>
                <input
                  {...register('work_location')}
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                  placeholder="e.g. Bangalore / Remote"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Probation (months)</label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  {...register('probation_months')}
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Offer Expiry Date</label>
                <input
                  type="date"
                  {...register('expires_at')}
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </div>

              <div className="pt-2 space-y-2 border-t border-surface-100">
                <button
                  type="submit"
                  disabled={createMut.isPending || updateMut.isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-surface-200 text-sm font-medium text-gray-700 rounded-xl hover:bg-surface-50 transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {createMut.isPending || updateMut.isPending ? 'Saving...' : 'Save Draft'}
                </button>
                {!isNew && (
                  <button
                    type="button"
                    onClick={handleSendClick}
                    disabled={sendMut.isPending}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    {status === 'director_rejected' ? 'Resend for Director Approval' : 'Send for Director Approval'}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <>
              <OfferSummary offer={offer} />
              {['pending_director', 'sent'].includes(status) && (
                <button
                  type="button"
                  onClick={() => setShowConfirmRevoke(true)}
                  disabled={revokeMut.isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-red-600 text-sm font-medium rounded-xl hover:bg-red-50 transition-colors border border-red-200 disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" /> Revoke Offer
                </button>
              )}
            </>
          )}
        </div>

        {/* Right — Live Preview */}
        <div className={`flex-1 min-w-0 ${activePanel === 'form' ? 'hidden lg:flex' : 'flex'} flex-col`}>
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
              <Eye className="w-4 h-4 text-gray-400" />
              <span>Live Preview</span>
            </div>
            <span className="text-xs text-gray-300">Variables are substituted in real-time</span>
          </div>
          <div className="flex-1 bg-surface-100 rounded-2xl overflow-auto p-6">
            <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-surface-200 min-h-full">
              <div className="flex items-center gap-2 px-6 py-3 border-b border-surface-100">
                <FileText className="w-4 h-4 text-gray-300" />
                <span className="text-xs text-gray-400">Offer Letter</span>
              </div>
              <div
                className="p-8"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Confirm Send Dialog */}
      {showConfirmSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="w-11 h-11 rounded-full bg-brand-50 flex items-center justify-center mb-4">
              <Send className="w-5 h-5 text-brand-600" />
            </div>
            <h3 className="font-display text-lg font-bold text-gray-900 mb-2">Send Offer for Director Approval?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This will email the director a secure approval link. The offer only reaches{' '}
              <strong>{offer?.candidate_name}</strong> once the director signs off. You can revoke it beforehand if needed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => sendMut.mutate()}
                disabled={sendMut.isPending}
                className="flex-1 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 disabled:opacity-50 transition-colors"
              >
                {sendMut.isPending ? 'Sending...' : 'Yes, Send It'}
              </button>
              <button
                onClick={() => setShowConfirmSend(false)}
                className="px-4 py-2.5 border border-surface-200 text-sm text-gray-600 rounded-xl hover:bg-surface-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Revoke Dialog */}
      {showConfirmRevoke && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="w-11 h-11 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <RotateCcw className="w-5 h-5 text-red-500" />
            </div>
            <h3 className="font-display text-lg font-bold text-gray-900 mb-2">Revoke this Offer?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Any pending director or candidate response link will be invalidated immediately. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => revokeMut.mutate()}
                disabled={revokeMut.isPending}
                className="flex-1 px-4 py-2.5 bg-red-500 text-white text-sm font-semibold rounded-xl hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {revokeMut.isPending ? 'Revoking...' : 'Yes, Revoke'}
              </button>
              <button
                onClick={() => setShowConfirmRevoke(false)}
                className="px-4 py-2.5 border border-surface-200 text-sm text-gray-600 rounded-xl hover:bg-surface-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
