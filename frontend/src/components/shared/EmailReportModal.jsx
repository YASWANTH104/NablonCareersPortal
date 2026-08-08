import { useState } from 'react';
import { Mail, X, Loader2 } from 'lucide-react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Splits on comma, whitespace, or newline — lets someone paste a whole list
// of addresses (from a spreadsheet, Slack, an email "To" line, etc.) in one go.
function splitEmails(raw) {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * "Email this report to…" modal — an open-ended number of recipients via a
 * chip/tag input (type + Enter/comma to add, paste a list to add many at once,
 * click × or Backspace-on-empty to remove).
 */
export default function EmailReportModal({ reportLabel, onSend, onClose, isPending }) {
  const [emails, setEmails] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');

  const addEmails = (raw) => {
    const candidates = splitEmails(raw);
    if (candidates.length === 0) return;

    const valid = [];
    const invalid = [];
    candidates.forEach((c) => {
      const normalized = c.toLowerCase();
      if (!EMAIL_RE.test(normalized)) {
        invalid.push(c);
      } else if (!emails.includes(normalized)) {
        valid.push(normalized);
      }
    });

    if (valid.length) setEmails((prev) => [...prev, ...valid]);
    setError(invalid.length ? `Not a valid email: ${invalid.join(', ')}` : '');
    setInputValue('');
  };

  const removeEmail = (email) => setEmails((prev) => prev.filter((e) => e !== email));

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      if (inputValue.trim()) {
        e.preventDefault();
        addEmails(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      removeEmail(emails[emails.length - 1]);
    }
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text');
    if (splitEmails(text).length > 1) {
      e.preventDefault();
      addEmails(text);
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) addEmails(inputValue);
  };

  const handleSend = () => {
    // Commit anything still sitting in the input before sending.
    const pending = inputValue.trim() ? splitEmails(inputValue) : [];
    const all = [...emails];
    pending.forEach((c) => {
      const normalized = c.toLowerCase();
      if (EMAIL_RE.test(normalized) && !all.includes(normalized)) all.push(normalized);
    });
    if (all.length === 0) {
      setError('Add at least one recipient');
      return;
    }
    onSend(all);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-md z-10">
        <div className="flex items-start gap-3 p-5 sm:p-6 pb-4">
          <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Mail className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-gray-900">Email report</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Send <span className="font-medium text-gray-700">{reportLabel}</span> as an Excel attachment.
            </p>
          </div>
        </div>

        <div className="px-6 pb-2">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Recipients <span className="text-gray-400 font-normal">(any number — press Enter or paste a list)</span>
          </label>
          <div
            className="flex flex-wrap gap-1.5 w-full min-h-[42px] px-2.5 py-2 border border-surface-300 rounded-lg focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent"
            onClick={(e) => e.currentTarget.querySelector('input')?.focus()}
          >
            {emails.map((email) => (
              <span
                key={email}
                className="flex items-center gap-1 bg-brand-50 text-brand-700 text-xs font-medium px-2 py-1 rounded-md"
              >
                {email}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeEmail(email); }}
                  className="text-brand-400 hover:text-brand-700"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setError(''); }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={handleBlur}
              placeholder={emails.length === 0 ? 'name@company.com' : ''}
              className="flex-1 min-w-[120px] text-sm text-gray-900 placeholder-gray-400 outline-none py-0.5"
            />
          </div>
          {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
          {emails.length > 0 && (
            <p className="text-xs text-gray-400 mt-1.5">{emails.length} recipient{emails.length !== 1 ? 's' : ''}</p>
          )}
        </div>

        <div className="flex gap-3 justify-end px-6 py-4 border-t border-surface-100 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-lg disabled:opacity-60 transition-colors"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
