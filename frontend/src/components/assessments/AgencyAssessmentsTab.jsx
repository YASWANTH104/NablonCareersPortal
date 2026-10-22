import { useMemo, useState } from 'react';
import { ClipboardCheck, Hourglass, CheckCircle2, XCircle, TimerOff, Send } from 'lucide-react';
import { EmptyState, Segmented, StatTile } from '@/components/ui';
import { ScoreBar, TrustChip, ViolationBadge, DecisionBadge } from '@/components/assessments/AutoproctorResult';
import { formatIST } from '@/utils/formatters';
import { cn } from '@/lib/utils';

const th = 'px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap';
const DONE = new Set(['completed', 'evaluated', 'submitted']);

function statusOf(a) {
  if (a.status === 'pending') return 'awaiting';
  if (a.status === 'expired') return 'expired';
  if (DONE.has(a.status)) return 'completed';
  return 'other';
}

function DueCell({ a }) {
  if (a.status === 'expired') return <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Not completed in time</span>;
  if (DONE.has(a.status)) {
    return <span className="text-xs text-gray-600 whitespace-nowrap">Submitted {a.completed_at ? formatIST(a.completed_at, 'dd MMM') : ''}</span>;
  }
  if (!a.deadline) return <span className="text-xs font-medium text-amber-700">Awaiting submission</span>;
  const days = Math.ceil((new Date(a.deadline).getTime() - Date.now()) / 86400000);
  return (
    <span className={cn('text-xs font-medium whitespace-nowrap', days <= 1 ? 'text-rose-700' : 'text-amber-700')}>
      {days > 0 ? `Due in ${days} day${days === 1 ? '' : 's'}` : 'Deadline passed'}
      <span className="block text-[11px] font-normal text-gray-400">Due {formatIST(a.deadline, 'dd MMM')}</span>
    </span>
  );
}

// The agency's view of its candidates' assessments: who has one, who still
// has to submit (so they can chase), and how each result went. Built from the
// agency payload, which carries headline numbers only — never questions or
// answers.
export default function AgencyAssessmentsTab({ candidates }) {
  const [filter, setFilter] = useState('all');
  const rows = useMemo(
    () => candidates.filter((c) => c.assessment)
      .sort((x, y) => new Date(y.assessment.sent_at) - new Date(x.assessment.sent_at)),
    [candidates],
  );
  const counts = useMemo(() => {
    const out = { awaiting: 0, completed: 0, expired: 0, cleared: 0, below: 0 };
    for (const c of rows) {
      out[statusOf(c.assessment)] = (out[statusOf(c.assessment)] ?? 0) + 1;
      if (c.assessment.decision === 'advanced') out.cleared += 1;
      if (c.assessment.decision === 'rejected') out.below += 1;
    }
    return out;
  }, [rows]);
  const shown = filter === 'all' ? rows : rows.filter((c) => statusOf(c.assessment) === filter);

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-surface-200 rounded-2xl">
        <EmptyState
          icon={ClipboardCheck}
          title="No assessments sent yet"
          description="When one of your candidates is moved to the Assessment stage, their test is sent automatically and shows up here with its deadline and result."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <StatTile icon={Send} tone="brand" label="Sent" value={rows.length} />
        <StatTile icon={Hourglass} tone="amber" label="Awaiting" value={counts.awaiting} onClick={() => setFilter('awaiting')} active={filter === 'awaiting'} />
        <StatTile icon={CheckCircle2} tone="emerald" label="Cleared" value={counts.cleared} onClick={() => setFilter('completed')} active={filter === 'completed'} />
        <StatTile icon={XCircle} tone="rose" label="Below bar" value={counts.below} onClick={() => setFilter('completed')} />
        <StatTile icon={TimerOff} tone="slate" label="Not done" value={counts.expired} onClick={() => setFilter('expired')} active={filter === 'expired'} />
      </div>

      <div className="-mx-1 px-1 overflow-x-auto">
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All (${rows.length})` },
            { value: 'awaiting', label: `Awaiting (${counts.awaiting})` },
            { value: 'completed', label: `Completed (${counts.completed})` },
            { value: 'expired', label: `Not completed (${counts.expired})` },
          ]}
        />
      </div>

      <div className="bg-white border border-surface-200 rounded-2xl overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState compact icon={ClipboardCheck} title="Nobody here" description="Try another filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50">
                  <th className={th}>Candidate · test</th>
                  <th className={th}>Sent</th>
                  <th className={th}>Status</th>
                  <th className={th}>Score</th>
                  <th className={th}>Trust · flags</th>
                  <th className={th}>Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {shown.map((c) => {
                  const a = c.assessment;
                  const graded = DONE.has(a.status) && a.graded !== false;
                  return (
                    <tr key={c.application_id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{c.candidate_name}</p>
                        <p className="text-[11px] text-gray-500">{a.title}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{formatIST(a.sent_at, 'dd MMM')}</td>
                      <td className="px-4 py-3"><DueCell a={a} /></td>
                      <td className="px-4 py-3">
                        {graded ? <ScoreBar pct={a.score_pct} points={a.points_scored} max={a.points_available} />
                          : DONE.has(a.status) ? <span className="text-xs text-amber-700">Being graded</span>
                            : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {graded ? (
                          <span className="flex flex-col items-start gap-1">
                            <TrustChip pct={a.trust_pct} />
                            <ViolationBadge total={a.flags} />
                          </span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {a.decision ? <DecisionBadge decision={a.decision} /> : <span className="text-xs text-gray-400">{a.status === 'pending' ? 'Pending' : '—'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-gray-400">
        Candidates clear the assessment with a score of at least 75% and a trust score of at least 90%. Results update every night.
      </p>
    </div>
  );
}
