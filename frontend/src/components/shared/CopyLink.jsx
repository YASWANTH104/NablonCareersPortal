import { useState } from 'react';
import { Link2, Copy, Check, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

/**
 * A URL presented as something you hand over — the portal link and the
 * per-job tracked link are the whole point of the agency screens, and both
 * used to hide behind a 10px "Copy link" text button.
 */
export default function CopyLink({ label, url, icon: Icon = Link2, hint, className }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused on insecure origins and in some embedded
      // webviews — say so rather than silently doing nothing.
      toast.error('Could not copy — select the link and copy it manually.');
    }
  }

  return (
    <div className={cn('rounded-xl border border-surface-200 bg-surface-50/70 p-3', className)}>
      {label && (
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </p>
      )}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 block font-mono text-[11px] leading-relaxed text-gray-600 truncate" title={url}>
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className={cn(
            'shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
            copied
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-surface-200 bg-white text-gray-600 hover:text-brand-600 hover:border-brand-300'
          )}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open in a new tab"
          aria-label="Open in a new tab"
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg border border-surface-200 bg-white text-gray-400 hover:text-brand-600 hover:border-brand-300 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      {hint && <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">{hint}</p>}
    </div>
  );
}
