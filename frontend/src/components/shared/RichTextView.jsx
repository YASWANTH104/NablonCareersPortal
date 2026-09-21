import { sanitizeRichText } from '@/lib/sanitizeHtml';

/** Read-only display for HTML authored in RichTextEditor (bold/italic/lists/
    links survive; anything outside its schema is stripped on the way in). */
export default function RichTextView({ html, className = '' }) {
  if (!html) return null;
  return (
    <div
      className={`prose prose-sm max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }}
    />
  );
}
