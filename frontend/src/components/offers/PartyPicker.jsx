import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, UserPlus, Mail, ArrowLeft, AlertCircle, Check } from 'lucide-react';
import { esignApi } from '@/api/esign';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/lib/utils';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

const inputClass =
  'w-full px-3 py-2.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 placeholder:text-gray-400';

// Search the Zoho Sign org's users, or add anyone else by name + email.
// `takenEmails` greys out people already on the envelope; `onPick` receives
// { name, email, source } and the parent decides the role.
export default function PartyPicker({ takenEmails = [], onPick, onCancel, title = 'Add a party' }) {
  const [mode, setMode] = useState('search'); // search | manual
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [manual, setManual] = useState({ name: '', email: '' });
  const [manualError, setManualError] = useState('');
  const inputRef = useRef(null);
  const nameRef = useRef(null);
  const debouncedQ = useDebounced(q, 250);

  const { data: users = [], isFetching, isError, error } = useQuery({
    queryKey: ['zoho-users', debouncedQ],
    queryFn: () => esignApi.searchZohoUsers(debouncedQ).then((r) => r.data),
    enabled: mode === 'search',
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const taken = useMemo(() => new Set(takenEmails.map((e) => e.toLowerCase())), [takenEmails]);
  const results = users.filter((u) => !taken.has(u.email));

  useEffect(() => { setActive(0); }, [debouncedQ]);
  useEffect(() => {
    if (mode === 'search') inputRef.current?.focus();
    else nameRef.current?.focus();
  }, [mode]);

  // Only name + email cross over — a Zoho user's own `role` (Admin/User) is not their part in the envelope
  const pickUser = (u) => onPick({ name: u.name, email: u.email, source: 'zoho_user' });

  const goManual = () => {
    const typed = q.trim();
    setManual({
      name: EMAIL_RE.test(typed) ? '' : typed,
      email: EMAIL_RE.test(typed) ? typed.toLowerCase() : '',
    });
    setManualError('');
    setMode('manual');
  };

  const submitManual = (e) => {
    e?.preventDefault();
    const name = manual.name.trim();
    const email = manual.email.trim().toLowerCase();
    if (!name) return setManualError('Add their full name — it appears on the signature line.');
    if (!EMAIL_RE.test(email)) return setManualError("That email address doesn't look right.");
    if (taken.has(email)) return setManualError('This person is already on the list.');
    onPick({ name, email, source: 'manual' });
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active < results.length) pickUser(results[active]);
      else goManual();
    } else if (e.key === 'Escape') { e.stopPropagation(); onCancel?.(); }
  };

  return (
    <div className="rounded-xl border border-brand-200 bg-white shadow-card overflow-hidden animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-surface-100 bg-brand-50/40">
        <p className="text-xs font-semibold text-gray-700">{title}</p>
        <button type="button" onClick={onCancel} className="text-xs font-medium text-gray-500 hover:text-gray-800">
          Cancel
        </button>
      </div>

      {mode === 'search' ? (
        <>
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search your Zoho Sign team by name or email"
                className={cn(inputClass, 'pl-9')}
                aria-label="Search Zoho Sign users"
              />
              {isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />}
            </div>
          </div>

          <ul className="max-h-56 overflow-y-auto px-1.5 pb-1.5" role="listbox">
            {isError && (
              <li className="mx-1.5 mb-1.5 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                <span>
                  {error?.response?.data?.detail ?? "Couldn't load people from Zoho Sign."} You can still add someone by email below.
                </span>
              </li>
            )}
            {!isError && !isFetching && results.length === 0 && (
              <li className="px-3 py-3 text-xs text-gray-400 text-center">
                {debouncedQ ? `No one in Zoho Sign matches "${debouncedQ}".` : 'No one else in Zoho Sign to add.'}
              </li>
            )}
            {results.map((u, i) => (
              <li key={u.email} role="option" aria-selected={active === i}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pickUser(u)}
                  className={cn(
                    'w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors',
                    active === i ? 'bg-brand-50' : 'hover:bg-surface-50'
                  )}
                >
                  <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center shrink-0">
                    {initials(u.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900 truncate">{u.name}</span>
                    <span className="block text-xs text-gray-500 truncate">{u.email}</span>
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 bg-brand-50 border border-brand-100 rounded px-1.5 py-0.5 shrink-0">
                    Zoho
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={goManual}
            onMouseEnter={() => setActive(results.length)}
            className={cn(
              'w-full flex items-center gap-2.5 px-4 py-3 border-t border-surface-100 text-left text-sm transition-colors',
              active === results.length ? 'bg-surface-50' : 'hover:bg-surface-50'
            )}
          >
            <span className="w-8 h-8 rounded-full border border-dashed border-surface-300 flex items-center justify-center shrink-0">
              <UserPlus className="w-4 h-4 text-gray-500" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-gray-800">
                {EMAIL_RE.test(q.trim()) ? <>Add <span className="text-brand-600">{q.trim()}</span></> : 'Someone outside Zoho?'}
              </span>
              <span className="block text-xs text-gray-500">Add any name and email — Zoho Sign emails them a signing link</span>
            </span>
          </button>
        </>
      ) : (
        <form onSubmit={submitManual} className="p-3.5 space-y-3">
          <div className="grid sm:grid-cols-2 gap-2.5">
            <input
              ref={nameRef}
              value={manual.name}
              onChange={(e) => { setManual({ ...manual, name: e.target.value }); setManualError(''); }}
              placeholder="Full name"
              className={inputClass}
              aria-label="Full name"
            />
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                value={manual.email}
                onChange={(e) => { setManual({ ...manual, email: e.target.value }); setManualError(''); }}
                placeholder="name@company.com"
                className={cn(inputClass, 'pl-9')}
                aria-label="Email"
              />
            </div>
          </div>
          {manualError && (
            <p className="flex items-center gap-1 text-xs text-rose-600">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {manualError}
            </p>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMode('search')}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Zoho search
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
            >
              <Check className="w-4 h-4" /> Add
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
