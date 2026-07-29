import { useState } from 'react';
import { Loader2, XCircle, UserMinus } from 'lucide-react';
import { DROP_REASON_CATEGORIES, STAGE_MAP } from '@/constants/pipelineStages';

// Reusable reason-capture dialog for any transition into a "closed with a
// reason" stage (rejected / interview_drop / offer_drop). For `rejected` it
// also shows interviewer feedback so HR can review before confirming — the
// category/note are optional there to avoid changing the existing reject
// flow's contract; for interview_drop/offer_drop a category is required,
// since the whole point of those stages is a reportable reason.
export default function StageReasonDialog({
  stage,
  candidateName,
  interviews = [],
  onConfirm,
  onCancel,
  isPending,
}) {
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');

  const isReject = stage === 'rejected';
  const stageInfo = STAGE_MAP[stage];
  const categoryRequired = !isReject;
  const canConfirm = !categoryRequired || !!category;

  const withFeedback = interviews.filter((iv) => iv.feedback?.length > 0);
  const noFeedback = interviews.filter((iv) => !iv.feedback?.length);

  const title = isReject ? (
    <>Reject <span className="text-red-600">{candidateName}</span></>
  ) : (
    <>Move <span className="text-gray-900">{candidateName}</span> to {stageInfo?.label ?? stage}</>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-lg z-10 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start gap-3 p-6 pb-4 flex-shrink-0">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isReject ? 'bg-red-100' : 'bg-amber-100'}`}>
            {isReject ? <XCircle className="w-5 h-5 text-red-600" /> : <UserMinus className="w-5 h-5 text-amber-600" />}
          </div>
          <div>
            <h3 className="font-display font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {isReject ? 'Review interviewer feedback before confirming.' : 'Capture why the candidate dropped out.'}
            </p>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto px-6 pb-2 space-y-4 flex-1">
          {isReject && (
            interviews.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No interviews on record for this candidate.</p>
            ) : (
              <>
                {withFeedback.map((iv) => (
                  <div key={iv.id} className="border border-surface-200 rounded-xl overflow-hidden">
                    <div className="bg-surface-50 px-4 py-2.5 flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-800">
                        Round {iv.round_number}{iv.title ? ` — ${iv.title}` : ''}
                      </span>
                      <span className="text-xs text-gray-400">{iv.feedback.length} response{iv.feedback.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="divide-y divide-surface-100">
                      {iv.feedback.map((fb, idx) => (
                        <div key={fb.id ?? idx} className="px-4 py-3 space-y-2.5">
                          {fb.strengths && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Strengths</p>
                              <p className="text-sm text-gray-700 leading-relaxed">{fb.strengths}</p>
                            </div>
                          )}
                          {fb.weaknesses && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Areas for Growth</p>
                              <p className="text-sm text-gray-700 leading-relaxed">{fb.weaknesses}</p>
                            </div>
                          )}
                          {fb.notes && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Notes</p>
                              <p className="text-sm text-gray-700 leading-relaxed">{fb.notes}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {noFeedback.map((iv) => (
                  <div key={iv.id} className="border border-dashed border-surface-300 rounded-xl px-4 py-3 text-sm text-gray-400">
                    Round {iv.round_number}{iv.title ? ` — ${iv.title}` : ''}: no feedback submitted yet
                  </div>
                ))}
              </>
            )
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Reason {categoryRequired && <span className="text-red-500">*</span>}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select a reason…</option>
              {DROP_REASON_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Any extra context…"
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-surface-100 flex-shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ category: category || undefined, note: note || undefined })}
            disabled={isPending || !canConfirm}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-60 transition-colors ${
              isReject ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isReject ? 'Confirm rejection' : `Confirm ${stageInfo?.label ?? stage}`}
          </button>
        </div>
      </div>
    </div>
  );
}
