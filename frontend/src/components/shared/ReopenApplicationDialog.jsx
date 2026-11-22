import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import {
  STAGE_MAP, REOPEN_TARGET_STAGES, REOPEN_REASON_CATEGORIES, REOPEN_REASON_MIN_LEN,
} from '@/constants/pipelineStages';

// Reopen a rejected application into any live stage. The reason (category +
// written explanation) is mandatory — it lands in the stage history together
// with the original rejection reason, so the trail shows why the decision was
// reversed. `rejectedFromStage` preselects the stage the candidate was
// rejected from, which is the common case; HR can pick any other.
export default function ReopenApplicationDialog({
  candidateName,
  rejectedFromStage,
  rejectionReason,
  onConfirm,
  onCancel,
  isPending,
}) {
  const [stage, setStage] = useState(
    REOPEN_TARGET_STAGES.includes(rejectedFromStage) ? rejectedFromStage : ''
  );
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(false);

  const reasonOk = reason.trim().length >= REOPEN_REASON_MIN_LEN;
  const canConfirm = !!stage && !!category && reasonOk;

  const fieldCls =
    'w-full px-3 py-2 border border-surface-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-lg z-10 flex flex-col max-h-[90dvh]">
        <div className="flex items-start gap-3 p-5 sm:p-6 pb-4 flex-shrink-0">
          <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-brand-50">
            <RotateCcw className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-gray-900">
              Reopen application for <span className="text-brand-700">{candidateName}</span>
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Moves the candidate out of Rejected into the stage you choose. The reason is saved to the timeline.
            </p>
          </div>
        </div>

        <div className="overflow-y-auto px-5 sm:px-6 pb-2 space-y-4 flex-1">
          {rejectionReason && (
            <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2">
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-0.5">
                Rejected{rejectedFromStage ? ` at ${STAGE_MAP[rejectedFromStage]?.label ?? rejectedFromStage}` : ''}
              </p>
              <p className="text-sm text-red-800 whitespace-pre-line line-clamp-4">{rejectionReason}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Move to stage <span className="text-red-500">*</span>
            </label>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={fieldCls}>
              <option value="">Select a stage…</option>
              {REOPEN_TARGET_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_MAP[s]?.label ?? s}{s === rejectedFromStage ? ' (rejected from here)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldCls}>
              <option value="">Select a reason…</option>
              {REOPEN_REASON_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Explanation <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this application being reopened?"
              className={`${fieldCls} placeholder-gray-400 resize-none`}
            />
            {!reasonOk && reason.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">At least {REOPEN_REASON_MIN_LEN} characters.</p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="mt-0.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              Email the candidate that their application is active again (also notifies them in the portal, and the agency if agency-sourced)
            </span>
          </label>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end px-5 sm:px-6 py-4 border-t border-surface-100 flex-shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ stage, reason_category: category, reason: reason.trim(), notify_candidate: notify })}
            disabled={isPending || !canConfirm}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Reopen application
          </button>
        </div>
      </div>
    </div>
  );
}
