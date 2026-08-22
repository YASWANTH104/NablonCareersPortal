import { cn } from '@/lib/utils';

const TONES = {
  brand:   { icon: 'bg-brand-50 text-brand-600',     value: 'text-gray-900' },
  emerald: { icon: 'bg-emerald-50 text-emerald-600', value: 'text-gray-900' },
  amber:   { icon: 'bg-amber-50 text-amber-600',     value: 'text-gray-900' },
  slate:   { icon: 'bg-surface-100 text-gray-500',   value: 'text-gray-900' },
  violet:  { icon: 'bg-violet-50 text-violet-600',   value: 'text-gray-900' },
  rose:    { icon: 'bg-rose-50 text-rose-600',       value: 'text-gray-900' },
};

// The small "number + label + icon" card several pages already hand-roll
// (MyReferralsPage's summary row, the availability header counts). Rendered as
// a button when `onClick` is passed so a tile can double as a filter.
export default function StatTile({ label, value, icon: Icon, tone = 'brand', hint, onClick, active, className }) {
  const t = TONES[tone] ?? TONES.brand;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-white p-3.5 text-left transition-all',
        onClick && 'hover:border-brand-300 hover:shadow-card cursor-pointer',
        active ? 'border-brand-400 ring-2 ring-brand-100' : 'border-surface-200',
        className
      )}
    >
      {Icon && (
        <span className={cn('w-10 h-10 shrink-0 rounded-xl flex items-center justify-center', t.icon)}>
          <Icon className="w-5 h-5" />
        </span>
      )}
      <div className="min-w-0">
        <p className={cn('font-display text-xl font-bold leading-none', t.value)}>{value}</p>
        <p className="text-xs text-gray-500 mt-1 truncate">{label}</p>
        {hint && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{hint}</p>}
      </div>
    </Tag>
  );
}
