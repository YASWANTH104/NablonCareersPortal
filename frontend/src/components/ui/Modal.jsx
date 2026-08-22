import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
};

// One modal shell for the whole app — every hand-rolled `fixed inset-0 …
// bg-black/40` block had its own padding, radius, close-button placement and
// (usually missing) Escape handling, which is why no two dialogs looked or
// behaved alike. Body scroll is locked while open, Escape and a backdrop
// click both close, and the body scrolls inside the panel so a tall form
// never pushes its own footer off-screen on a laptop.
export default function Modal({
  onClose,
  title,
  description,
  icon: Icon,
  size = 'md',
  footer,
  children,
  bodyClassName,
  className,
  closeOnBackdrop = true,
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'w-full bg-white shadow-modal flex flex-col',
          'rounded-t-2xl sm:rounded-2xl',
          'max-h-[92dvh] sm:max-h-[88dvh]',
          'animate-in duration-200 slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95',
          SIZES[size] ?? SIZES.md,
          className
        )}
      >
        {(title || description) && (
          <div className="flex items-start gap-3 px-5 py-4 sm:px-6 border-b border-surface-200">
            {Icon && (
              <span className="mt-0.5 w-9 h-9 shrink-0 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                <Icon className="w-4 h-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              {title && <h2 className="font-display font-semibold text-gray-900 leading-tight">{title}</h2>}
              {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mt-1 -mr-1.5 w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:bg-surface-100 hover:text-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className={cn('relative flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5', bodyClassName)}>
          {/* Headerless dialogs (confirmations, success states) still need a
              visible way out — Escape and the backdrop alone are not discoverable. */}
          {!title && !description && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-surface-100 hover:text-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3.5 sm:px-6 sm:py-4 border-t border-surface-200 bg-surface-50/70 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
