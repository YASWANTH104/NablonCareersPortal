import { PIPELINE_STAGES } from '@/constants/pipelineViz';
import { cn } from '@/lib/utils';

/**
 * Stacked outcome bar for a set of agency submissions, with the legend that
 * makes it legible: label + count per stage, so identity never rests on hue
 * (see constants/pipelineViz for the measured reason this is mandatory).
 *
 * `size="sm"` drops to a bar plus inline counts for dense table rows;
 * `size="md"` gives each stage its own labelled legend line.
 */
export default function PipelineFunnel({ counts, total, size = 'md', layout = 'grid', className }) {
  const sum = total ?? PIPELINE_STAGES.reduce((s, st) => s + (counts?.[st.key] ?? 0), 0);

  if (!sum) {
    return (
      <p className={cn('text-xs text-gray-400', className)}>
        Nothing submitted yet
      </p>
    );
  }

  const present = PIPELINE_STAGES.filter((s) => (counts?.[s.key] ?? 0) > 0);

  return (
    <div className={cn('min-w-0', className)}>
      {/* 2px gaps between fills keep adjacent segments separable without a
          border, per the mark spec. */}
      <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-surface-100">
        {present.map((s) => {
          const value = counts[s.key];
          return (
            <div
              key={s.key}
              style={{ width: `${(value / sum) * 100}%`, backgroundColor: s.color }}
              title={`${s.label}: ${value} of ${sum}`}
            />
          );
        })}
      </div>

      {size === 'sm' ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-1.5">
          {present.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="font-semibold text-gray-700 tabular-nums">{counts[s.key]}</span>
              {s.label.toLowerCase()}
            </span>
          ))}
        </div>
      ) : layout === 'stack' ? (
        <dl className="mt-2.5 divide-y divide-surface-100">
          {PIPELINE_STAGES.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 py-1.5">
              <dt className="flex items-center gap-2 min-w-0 text-xs text-gray-600">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="truncate">{s.label}</span>
              </dt>
              <dd className="font-display text-sm font-bold text-gray-900 tabular-nums shrink-0">
                {counts?.[s.key] ?? 0}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="grid grid-cols-3 gap-2 mt-3">
          {PIPELINE_STAGES.map((s) => (
            <div key={s.key} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-[11px] text-gray-500 truncate">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                {s.label}
              </dt>
              <dd className="font-display text-lg font-bold text-gray-900 tabular-nums mt-0.5">
                {counts?.[s.key] ?? 0}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Submission-cap meter. A single magnitude against a known maximum — a meter,
 * not a chart — so it carries its numbers as text and uses one hue.
 */
export function QuotaMeter({ used, max, className }) {
  if (!max) {
    return (
      <p className={cn('text-xs text-gray-500', className)}>
        <span className="font-semibold text-gray-800 tabular-nums">{used}</span> submitted
        <span className="text-gray-400"> · no cap on this role</span>
      </p>
    );
  }

  const pct = Math.min(100, Math.round((used / max) * 100));
  const full = used >= max;
  const nearlyFull = !full && pct >= 75;

  return (
    <div className={cn('min-w-0', className)}>
      <p className="flex items-baseline justify-between gap-2 text-xs mb-1.5">
        <span className="text-gray-500">
          <span className={cn('font-semibold tabular-nums', full ? 'text-rose-600' : 'text-gray-800')}>
            {used} of {max}
          </span>{' '}
          submissions used
        </span>
        <span className={cn('tabular-nums shrink-0', full ? 'font-semibold text-rose-600' : 'text-gray-400')}>
          {full ? 'Cap reached' : `${max - used} left`}
        </span>
      </p>
      <div className="h-2 rounded-full bg-surface-100 overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            full ? 'bg-rose-500' : nearlyFull ? 'bg-amber-500' : 'bg-brand-500'
          )}
          style={{ width: `${Math.max(pct, used > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}
