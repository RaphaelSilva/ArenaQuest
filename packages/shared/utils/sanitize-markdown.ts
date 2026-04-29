import { Marked } from 'marked';

// ── Write-side patterns (raw Markdown source) ────────────────────────────────
// These strip dangerous HTML constructs that authors may embed directly in Markdown.

const SCRIPT_RE = /<script\b[\s\S]*?<\/script>/gi;
const IFRAME_RE = /<iframe\b[\s\S]*?(?:<\/iframe>|\/>|>)/gi;
const ON_HANDLER_RE = /\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi;
const JS_HREF_RE = /href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi;
const DATA_HREF_RE = /href\s*=\s*(?:"data:[^"]*"|'data:[^']*')/gi;
// Markdown link syntax: [text](javascript:...) → strip the URI, keep the label
const JS_MD_LINK_RE = /\[([^\]]*)\]\(javascript:[^)]*\)/gi;
const DATA_MD_LINK_RE = /\[([^\]]*)\]\(data:[^)]*\)/gi;

/**
 * Write-side sanitizer: strips dangerous HTML/URI constructs from raw Markdown
 * before persistence. Preserves all valid Markdown syntax (headings, lists,
 * code blocks, tables, etc.). Isomorphic — runs in Cloudflare Workers and browsers.
 */
export function sanitizeMarkdown(input: string): string {
  return input
    .replace(SCRIPT_RE, '')
    .replace(IFRAME_RE, '')
    .replace(ON_HANDLER_RE, '')
    .replace(JS_HREF_RE, '')
    .replace(DATA_HREF_RE, '')
    .replace(JS_MD_LINK_RE, '[$1]')
    .replace(DATA_MD_LINK_RE, '[$1]');
}

// ── Render-side: Markdown → sanitized HTML ───────────────────────────────────

// Isolated Marked instance — does not share state with any caller's global marked.
const md = new Marked();

// Post-parse HTML patterns (belt-and-suspenders after marked renders to HTML).
const HTML_SCRIPT_RE = /<script\b[\s\S]*?<\/script>/gi;
const HTML_IFRAME_RE = /<iframe\b[\s\S]*?(?:<\/iframe>|\/>|>)/gi;
const HTML_ON_ATTR_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
const HTML_JS_HREF_RE = /(\s+href\s*=\s*)"javascript:[^"]*"/gi;
const HTML_DATA_HREF_RE = /(\s+href\s*=\s*)"data:[^"]*"/gi;
const HTML_JS_SRC_RE = /(\s+src\s*=\s*)"javascript:[^"]*"/gi;
const HTML_DATA_SRC_RE = /(\s+src\s*=\s*)"data:[^"]*"/gi;

function postSanitizeHtml(html: string): string {
  return html
    .replace(HTML_SCRIPT_RE, '')
    .replace(HTML_IFRAME_RE, '')
    .replace(HTML_ON_ATTR_RE, '')
    .replace(HTML_JS_HREF_RE, '$1""')
    .replace(HTML_DATA_HREF_RE, '$1""')
    .replace(HTML_JS_SRC_RE, '$1""')
    .replace(HTML_DATA_SRC_RE, '$1""');
}

/**
 * Render-side sanitizer: converts raw Markdown to sanitized HTML safe for
 * injection into the browser via `dangerouslySetInnerHTML`. Applies two passes:
 *   1. `sanitizeMarkdown` strips dangerous constructs from the source.
 *   2. Post-parse regex strips any residual dangerous patterns from the HTML output.
 *
 * Isomorphic — runs in Cloudflare Workers and browsers.
 */
export function renderMarkdown(input: string): string {
  const cleanSrc = sanitizeMarkdown(input);
  const html = md.parse(cleanSrc, { async: false });
  return postSanitizeHtml(html);
}
