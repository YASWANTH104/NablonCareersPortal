import DOMPurify from 'dompurify';

// Matches exactly what RichTextEditor's schema (StarterKit + Link, heading
// level 3 only) can ever produce. These notes/feedback fields are written by
// authenticated interviewers/HR (application notes) or via a secret-token
// link with no login (interview feedback) — neither is untrusted-public, but
// both are stored and later rendered inside an HR-authenticated session, so a
// tight allowlist (rather than trusting the editor alone) is what actually
// stops a crafted payload from executing as script in that session.
const ALLOWED_TAGS = [
  'p', 'h3', 'strong', 'em', 's', 'del', 'ul', 'ol', 'li',
  'a', 'blockquote', 'code', 'pre', 'hr', 'br',
];
const ALLOWED_ATTR = ['href', 'target', 'rel'];

/** Sanitizes TipTap-authored HTML for safe `dangerouslySetInnerHTML` display. */
export function sanitizeRichText(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
