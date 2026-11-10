import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  Check, Eye, Mail, Clock, XCircle, PenLine, BellRing, RefreshCw, Undo2, Download,
  ShieldCheck, ChevronDown, Loader2, PartyPopper, Hourglass, AlertCircle, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { esignApi } from '@/api/esign';
import { offersApi } from '@/api/offers';
import { PARTY_ROLES } from '@/constants/offerStatus';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/utils';

const istTime = (v) =>
  v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

const SIGNER_STATE = {
  signed:   { icon: Check,    ring: 'bg-emerald-500 text-white border-emerald-500', text: 'text-emerald-700' },
  approved: { icon: Check,    ring: 'bg-emerald-500 text-white border-emerald-500', text: 'text-emerald-700' },
  viewed:   { icon: Eye,      ring: 'bg-white text-brand-600 border-brand-400',     text: 'text-brand-700' },
  notified: { icon: Mail,     ring: 'bg-white text-brand-600 border-brand-400',     text: 'text-brand-700' },
  pending:  { icon: Clock,    ring: 'bg-white text-gray-300 border-surface-300',    text: 'text-gray-400' },
  declined: { icon: XCircle,  ring: 'bg-white text-rose-500 border-rose-400',       text: 'text-rose-600' },
};

const EVENT_LABEL = {
  sent: 'sent the letter for signature',
  viewed: 'opened the letter',
  signed: 'signed',
  approved: 'approved',
  declined: 'declined to sign',
  completed: 'Everyone signed. The offer is accepted.',
  expired: 'The signing link expired',
  recalled: 'recalled the letter',
  reminded: 'sent a reminder',
};

function signerCaption(s, signers, request) {
  if (s.status === 'signed') return `Signed ${istTime(s.signed_at)}`;
  if (s.status === 'approved') return `Approved ${istTime(s.signed_at)}`;
  if (s.status === 'declined') return 'Declined to sign';
  if (s.action_type === 'VIEW') return request.status === 'completed' ? 'Sent the signed copy' : 'Gets the signed copy at the end';
  if (request.status !== 'inprogress') return 'Did not sign';
  if (s.status === 'viewed') return `Opened ${istTime(s.viewed_at)}, hasn't signed yet`;
  if (s.status === 'notified' || s.is_current) return 'Email sent. Waiting for them to sign';
  const before = signers.filter((x) => x.action_type !== 'VIEW' && x.signing_order < s.signing_order && !['signed', 'approved'].includes(x.status));
  return before.length ? `Gets it after ${before[before.length - 1].name.split(' ')[0]}` : 'Up next';
}

function ProgressBar({ done, total, tone = 'brand' }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-surface-100 overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
      <div
        className={cn('h-full rounded-full transition-all duration-700', tone === 'success' ? 'bg-emerald-500' : 'bg-brand-500')}
        style={{ width: `${Math.max(pct, done ? 6 : 0)}%` }}
      />
    </div>
  );
}

