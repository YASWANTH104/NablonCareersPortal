import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Eye, Save, Send, RotateCcw, CheckCircle, XCircle, Clock, AlertCircle, ExternalLink, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { offersApi } from '@/api/offers';

const STATUS_CONFIG = {
  draft:    { icon: Clock,        label: 'Draft',    color: 'text-gray-500 bg-gray-100' },
  sent:     { icon: Send,         label: 'Sent',     color: 'text-blue-600 bg-blue-100' },
  accepted: { icon: CheckCircle,  label: 'Accepted', color: 'text-green-600 bg-green-100' },
  rejected: { icon: XCircle,      label: 'Rejected', color: 'text-red-600 bg-red-100' },
  revoked:  { icon: RotateCcw,    label: 'Revoked',  color: 'text-orange-600 bg-orange-100' },
  expired:  { icon: AlertCircle,  label: 'Expired',  color: 'text-yellow-600 bg-yellow-100' },
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
      toast.success('Offer sent to candidate');
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

  const isReadOnly = offer && offer.status !== 'draft';
  const status = offer?.status ?? 'draft';
  const StatusIcon = STATUS_CONFIG[status]?.icon ?? Clock;

  const respondLink = offer?.candidate_token
    ? `${window.location.origin}/offers/respond/${offer.candidate_token}`
    : null;

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
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const appId = isNew ? applicationId : offer?.application_id;
              if (appId) navigate(`/hr/applicants/${appId}?tab=offer`);
              else navigate(-1);
            }}
            className="p-2 hover:bg-surface-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-bold text-gray-900">
                {isNew ? 'New Offer Letter' : `Offer — ${offer?.candidate_name ?? '...'}`}
              </h1>
              {!isNew && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[status]?.color}`}>
                  <StatusIcon className="w-3 h-3" />
                  {STATUS_CONFIG[status]?.label}
                </span>
              )}
            </div>
            {offer?.job_title && (
              <p className="text-sm text-gray-500 mt-0.5">{offer.job_title}</p>
            )}
          </div>
        </div>

        {/* Mobile panel toggle */}
        <div className="flex gap-1 bg-surface-100 rounded-xl p-1 lg:hidden">
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

      {/* Candidate info banner (edit mode) */}
      {offer && (
        <div className="bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 mb-5 flex items-center gap-4 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-sm font-bold">
              {offer.candidate_name?.[0] ?? '?'}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{offer.candidate_name}</p>
              <p className="text-xs text-gray-400">{offer.candidate_email}</p>
            </div>
          </div>
          {respondLink && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-gray-400">Candidate link:</span>
              <code className="text-xs bg-white border border-surface-200 rounded px-2 py-0.5 text-gray-600 max-w-xs truncate">
                {respondLink}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(respondLink); toast.success('Link copied'); }}
                className="p-1 hover:bg-surface-100 rounded"
              >
                <Copy className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Signature display (accepted) */}
      {offer?.candidate_signature && (
        <div className="bg-green-50 border border-green-100 rounded-xl p-4 mb-5 flex-shrink-0">
          <p className="text-sm font-medium text-green-700 mb-2">Candidate Signature</p>
          <img
            src={offer.candidate_signature}
            alt="Candidate signature"
            className="max-h-20 bg-white border border-green-200 rounded p-2"
          />
          {offer.signed_at && (
            <p className="text-xs text-green-500 mt-1">
              Signed on {new Date(offer.signed_at).toLocaleDateString('en-IN', { dateStyle: 'long' })}
            </p>
          )}
        </div>
      )}

      {/* Split layout */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* Left — Form */}
        <div className={`flex-shrink-0 w-80 overflow-y-auto ${activePanel === 'preview' ? 'hidden lg:block' : ''}`}>
          <form onSubmit={handleSubmit(onSave)} className="space-y-4">
            {/* Template picker */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Template</label>
              <select
                {...register('template_id')}
                disabled={isReadOnly}
                className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-surface-50 disabled:text-gray-400"
              >
                <option value="">No template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Designation */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Designation *</label>
              <input
                {...register('designation')}
                disabled={isReadOnly}
                className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-surface-50 disabled:text-gray-400"
                placeholder="e.g. Senior Engineer"
              />
              {errors.designation && <p className="text-red-500 text-xs mt-1">{errors.designation.message}</p>}
            </div>

            {/* Salary */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">CTC</label>
                <input
                  type="number"
                  step="0.01"
                  {...register('salary_ctc')}
                  disabled={isReadOnly}
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-surface-50 disabled:text-gray-400"
                  placeholder="1200000"
                />
              </div>
              <div className="w-20">
                <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
                <select
                  {...register('salary_currency')}
                  disabled={isReadOnly}
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-surface-50 disabled:text-gray-400"
                >
                  {['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AED'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Joining date */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Joining Date</label>
              <input
                type="date"
                {...register('joining_date')}
                disabled={isReadOnly}
                className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-surface-50 disabled:text-gray-400"
              />
            </div>

            {/* Work location */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Work Location</label>
              <input
                {...register('work_location')}
                disabled={isReadOnly}
                className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-surface-50 disabled:text-gray-400"
                placeholder="e.g. Bangalore / Remote"
              />
            </div>

            {/* Probation */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Probation (months)</label>
              <input
                type="number"
                min={0}
                max={12}
                {...register('probation_months')}
                disabled={isReadOnly}
                className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-surface-50 disabled:text-gray-400"
              />
            </div>

            {/* Expiry */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Offer Expiry Date</label>
              <input
                type="date"
                {...register('expires_at')}
                disabled={isReadOnly}
                className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-surface-50 disabled:text-gray-400"
              />
            </div>

            {/* Actions */}
            <div className="pt-3 space-y-2 border-t border-surface-100">
              {status === 'draft' && (
                <>
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
                      <Send className="w-4 h-4" /> Send to Candidate
                    </button>
                  )}
                </>
              )}

              {status === 'sent' && (
                <button
                  type="button"
                  onClick={() => setShowConfirmRevoke(true)}
                  disabled={revokeMut.isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-sm font-medium rounded-xl hover:bg-red-100 transition-colors border border-red-200 disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" /> Revoke Offer
                </button>
              )}

              {offer && (
                <button
                  type="button"
                  onClick={() => navigate(`/hr/applicants/${offer.application_id}?tab=offer`)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> View Application
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right — Live Preview */}
        <div className={`flex-1 min-w-0 ${activePanel === 'form' ? 'hidden lg:flex' : 'flex'} flex-col`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Eye className="w-4 h-4" />
              <span>Live Preview</span>
            </div>
            <span className="text-xs text-gray-300">Variables are substituted in real-time</span>
          </div>
          <div className="flex-1 bg-white border border-surface-200 rounded-2xl overflow-auto">
            <div
              className="p-6"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </div>

      {/* Confirm Send Dialog */}
      {showConfirmSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <h3 className="font-display text-lg font-bold text-gray-900 mb-2">Send Offer to Candidate?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This will mark the offer as <strong>Sent</strong> and generate a secure response link for{' '}
              <strong>{offer?.candidate_name}</strong>. You can revoke it afterwards if needed.
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
            <h3 className="font-display text-lg font-bold text-gray-900 mb-2">Revoke this Offer?</h3>
            <p className="text-sm text-gray-500 mb-5">
              The candidate's response link will be invalidated immediately. This action cannot be undone.
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
