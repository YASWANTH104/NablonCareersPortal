import { AlertTriangle, Loader2 } from 'lucide-react';

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  isPending = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 sm:p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
            danger ? 'bg-red-50' : 'bg-amber-50'
          }`}>
            <AlertTriangle className={`w-4.5 h-4.5 ${danger ? 'text-red-500' : 'text-amber-500'}`} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900">{title}</h3>
            {message && <p className="text-sm text-gray-500 mt-1">{message}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-60 transition-colors ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