// Live view of a Zoho Sign envelope. `compact` drops the activity log and
// trims padding for the applicant's Offer tab.
export default function SignatureTracker({ offerId, compact = false, onViewSigned }) {
  const qc = useQueryClient();
  const [confirmRecall, setConfirmRecall] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['offer-esign', offerId],
    queryFn: () => esignApi.get(offerId).then((r) => r.data),
    enabled: Boolean(offerId),
    refetchInterval: (q) => (q.state.data?.request?.status === 'inprogress' ? 20000 : false),
  });

  const syncCaches = (detail) => {
    qc.setQueryData(['offer-esign', offerId], detail);
    qc.invalidateQueries({ queryKey: ['offer', offerId] });
    qc.invalidateQueries({ queryKey: ['offers'] });
    qc.invalidateQueries({ queryKey: ['application-offer'] });
  };
  const errMsg = (err, fallback) => (typeof err.response?.data?.detail === 'string' ? err.response.data.detail : fallback);

  const refreshMut = useMutation({
    mutationFn: () => esignApi.refresh(offerId).then((r) => r.data),
    onSuccess: (d) => { syncCaches(d); toast.success('Up to date with Zoho Sign'); },
    onError: (err) => toast.error(errMsg(err, "Couldn't reach Zoho Sign")),
  });
  const remindMut = useMutation({
    mutationFn: () => esignApi.remind(offerId).then((r) => r.data),
    onSuccess: (d) => {
      syncCaches(d);
      const who = d.signers.filter((s) => s.is_current).map((s) => s.name.split(' ')[0]);
      toast.success(`Reminder sent${who.length ? ` to ${who.join(' and ')}` : ''}`);
    },
    onError: (err) => toast.error(errMsg(err, "Couldn't send the reminder")),
  });
  const recallMut = useMutation({
    mutationFn: () => esignApi.recall(offerId).then((r) => r.data),
    onSuccess: (d) => {
      syncCaches(d);
      setConfirmRecall(false);
      toast.success('Recalled. The letter is editable again.');
    },
    onError: (err) => { setConfirmRecall(false); toast.error(errMsg(err, "Couldn't recall the letter")); },
  });
  const pdfMut = useMutation({
    mutationFn: () => offersApi.downloadPdf(offerId),
    onError: () => toast.error("Couldn't fetch the signed PDF from Zoho Sign. Try again in a moment."),
  });
  const certMut = useMutation({
    mutationFn: () => esignApi.downloadCertificate(offerId),
    onError: () => toast.error("Couldn't fetch the certificate from Zoho Sign. Try again in a moment."),
  });

  if (isLoading) {
    return <div className="bg-white border border-surface-200 rounded-2xl p-5 h-40 animate-pulse" />;
  }
  const request = data?.request;
  if (!request) return null;

  const signers = data.signers ?? [];
  const live = request.status === 'inprogress';
  const done = request.status === 'completed';
  const current = signers.filter((s) => s.is_current);
  const expiresIn = request.expires_at ? formatDistanceToNowStrict(new Date(request.expires_at)) : null;
  const remindedRecently = request.last_reminded_at && Date.now() - new Date(request.last_reminded_at).getTime() < 3600_000;

  const header = {
    inprogress: { label: 'Out for signature', tone: 'text-brand-700 bg-brand-50', icon: PenLine },
    completed:  { label: 'Fully signed',       tone: 'text-emerald-700 bg-emerald-50', icon: ShieldCheck },
    declined:   { label: 'Declined',           tone: 'text-rose-700 bg-rose-50', icon: XCircle },
    expired:    { label: 'Expired',            tone: 'text-yellow-700 bg-yellow-50', icon: Hourglass },
    recalled:   { label: 'Recalled',           tone: 'text-gray-600 bg-surface-100', icon: Undo2 },
    failed:     { label: 'Needs attention',    tone: 'text-rose-700 bg-rose-50', icon: AlertCircle },
  }[request.status] ?? { label: request.status, tone: 'text-gray-600 bg-surface-100', icon: PenLine };
  const HeaderIcon = header.icon;

  return (
    <div className={cn('bg-white border border-surface-200 rounded-2xl overflow-hidden', done && 'border-emerald-200')}>
      {/* Header */}
      <div className={cn('px-5 pt-4 pb-3', compact && 'px-4')}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Zoho Sign</p>
            <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5', header.tone)}>
              <HeaderIcon className="w-3 h-3" /> {header.label}
            </span>
          </div>
          {live && (
            <button
              type="button"
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}
              title={request.last_synced_at ? `Last checked ${istTime(request.last_synced_at)} IST` : 'Check Zoho Sign now'}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-surface-100 disabled:opacity-50"
              aria-label="Refresh status from Zoho Sign"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshMut.isPending && 'animate-spin')} />
            </button>
          )}
        </div>

        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <p className="text-sm font-semibold text-gray-900">
            {request.signed_count} of {request.total_signers} signed
          </p>
          {live && expiresIn && <p className="text-[11px] text-gray-500">Expires in {expiresIn}</p>}
          {done && request.completed_at && <p className="text-[11px] text-emerald-700">{istTime(request.completed_at)} IST</p>}
        </div>
        <ProgressBar done={request.signed_count} total={request.total_signers} tone={done ? 'success' : 'brand'} />
        {live && current.length > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            Now with <span className="font-semibold text-gray-800">{current.map((s) => s.name).join(', ')}</span>
          </p>
        )}
      </div>

      {/* Completed celebration */}
      {done && (
        <div className={cn('mx-5 mb-4 rounded-xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 p-4', compact && 'mx-4')}>
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 animate-in zoom-in-50 duration-300">
              <PartyPopper className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-900">Signed by everyone</p>
              <p className="text-xs text-emerald-800/80 mt-0.5">The signed PDF and Zoho's audit certificate stay in Zoho Sign and open straight from there.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {onViewSigned && (
              <button type="button" onClick={onViewSigned} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-lg hover:bg-emerald-50">
                <FileText className="w-3.5 h-3.5" /> View
              </button>
            )}
            <button
              type="button"
              onClick={() => pdfMut.mutate()}
              disabled={pdfMut.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-60"
            >
              {pdfMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Signed PDF
            </button>
            {request.has_signed_pdf && (
              <button
                type="button"
                onClick={() => certMut.mutate()}
                disabled={certMut.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-lg hover:bg-emerald-50 disabled:opacity-60"
              >
                {certMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Certificate
              </button>
            )}
          </div>
        </div>
      )}

      {/* Party timeline */}
      <ol className={cn('px-5 pb-4', compact && 'px-4')}>
        {signers.map((s, i) => {
          const st = SIGNER_STATE[s.status] ?? SIGNER_STATE.pending;
          const Icon = s.action_type === 'VIEW' && !['declined'].includes(s.status) ? Mail : st.icon;
          const isLast = i === signers.length - 1;
          return (
            <li key={s.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'relative w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0',
                    s.action_type === 'VIEW' ? 'bg-surface-50 text-gray-400 border-surface-200' : st.ring
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {s.is_current && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand-500 ring-2 ring-white animate-pulse" />}
                </span>
                {!isLast && <span className={cn('w-0.5 flex-1 min-h-[14px] my-1', ['signed', 'approved'].includes(s.status) ? 'bg-emerald-300' : 'bg-surface-200')} />}
              </div>
              <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-3')}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className={cn('text-sm font-semibold truncate', s.status === 'pending' && !s.is_current ? 'text-gray-500' : 'text-gray-900')}>{s.name}</p>
                  <span className={cn('text-[10px] font-semibold rounded-full border px-1.5 py-px', PARTY_ROLES[s.role]?.tone)}>
                    {PARTY_ROLES[s.role]?.short ?? s.role}
                  </span>
                </div>
                {!compact && <p className="text-[11px] text-gray-400 truncate">{s.email}</p>}
                <p className={cn('text-xs mt-0.5', st.text)}>{signerCaption(s, signers, request)}</p>
                {s.status === 'declined' && s.decline_reason && (
                  <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5 mt-1.5">"{s.decline_reason}"</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Actions */}
      {live && (
        <div className={cn('flex flex-wrap items-center gap-2 px-5 py-3 border-t border-surface-100 bg-surface-50/60', compact && 'px-4')}>
          <button
            type="button"
            onClick={() => remindMut.mutate()}
            disabled={remindMut.isPending || remindedRecently}
            title={remindedRecently ? `Reminded ${istTime(request.last_reminded_at)}. You can nudge again an hour later.` : undefined}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-surface-200 text-gray-700 text-xs font-semibold rounded-lg hover:bg-surface-50 disabled:opacity-50"
          >
            {remindMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
            {remindedRecently ? 'Reminder sent' : 'Send reminder'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmRecall(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-rose-600 text-xs font-semibold rounded-lg hover:bg-rose-50"
          >
            <Undo2 className="w-3.5 h-3.5" /> Recall & edit
          </button>
        </div>
      )}

      {/* Activity log */}
      {!compact && data.events?.length > 0 && (
        <div className="border-t border-surface-100">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-2.5 text-xs font-semibold text-gray-500 hover:text-gray-800"
            aria-expanded={showLog}
          >
            Activity ({data.events.length})
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showLog && 'rotate-180')} />
          </button>
          {showLog && (
            <ul className="px-5 pb-4 space-y-2">
              {data.events.map((e) => {
                const actorless = ['completed', 'expired'].includes(e.event_type);
                return (
                  <li key={e.id} className="text-xs text-gray-600 flex gap-2">
                    <span className="text-gray-400 whitespace-nowrap tabular-nums w-24 shrink-0">{istTime(e.occurred_at)}</span>
                    <span className="min-w-0">
                      {!actorless && <span className="font-semibold text-gray-800">{e.actor_name ?? e.actor_email ?? 'Zoho Sign'} </span>}
                      {EVENT_LABEL[e.event_type] ?? e.event_type}
                      {e.detail && !actorless && e.event_type !== 'declined' && <span className="text-gray-400"> · {e.detail}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {confirmRecall && (
        <ConfirmDialog
          danger
          title="Recall this letter?"
          message={`Zoho Sign cancels the signing links${current.length ? `, including the one ${current[0].name.split(' ')[0]} has now` : ''}. Signatures already made are discarded. You can edit the letter and send it again.`}
          confirmLabel="Recall"
          isPending={recallMut.isPending}
          onConfirm={() => recallMut.mutate()}
          onCancel={() => setConfirmRecall(false)}
        />
      )}
    </div>
  );
}
