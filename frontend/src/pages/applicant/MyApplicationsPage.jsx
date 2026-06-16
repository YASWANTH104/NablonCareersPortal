import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { format, isPast } from 'date-fns';
import toast from 'react-hot-toast';
import {
  Briefcase, ChevronRight, FileText, AlertCircle, Pencil, X, Loader2,
  Upload, CheckCircle2, ChevronDown, ChevronUp, PartyPopper, Calendar,
  MessageSquarePlus, ThumbsUp, PenLine, RotateCcw, Eye, Download,
} from 'lucide-react';
import { applicationsApi } from '@/api/applications';
import { interviewsApi } from '@/api/interviews';
import { documentsApi } from '@/api/documents';
import { offersApi } from '@/api/offers';
import client from '@/api/client';

const STAGE_CONFIG = {
  applied:         { label: 'Applied',          color: 'bg-blue-100 text-blue-700' },
  screening:       { label: 'Screening',         color: 'bg-purple-100 text-purple-700' },
  assessment:      { label: 'Assessment',        color: 'bg-orange-100 text-orange-700' },
  interview_1:     { label: 'Interview 1',       color: 'bg-indigo-100 text-indigo-700' },
  interview_2:     { label: 'Interview 2',       color: 'bg-indigo-100 text-indigo-700' },
  interview_3:     { label: 'Interview 3',       color: 'bg-indigo-100 text-indigo-700' },
  final_interview: { label: 'Final Interview',   color: 'bg-violet-100 text-violet-700' },
  offer:           { label: 'Offer',             color: 'bg-emerald-100 text-emerald-700' },
  hired:           { label: 'Hired',             color: 'bg-green-100 text-green-700' },
  rejected:        { label: 'Rejected',          color: 'bg-red-100 text-red-700' },
  withdrawn:       { label: 'Withdrawn',         color: 'bg-gray-100 text-gray-500' },
};

const TERMINAL_STAGES = new Set(['hired', 'rejected', 'withdrawn']);

