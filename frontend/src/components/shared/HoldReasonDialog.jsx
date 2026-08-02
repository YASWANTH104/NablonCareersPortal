import { useState } from 'react';

export default function HoldReasonDialog({ candidateName, isPending, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-bold text-gray-900 mb-1">Put {candidateName} on hold</h3>
        <p className="text-xs text-gray-500 mb-3">
          They'll stay in their current stage — just flagged as paused until you resume. No one can move
          them to another stage while on hold.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional) — e.g. waiting on budget approval"
          rows={3}
          className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason.trim() || undefined)}
            disabled={isPending}
            className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-60 transition-colors"
          >
            Put on hold
          </button>
        </div>
      </div>
    </div>
  );
}
