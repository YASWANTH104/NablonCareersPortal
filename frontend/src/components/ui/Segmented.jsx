import { cn } from '@/lib/utils';

const SIZES = {
  sm: { wrap: 'p-0.5 gap-0.5', btn: 'px-2.5 py-1 text-xs gap-1.5', icon: 'w-3.5 h-3.5' },
  md: { wrap: 'p-1 gap-0.5', btn: 'px-3 py-1.5 text-sm gap-1.5', icon: 'w-4 h-4' },
};

// Replaces the rows of look-alike standalone buttons this app used for every
// mutually-exclusive choice (view switchers, HR mode switchers, status tabs).
// Grouping them into one track is what makes "these are the same decision"
// readable at a glance, and stops a mode switcher from looking identical to
// an action button sitting next to it.
export default function Segmented({ value, onChange, options, size = 'md', className, fullWidth = false }) {
  const s = SIZES[size] ?? SIZES.md;
  return (
    <div
      role="tablist"
      className={cn('inline-flex items-center bg-surface-100 rounded-xl', s.wrap, fullWidth && 'w-full', className)}
    >
      {options.map(({ value: v, label, icon: Icon, title, shortLabel }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            title={title ?? label}
            onClick={() => onChange(v)}
            className={cn(
              'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-all',
              s.btn,
              fullWidth && 'flex-1',
              active
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            )}
          >
            {Icon && <Icon className={cn(s.icon, active ? 'text-brand-500' : 'text-gray-400')} />}
            {shortLabel ? (
              <>
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{shortLabel}</span>
              </>
            ) : (
              label
            )}
          </button>
        );
      })}
    </div>
  );
}
