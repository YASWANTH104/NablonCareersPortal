import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Inbox, CalendarPlus, X, Loader2, Building2, Users, CalendarRange, Clock, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { interviewSlotsApi } from '@/api/interviewSlots';
import { ROUND_MAP } from '@/constants/interviewRounds';
import { formatIST } from '@/utils/formatters';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/utils';

const TIME_PREF = { any: 'Any time', morning: 'Mornings', afternoon: 'Afternoons', evening: 'Evenings' };

export const AGENCY_REQUESTS_KEY = ['agency-slot-requests-hr', 'open'];

export function useOpenAgencyRequests(enabled = true) {
  return useQuery({
    queryKey: AGENCY_REQUESTS_KEY,
    queryFn: () => interviewSlotsApi.agencyRequests('open').then((r) => r.data),
    enabled,
    refetchInterval: 60000,
  });
}

// Requests agencies raised from their portal for interview times. "Fill this"
// points the publish panel at that job + round; publishing there closes the
// request and emails the agency on its own. Dismiss is for requests HR won't act on.
export default function AgencySlotRequestsInbox({ highlightId, onFill }) {
  const qc = useQueryClient();
  const { data } = useOpenAgencyRequests();
  const [dismissing, setDismissing] = useState(null);
  const [note, setNote] = useState('');

  const dismissMut = useMutation({
    mutationFn: ({ id, note: n }) => interviewSlotsApi.resolveAgencyRequest(id, { status: 'dismissed', note: n || null }),
    onSuccess: () => {
      toast.success('Dismissed. The agency has been emailed.');
      setDismissing(null);
      setNote('');
      qc.invalidateQueries({ queryKey: AGENCY_REQUESTS_KEY });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Could not dismiss the request'),
  });

  const items = data?.items ?? [];
  if (!items.length) return null;

  return (
    <section className="bg-white rounded-2xl border border-amber-200 overflow-hidden mb-4">
      <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-amber-100 bg-amber-50/60">
        <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
          <Inbox className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display font-semibold text-gray-900 text-sm">
            Agencies are asking for slots <span className="text-amber-700">({items.length})</span>
          </h2>
          <p className="text-xs text-gray-500">Publishing slots for the same role and round closes a request and tells the agency automatically.</p>
        </div>
      </div>
      <ul className="divide-y divide-surface-100">
        {items.map((r) => {
          const round = ROUND_MAP[r.round_type];
          return (
            <li
              key={r.id}
              className={cn('px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3', r.id === highlightId && 'bg-brand-50/50')}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-lg border', round?.accent?.badge ?? 'bg-surface-100 text-gray-600 border-surface-200')}>
                    {round?.label ?? r.round_label}
                  </span>
                  <p className="text-sm font-semibold text-gray-900 truncate">{r.job_title}</p>
                  <span className="text-[11px] text-gray-400">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                </div>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 mt-1.5">
                  <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5 text-gray-400" />{r.agency_name}</span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5 text-gray-400" />{r.candidates_count} candidate{r.candidates_count !== 1 ? 's' : ''}</span>
                  <span className="inline-flex items-center gap-1"><CalendarRange className="w-3.5 h-3.5 text-gray-400" />{formatIST(r.date_from, 'd MMM')} – {formatIST(r.date_to, 'd MMM')}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-gray-400" />{TIME_PREF[r.time_preference] ?? r.time_preference}</span>
                </p>
                {r.note && <p className="text-xs text-gray-500 mt-1.5">"{r.note}"</p>}
                {r.open_slots_now > 0 && (
                  <p className="inline-flex items-center gap-1 text-[11px] text-amber-700 mt-1.5">
                    <AlertCircle className="w-3 h-3" />
                    {r.open_slots_now} time{r.open_slots_now !== 1 ? 's are' : ' is'} already open for this role. They may not suit the dates asked for.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onFill?.(r)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600"
                >
                  <CalendarPlus className="w-3.5 h-3.5" /> Publish for this
                </button>
                <button
                  type="button"
                  onClick={() => { setDismissing(r); setNote(''); }}
                  className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-gray-500 hover:text-gray-800 rounded-lg hover:bg-surface-100"
                >
                  <X className="w-3.5 h-3.5" /> Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {dismissing && (
        <Modal
          onClose={dismissMut.isPending ? undefined : () => setDismissing(null)}
          size="md"
          title="Dismiss this request?"
          description={`${dismissing.agency_name} will be emailed that no new ${dismissing.round_label} times are coming for ${dismissing.job_title}.`}
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDismissing(null)} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800">Cancel</button>
              <button
                type="button"
                disabled={dismissMut.isPending}
                onClick={() => dismissMut.mutate({ id: dismissing.id, note: note.trim() })}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-60"
              >
                {dismissMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Dismiss & notify
              </button>
            </div>
          }
        >
          <label className="block">
            <span className="text-xs font-semibold text-gray-700">Note to the agency <span className="font-normal text-gray-400">(optional)</span></span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="e.g. The role is on hold this week. We'll open TR1 slots from Monday."
              className="mt-1.5 w-full px-3 py-2.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
            />
          </label>
        </Modal>
      )}
    </section>
  );
}