function StageBadge({ stage }) {
  const cfg = STAGE_CONFIG[stage] ?? { label: stage, color: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function EditApplicationModal({ app, onClose, onSuccess }) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm();

  useEffect(() => {
    reset({
      cover_letter: app.cover_letter ?? '',
      resume_url: app.resume_url ?? '',
      linkedin_url: app.linkedin_url ?? '',
      portfolio_url: app.portfolio_url ?? '',
      github_url: app.github_url ?? '',
    });
  }, [app, reset]);

  const onSubmit = async (values) => {
    const payload = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== '')
    );
    await client.patch(`/applications/${app.id}`, payload);
    toast.success('Application updated');
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200">
          <h2 className="font-semibold text-gray-900">Edit Application</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Resume URL</label>
            <input
              {...register('resume_url')}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="https://drive.google.com/..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cover Letter</label>
            <textarea
              {...register('cover_letter')}
              rows={4}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
              placeholder="Tell us why you're a great fit..."
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">LinkedIn</label>
              <input
                {...register('linkedin_url')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="linkedin.com/in/..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Portfolio</label>
              <input
                {...register('portfolio_url')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="yoursite.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">GitHub</label>
              <input
                {...register('github_url')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="github.com/..."
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Save changes
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const DOC_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png';

function DocUploadRow({ doc, submittedTypes, applicationId, onUploaded }) {
  const fileRef = useRef(null);
  const qc = useQueryClient();
  const submitted = submittedTypes.includes(doc.type);

  const mut = useMutation({
    mutationFn: (file) => documentsApi.uploadMyDocument(applicationId, doc.type, file),
    onSuccess: () => {
      toast.success(`${doc.label} uploaded`);
      qc.invalidateQueries({ queryKey: ['my-docs', applicationId] });
      onUploaded?.();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Upload failed'),
  });

  return (
    <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${
      submitted ? 'border-green-200 bg-green-50' : 'border-surface-200 bg-white'
    }`}>
      <div className="flex items-center gap-2 min-w-0">
        {submitted
          ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
          : <FileText className="w-4 h-4 text-gray-300 flex-shrink-0" />}
        <span className={`text-sm truncate ${submitted ? 'text-green-800 font-medium' : 'text-gray-700'}`}>
          {doc.label}
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={DOC_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) { mut.mutate(file); e.target.value = ''; }
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={mut.isPending}
        className={`ml-3 flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors disabled:opacity-50 ${
          submitted
            ? 'border-green-300 text-green-700 hover:bg-green-100'
            : 'border-brand-300 text-brand-700 hover:bg-brand-50'
        }`}
      >
        {mut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
        {submitted ? 'Replace' : 'Upload'}
      </button>
    </div>
  );
}

function SignaturePad({ onCapture, onClear }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const source = e.touches ? e.touches[0] : e;
    // Scale from CSS pixels to canvas intrinsic pixels
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function start(e) {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e) {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#111827';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const { x, y } = getPos(e, canvas);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(e) {
    if (!drawing.current) return;
    drawing.current = false;
    onCapture(canvasRef.current.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    onClear();
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={600}
        height={120}
        className="border-2 border-dashed border-brand-200 rounded-xl bg-white cursor-crosshair w-full touch-none"
        onMouseDown={start}
        onMouseMove={draw}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={draw}
        onTouchEnd={end}
      />
      <button
        type="button"
        onClick={clear}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mt-1 transition-colors"
      >
        <RotateCcw className="w-3 h-3" /> Clear
      </button>
    </div>
  );
}

function OfferActionPanel({ applicationId }) {
  const qc = useQueryClient();

  const { data: docs, isLoading: docsLoading } = useQuery({
    queryKey: ['my-docs', applicationId],
    queryFn: () => documentsApi.getMyDocuments(applicationId).then((r) => r.data),
    retry: false,
  });

  const { data: offer, isLoading: offerLoading } = useQuery({
    queryKey: ['my-offer', applicationId],
    queryFn: () => offersApi.getMyOffer(applicationId).then((r) => r.data),
    retry: false,
  });

  const [sigStep, setSigStep] = useState(false);
  const [signature, setSignature] = useState(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleTogglePdf() {
    if (pdfBlobUrl) { setPdfBlobUrl(null); return; }
    setPdfLoading(true);
    try {
      const url = await offersApi.fetchMyHtmlBlob(applicationId);
      setPdfBlobUrl(url);
    } catch {
      toast.error('Could not load offer letter');
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleDownloadPdf() {
    setDownloading(true);
    try {
      await offersApi.downloadMyPdf(applicationId);
    } catch {
      toast.error('Could not download offer letter');
    } finally {
      setDownloading(false);
    }
  }

  const respondMut = useMutation({
    mutationFn: ({ decision, candidate_signature }) =>
      offersApi.respondMyOffer(applicationId, { decision, candidate_signature }),
    onSuccess: (res) => {
      const msg = res.data.status === 'accepted'
        ? 'Offer accepted! Congratulations!'
        : 'Offer declined.';
      toast.success(msg);
      setSigStep(false);
      setSignature(null);
      qc.invalidateQueries({ queryKey: ['my-offer', applicationId] });
      qc.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to respond'),
  });

  if (docsLoading || offerLoading) {
    return (
      <div className="mt-3 pt-3 border-t border-surface-100 flex items-center gap-2 text-xs text-gray-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading offer details…
      </div>
    );
  }

  const docsComplete = docs?.status === 'complete';
  const submittedTypes = docs?.submitted_types ?? [];
  const requiredTypes = docs?.required_types ?? [];
  const submittedCount = submittedTypes.length;
  const totalCount = requiredTypes.length;

  // Offer already responded
  if (offer && ['accepted', 'rejected', 'expired', 'revoked'].includes(offer.status)) {
    const isAccepted = offer.status === 'accepted';
    return (
      <div className="mt-3 pt-3 border-t border-surface-100 space-y-3">
        <div className={`flex items-center gap-2 text-sm font-medium ${isAccepted ? 'text-green-700' : 'text-gray-500'}`}>
          {isAccepted
            ? <><PartyPopper className="w-4 h-4" /> Offer accepted — welcome to Nablon AI!</>
            : `Offer ${offer.status}.`}
        </div>

        {isAccepted && (
          <>
            {offer.candidate_signature && (
              <div className="bg-surface-50 border border-surface-200 rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-2">Your signature</p>
                <img
                  src={offer.candidate_signature}
                  alt="Your signature"
                  className="max-h-14 border border-surface-200 rounded bg-white p-1.5"
                />
                {offer.signed_at && (
                  <p className="text-xs text-gray-400 mt-1">
                    Signed {format(new Date(offer.signed_at), 'dd MMM yyyy')}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleTogglePdf}
                disabled={pdfLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 border border-brand-200 text-xs text-brand-700 font-medium rounded-lg hover:bg-brand-100 transition-colors disabled:opacity-60"
              >
                {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                {offer.candidate_signature ? 'View Signed PDF' : 'View PDF'}
              </button>
              <button
                onClick={handleDownloadPdf}
                disabled={downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-200 text-xs text-gray-600 rounded-lg hover:bg-surface-50 transition-colors disabled:opacity-60"
              >
                {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Download
              </button>
            </div>

            {pdfBlobUrl && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl flex flex-col" style={{ height: '90vh' }}>
                  <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 flex-shrink-0">
                    <h3 className="font-semibold text-gray-900">
                      {offer.candidate_signature ? 'Signed Offer Letter' : 'Offer Letter'}
                    </h3>
                    <button
                      onClick={() => setPdfBlobUrl(null)}
                      className="p-1.5 rounded-lg hover:bg-surface-100 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <iframe
                    src={pdfBlobUrl}
                    title="Offer Letter"
                    className="flex-1 w-full rounded-b-2xl"
                  />
                </div>
              </div>
            )}
          </>
        )}

      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-surface-100 space-y-3">
      {/* Document upload section */}
      {!docsComplete && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Step 1 — Submit Documents
            </p>
            <span className="text-xs text-gray-400">{submittedCount}/{totalCount}</span>
          </div>
          <div className="w-full bg-surface-100 rounded-full h-1 mb-2">
            <div
              className="bg-brand-500 h-1 rounded-full transition-all"
              style={{ width: totalCount ? `${(submittedCount / totalCount) * 100}%` : '0%' }}
            />
          </div>
          <div className="space-y-1.5">
            {requiredTypes.map((doc) => (
              <DocUploadRow
                key={doc.type}
                doc={doc}
                submittedTypes={submittedTypes}
                applicationId={applicationId}
                onUploaded={() => qc.invalidateQueries({ queryKey: ['my-docs', applicationId] })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Documents complete confirmation */}
      {docsComplete && !offer && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          All documents submitted. Your offer letter will be sent shortly.
        </div>
      )}

      {/* Offer letter accept/decline */}
      {docsComplete && offer && offer.status === 'sent' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Step 2 — Review &amp; Respond to Offer
            </p>
            <button
              onClick={handleTogglePdf}
              disabled={pdfLoading}
              className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium disabled:opacity-60"
            >
              {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
              View Letter
            </button>
          </div>
          <div className="bg-surface-50 border border-surface-200 rounded-lg p-3 space-y-2 mb-3 text-sm text-gray-700">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-gray-400 text-xs">Role</span>
              <span className="font-medium text-xs">{offer.designation}</span>
              {offer.salary_ctc && (
                <>
                  <span className="text-gray-400 text-xs">CTC</span>
                  <span className="font-medium text-xs">
                    {offer.salary_currency} {Number(offer.salary_ctc).toLocaleString('en-IN')}
                  </span>
                </>
              )}
              {offer.joining_date && (
                <>
                  <span className="text-gray-400 text-xs">Joining Date</span>
                  <span className="font-medium text-xs">
                    {format(new Date(offer.joining_date), 'dd MMM yyyy')}
                  </span>
                </>
              )}
              {offer.work_location && (
                <>
                  <span className="text-gray-400 text-xs">Location</span>
                  <span className="font-medium text-xs">{offer.work_location}</span>
                </>
              )}
              {offer.expires_at && (
                <>
                  <span className="text-gray-400 text-xs">Offer Expires</span>
                  <span className="font-medium text-xs text-amber-600">
                    {format(new Date(offer.expires_at), 'dd MMM yyyy')}
                  </span>
                </>
              )}
            </div>
          </div>
          {!sigStep ? (
            <div className="flex gap-2">
              <button
                onClick={() => setSigStep(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600"
              >
                <CheckCircle2 className="w-4 h-4" />
                Accept Offer
              </button>
              <button
                onClick={() => respondMut.mutate({ decision: 'rejected' })}
                disabled={respondMut.isPending}
                className="px-4 py-2 border border-surface-300 text-sm text-gray-600 rounded-lg hover:bg-surface-50 disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <PenLine className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-gray-700">
                  Sign below to confirm acceptance
                </p>
              </div>
              <SignaturePad
                onCapture={(sig) => setSignature(sig)}
                onClear={() => setSignature(null)}
              />
              {!signature && (
                <p className="text-xs text-amber-600">Please draw your signature above</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => respondMut.mutate({ decision: 'accepted', candidate_signature: signature })}
                  disabled={!signature || respondMut.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60"
                >
                  {respondMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm &amp; Accept
                </button>
                <button
                  onClick={() => { setSigStep(false); setSignature(null); }}
                  className="px-4 py-2 border border-surface-300 text-sm text-gray-600 rounded-lg hover:bg-surface-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {pdfBlobUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl flex flex-col" style={{ height: '90vh' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 flex-shrink-0">
              <h3 className="font-semibold text-gray-900">
                {offer?.candidate_signature ? 'Signed Offer Letter' : 'Offer Letter'}
              </h3>
              <button
                onClick={() => setPdfBlobUrl(null)}
                className="p-1.5 rounded-lg hover:bg-surface-100 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe
              src={pdfBlobUrl}
              title="Offer Letter"
              className="flex-1 w-full rounded-b-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

const INTERVIEW_STAGES = new Set(['screening', 'assessment', 'tr1', 'tr2', 'hr']);
const INTERVIEW_VIEWABLE_STAGES = new Set(['applied', 'screening', 'assessment', 'tr1', 'tr2', 'hr']);

const HEATMAP_QUESTIONS = [
  { key: 'overall_score',        label: 'Overall performance',       sub: 'How well do you think you performed?' },
  { key: 'communication_score',  label: 'Communication clarity',     sub: 'How clearly did you communicate your thoughts?' },
  { key: 'technical_confidence', label: 'Technical confidence',      sub: 'How confident were you in your technical answers?' },
];

const DIFFICULTY_OPTIONS = [
  { value: 'easy',      label: 'Easy' },
  { value: 'medium',    label: 'Medium' },
  { value: 'hard',      label: 'Hard' },
  { value: 'very_hard', label: 'Very Hard' },
];

const EXPERIENCE_OPTIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good',      label: 'Good' },
  { value: 'average',   label: 'Average' },
  { value: 'poor',      label: 'Poor' },
];

function heatmapColor(n, selected) {
  if (n > selected) return 'bg-surface-100 text-gray-400 hover:bg-surface-200';
  if (selected <= 3) return 'bg-red-400 text-white';
  if (selected <= 6) return 'bg-yellow-400 text-white';
  return 'bg-green-500 text-white';
}

function HeatmapSlider({ value, onChange, label, sub }) {
  return (
    <div>
      <div className="mb-1">
        <span className="text-sm font-medium text-gray-800">{label}</span>
        {sub && <span className="text-xs text-gray-400 ml-2">{sub}</span>}
      </div>
      <div className="flex items-center gap-1">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={`flex-1 h-8 rounded text-xs font-semibold transition-all ${
              value != null ? heatmapColor(i, value) : 'bg-surface-100 text-gray-400 hover:bg-surface-200'
            }`}
          >
            {i}
          </button>
        ))}
        {value != null && (
          <span className={`ml-2 text-sm font-bold w-6 text-right ${
            value <= 3 ? 'text-red-500' : value <= 6 ? 'text-yellow-500' : 'text-green-600'
          }`}>{value}</span>
        )}
      </div>
    </div>
  );
}

function YesNoToggle({ value, onChange, label }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <div className="flex rounded-lg overflow-hidden border border-surface-200">
        {[true, false].map((opt) => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              value === opt
                ? opt ? 'bg-green-500 text-white' : 'bg-red-400 text-white'
                : 'bg-white text-gray-500 hover:bg-surface-50'
            }`}
          >
            {opt ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  );
}

function PillSelect({ options, value, onChange }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            value === o.value
              ? 'bg-brand-500 text-white border-brand-500'
              : 'bg-white text-gray-600 border-surface-300 hover:border-brand-300 hover:text-brand-600'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SelfFeedbackModal({ interview, onClose }) {
  const qc = useQueryClient();
  const [scores, setScores] = useState({ overall_score: null, communication_score: null, technical_confidence: null });
  const [yesNo, setYesNo] = useState({ was_prepared: null, would_recommend: null });
  const [difficulty, setDifficulty] = useState(null);
  const [experienceRating, setExperienceRating] = useState(null);
  const [comments, setComments] = useState('');

  const submitMut = useMutation({
    mutationFn: (data) => interviewsApi.submitSelfFeedback(interview.id, data),
    onSuccess: () => {
      toast.success('Thanks for sharing your experience!');
      qc.invalidateQueries({ queryKey: ['candidate-interviews', interview.application_id] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not save feedback'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    submitMut.mutate({
      ...scores,
      ...yesNo,
      difficulty,
      experience_rating: experienceRating,
      comments: comments || undefined,
    });
  };

  const interviewTitle = interview.title || `Round ${interview.round_number}`;
  const interviewDate = format(new Date(interview.scheduled_at), 'dd MMM yyyy');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg my-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-surface-100">
          <div>
            <h2 className="font-display font-bold text-gray-900">How did your interview go?</h2>
            <p className="text-xs text-gray-400 mt-0.5">{interviewTitle} · {interviewDate}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {/* Heatmaps */}
          <div className="space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rate yourself (0 = poor, 10 = excellent)</p>
            {HEATMAP_QUESTIONS.map((q) => (
              <HeatmapSlider
                key={q.key}
                label={q.label}
                sub={q.sub}
                value={scores[q.key]}
                onChange={(v) => setScores((s) => ({ ...s, [q.key]: v }))}
              />
            ))}
          </div>

          <hr className="border-surface-100" />

          {/* Yes / No */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quick questions</p>
            <YesNoToggle
              label="Were you well prepared for this interview?"
              value={yesNo.was_prepared}
              onChange={(v) => setYesNo((s) => ({ ...s, was_prepared: v }))}
            />
            <YesNoToggle
              label="Would you recommend Nablon AI as an employer?"
              value={yesNo.would_recommend}
              onChange={(v) => setYesNo((s) => ({ ...s, would_recommend: v }))}
            />
          </div>

          <hr className="border-surface-100" />

          {/* Multiple choice */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-800 mb-2">How difficult was the interview?</p>
              <PillSelect options={DIFFICULTY_OPTIONS} value={difficulty} onChange={setDifficulty} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800 mb-2">How was the overall interview experience?</p>
              <PillSelect options={EXPERIENCE_OPTIONS} value={experienceRating} onChange={setExperienceRating} />
            </div>
          </div>

          <hr className="border-surface-100" />

          {/* Comments */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1.5">
              Anything else you'd like to share? <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              placeholder="e.g. The questions were really interesting, I felt at ease..."
              className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitMut.isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 transition-colors"
            >
              {submitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
              Submit feedback
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
            >
              Skip
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InterviewsPanel({ applicationId }) {
  const [feedbackFor, setFeedbackFor] = useState(null);
  const { data: interviews = [], isLoading } = useQuery({
    queryKey: ['candidate-interviews', applicationId],
    queryFn: () => applicationsApi.getMyInterviews(applicationId).then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="mt-3 pt-3 border-t border-surface-100 flex items-center gap-2 text-xs text-gray-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading interviews…
      </div>
    );
  }

  if (!interviews.length) {
    return (
      <div className="mt-3 pt-3 border-t border-surface-100 text-xs text-gray-400 text-center py-2">
        No interviews scheduled yet.
      </div>
    );
  }

  const TYPE_LABELS = { video: 'Video', phone: 'Phone', onsite: 'On-site', technical: 'Technical', hr: 'HR', panel: 'Panel' };
  const STATUS_COLORS = {
    scheduled:   'bg-blue-100 text-blue-700',
    completed:   'bg-green-100 text-green-700',
    cancelled:   'bg-red-100 text-red-700',
    rescheduled: 'bg-yellow-100 text-yellow-700',
    no_show:     'bg-gray-100 text-gray-500',
  };

  return (
    <div className="mt-3 pt-3 border-t border-surface-100 space-y-2">
      {feedbackFor && (
        <SelfFeedbackModal interview={feedbackFor} onClose={() => setFeedbackFor(null)} />
      )}
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Your Interviews</p>
      {interviews.map((iv) => {
        const canFeedback = (iv.status === 'completed' || (iv.status === 'scheduled' && isPast(new Date(iv.scheduled_at)))) && !iv.self_feedback_submitted;
        return (
          <div key={iv.id} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-surface-50 rounded-lg border border-surface-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {iv.title || `Round ${iv.round_number}`}
                  {iv.interview_type && <span className="ml-1.5 text-xs text-gray-400">({TYPE_LABELS[iv.interview_type] ?? iv.interview_type})</span>}
                </p>
                <p className="text-xs text-gray-400">{format(new Date(iv.scheduled_at), 'dd MMM yyyy, h:mm a')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[iv.status] ?? 'bg-gray-100 text-gray-500'}`}>
                {iv.status}
              </span>
              {iv.self_feedback_submitted ? (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Feedback shared
                </span>
              ) : canFeedback ? (
                <button
                  onClick={() => setFeedbackFor(iv)}
                  className="flex items-center gap-1 text-xs text-brand-600 font-medium hover:text-brand-700 whitespace-nowrap"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  Share feedback
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MyApplicationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [editingApp, setEditingApp] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [autoFeedbackInterview, setAutoFeedbackInterview] = useState(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['my-applications', page],
    queryFn: () => applicationsApi.mine(page, 10).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const feedbackId = searchParams.get('feedback');
    if (!feedbackId) return;
    interviewsApi.getCandidateSummary(feedbackId)
      .then((res) => {
        setAutoFeedbackInterview(res.data);
        setSearchParams({}, { replace: true });
      })
      .catch(() => setSearchParams({}, { replace: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const withdrawMut = useMutation({
    mutationFn: (id) => applicationsApi.withdraw(id),
    onSuccess: () => {
      toast.success('Application withdrawn');
      setWithdrawingId(null);
      qc.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to withdraw'),
  });

  const applications = data?.items ?? [];

  // Auto-expand the first offer-stage application
  useEffect(() => {
    if (expandedId) return;
    const offerApp = applications.find((a) => a.stage === 'offer');
    if (offerApp) setExpandedId(offerApp.id);
  }, [applications]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-3xl mx-auto">
      {autoFeedbackInterview && (
        <SelfFeedbackModal
          interview={autoFeedbackInterview}
          onClose={() => setAutoFeedbackInterview(null)}
        />
      )}
      {editingApp && (
        <EditApplicationModal
          app={editingApp}
          onClose={() => setEditingApp(null)}
          onSuccess={() => {
            setEditingApp(null);
            qc.invalidateQueries({ queryKey: ['my-applications'] });
          }}
        />
      )}
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold text-gray-900">My Applications</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {data?.total ?? 0} application{data?.total !== 1 ? 's' : ''}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-surface-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-200 p-16 text-center">
          <Briefcase className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No applications yet</p>
          <p className="text-gray-400 text-sm mt-1">Browse open positions and apply to get started.</p>
          <button
            onClick={() => navigate('/jobs')}
            className="mt-4 px-5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600"
          >
            Browse Jobs
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => {
            const isOffer = app.stage === 'offer';
            const isInterviewStage = INTERVIEW_STAGES.has(app.stage);
            const canViewInterviews = INTERVIEW_VIEWABLE_STAGES.has(app.stage);
            const isExpandable = isOffer || canViewInterviews;
            const isExpanded = expandedId === app.id;
            return (
              <div
                key={app.id}
                className={`bg-white rounded-xl border p-4 transition-all ${
                  isOffer
                    ? 'border-emerald-200 shadow-sm'
                    : 'border-surface-200 hover:border-brand-200 hover:shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isOffer ? 'bg-emerald-50' : 'bg-brand-50'
                    }`}>
                      <FileText className={`w-4 h-4 ${isOffer ? 'text-emerald-600' : 'text-brand-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">
                        {app.job_title ?? 'Position'}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <StageBadge stage={app.stage} />
                        <span className="text-xs text-gray-400">
                          Applied {format(new Date(app.applied_at), 'MMM d, yyyy')}
                        </span>
                        {app.source && app.source !== 'direct' && (
                          <span className="text-xs text-brand-600 capitalize">{app.source}</span>
                        )}
                        {isOffer && (
                          <span className="text-xs text-emerald-600 font-medium">Action required</span>
                        )}
                        {isInterviewStage && (
                          <span className="text-xs text-indigo-600 font-medium">Interview stage</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!TERMINAL_STAGES.has(app.stage) && (
                      <>
                        <button
                          onClick={() => setEditingApp(app)}
                          className="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors"
                          title="Edit application"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {withdrawingId === app.id ? (
                          <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Confirm?</span>
                            <button
                              onClick={() => withdrawMut.mutate(app.id)}
                              disabled={withdrawMut.isPending}
                              className="font-semibold hover:text-red-800 ml-1"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setWithdrawingId(null)}
                              className="text-gray-500 hover:text-gray-700 ml-1"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setWithdrawingId(app.id)}
                            className="text-xs text-gray-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            Withdraw
                          </button>
                        )}
                      </>
                    )}
                    {isExpandable ? (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : app.id)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          isOffer
                            ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'
                            : 'text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50'
                        }`}
                        title={isExpanded ? 'Collapse' : isOffer ? 'View offer actions' : 'View interviews'}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate(`/jobs/${app.job_id}`)}
                        className="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {isOffer && isExpanded && (
                  <OfferActionPanel applicationId={app.id} />
                )}
                {canViewInterviews && isExpanded && (
                  <InterviewsPanel applicationId={app.id} />
                )}
              </div>
            );
          })}
        </div>
      )}

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
