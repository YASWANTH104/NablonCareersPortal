import { cn } from '@/lib/utils';

// A consistent "nothing here yet" block. The point is that it always says
// what to DO next — several pages previously rendered either a bare
// "No results" line or, worse, literally nothing at all.
export default function EmptyState({ icon: Icon, title, description, action, className, compact = false }) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'py-8 px-4' : 'py-14 px-6', className)}>
      {Icon && (
        <span className="w-12 h-12 rounded-2xl bg-surface-100 text-gray-400 flex items-center justify-center mb-3.5">
          <Icon className="w-6 h-6" />
        </span>
      )}
      <p className="font-display font-semibold text-gray-800">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
