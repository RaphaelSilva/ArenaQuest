import { describe, it, expect } from 'vitest';
import { sanitizeMarkdown, renderMarkdown } from './sanitize-markdown';

// ── sanitizeMarkdown ──────────────────────────────────────────────────────────

describe('sanitizeMarkdown', () => {
  describe('safe Markdown is preserved', () => {
    it('preserves plain text unchanged', () => {
      const src = 'Hello, world!';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves ATX headings', () => {
      const src = '# H1\n## H2\n### H3';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves bold and italic emphasis', () => {
      const src = '**bold** and _italic_ and ***both***';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves ordered and unordered lists', () => {
      const src = '- item one\n- item two\n\n1. first\n2. second';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves fenced code blocks', () => {
      const src = '```javascript\nconsole.log("hello");\n```';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves inline code', () => {
      const src = 'Use `const x = 1` here';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves blockquotes', () => {
      const src = '> This is a blockquote\n> spanning two lines';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves GFM tables', () => {
      const src = '| A | B |\n|---|---|\n| 1 | 2 |';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves safe https links', () => {
      const src = '[Visit site](https://example.com)';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves safe relative links', () => {
      const src = '[Page](/docs/intro)';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves images with safe src', () => {
      const src = '![Alt text](https://example.com/image.png)';
      expect(sanitizeMarkdown(src)).toBe(src);
    });

    it('preserves horizontal rules', () => {
      const src = '---';
      expect(sanitizeMarkdown(src)).toBe(src);
    });
  });

  describe('attack vectors are neutralized', () => {
    it('strips inline <script> tags', () => {
      const result = sanitizeMarkdown('Hello <script>alert(1)</script> World');
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('alert(1)');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    it('strips multi-line <script> blocks', () => {
      const result = sanitizeMarkdown('text\n<script>\n  fetch("https://evil.com");\n</script>\nmore');
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('fetch');
    });

    it('strips <script> with type and src attributes', () => {
      const result = sanitizeMarkdown('<script type="text/javascript" src="evil.js"></script>');
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('evil.js');
    });

    it('strips <iframe> tags', () => {
      const result = sanitizeMarkdown('Before <iframe src="https://evil.com"></iframe> After');
      expect(result).not.toContain('<iframe');
      expect(result).toContain('Before');
      expect(result).toContain('After');
    });

    it('strips self-closing <iframe />', () => {
      const result = sanitizeMarkdown('<iframe src="evil.com" />');
      expect(result).not.toContain('<iframe');
    });

    it('strips onclick event handlers in inline HTML', () => {
      const result = sanitizeMarkdown('<button onclick="alert(1)">Click</button>');
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('alert(1)');
    });

    it('strips onmouseover event handlers', () => {
      const result = sanitizeMarkdown('<a href="/" onmouseover="steal()">hover</a>');
      expect(result).not.toContain('onmouseover');
    });

    it('strips onload event handlers', () => {
      const result = sanitizeMarkdown('<img src="x" onerror="alert(1)">');
      expect(result).not.toContain('onerror');
    });

    it('strips href="javascript:..." in inline HTML', () => {
      const result = sanitizeMarkdown('<a href="javascript:alert(1)">link</a>');
      expect(result).not.toContain('javascript:');
    });

    it('strips href=\'javascript:...\' (single-quoted)', () => {
      const result = sanitizeMarkdown("<a href='javascript:void(0)'>link</a>");
      expect(result).not.toContain('javascript:');
    });

    it('converts [text](javascript:...) Markdown link to plain label', () => {
      const result = sanitizeMarkdown('[Click me](javascript:alert(1))');
      expect(result).not.toContain('javascript:');
      expect(result).toContain('[Click me]');
    });

    it('converts [text](data:...) Markdown link to plain label', () => {
      const result = sanitizeMarkdown('[Payload](data:text/html,<script>alert(1)</script>)');
      expect(result).not.toContain('data:');
    });

    it('strips href="data:..." in inline HTML', () => {
      const result = sanitizeMarkdown('<a href="data:text/html,<h1>XSS</h1>">link</a>');
      expect(result).not.toContain('data:text/html');
    });

    it('handles empty string without error', () => {
      expect(() => sanitizeMarkdown('')).not.toThrow();
      expect(sanitizeMarkdown('')).toBe('');
    });
  });
});

// ── renderMarkdown ────────────────────────────────────────────────────────────

describe('renderMarkdown', () => {
  describe('valid Markdown converts correctly', () => {
    it('converts # heading to <h1>', () => {
      const html = renderMarkdown('# Hello World');
      expect(html).toContain('<h1>');
      expect(html).toContain('Hello World');
    });

    it('converts ## heading to <h2>', () => {
      expect(renderMarkdown('## Sub')).toContain('<h2>');
    });

    it('converts **bold** to <strong>', () => {
      const html = renderMarkdown('**bold text**');
      expect(html).toContain('<strong>bold text</strong>');
    });

    it('converts _italic_ to <em>', () => {
      const html = renderMarkdown('_italic_');
      expect(html).toContain('<em>italic</em>');
    });

    it('converts paragraphs to <p>', () => {
      const html = renderMarkdown('Simple paragraph.');
      expect(html).toContain('<p>Simple paragraph.</p>');
    });

    it('converts unordered list to <ul><li>', () => {
      const html = renderMarkdown('- item one\n- item two');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>item one</li>');
      expect(html).toContain('<li>item two</li>');
    });

    it('converts ordered list to <ol><li>', () => {
      const html = renderMarkdown('1. first\n2. second');
      expect(html).toContain('<ol>');
      expect(html).toContain('<li>first</li>');
    });

    it('converts fenced code block to <pre><code>', () => {
      const html = renderMarkdown('```js\nconst x = 1;\n```');
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
    });

    it('converts blockquote to <blockquote>', () => {
      const html = renderMarkdown('> A quote');
      expect(html).toContain('<blockquote>');
    });

    it('converts safe [text](url) link to <a href>', () => {
      const html = renderMarkdown('[Visit](https://example.com)');
      expect(html).toContain('<a');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('Visit');
    });

    it('renders horizontal rule as <hr>', () => {
      const html = renderMarkdown('---');
      expect(html).toContain('<hr');
    });

    it('renders GFM table as <table>', () => {
      const src = '| A | B |\n|---|---|\n| 1 | 2 |';
      const html = renderMarkdown(src);
      expect(html).toContain('<table>');
      expect(html).toContain('<th>');
      expect(html).toContain('<td>');
    });

    it('returns a string (never a Promise)', () => {
      const result = renderMarkdown('hello');
      expect(typeof result).toBe('string');
    });
  });

  describe('attack vectors are neutralized in HTML output', () => {
    it('strips <script> injected directly in Markdown source', () => {
      const html = renderMarkdown('Hello <script>alert(1)</script> World');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('alert(1)');
    });

    it('strips <iframe> injected in Markdown source', () => {
      const html = renderMarkdown('<iframe src="https://evil.com"></iframe>');
      expect(html).not.toContain('<iframe');
    });

    it('strips onclick handlers in inline HTML', () => {
      const html = renderMarkdown('<button onclick="steal()">Click</button>');
      expect(html).not.toContain('onclick');
    });

    it('neutralizes [text](javascript:...) Markdown links', () => {
      const html = renderMarkdown('[XSS](javascript:alert(1))');
      expect(html).not.toContain('javascript:');
    });

    it('neutralizes [text](data:...) Markdown links', () => {
      const html = renderMarkdown('[Payload](data:text/html,<script>x</script>)');
      expect(html).not.toContain('data:text/html');
    });

    it('preserves legitimate content around stripped attacks', () => {
      const html = renderMarkdown('Safe text\n\n<script>bad()</script>\n\nMore safe text');
      expect(html).toContain('Safe text');
      expect(html).toContain('More safe text');
      expect(html).not.toContain('bad()');
    });

    it('handles empty input without error', () => {
      expect(() => renderMarkdown('')).not.toThrow();
      expect(typeof renderMarkdown('')).toBe('string');
    });

    it('handles a complex document with mixed safe and unsafe content', () => {
      const src = [
        '# Lesson Title',
        '',
        'This is **important** content with a [safe link](https://docs.example.com).',
        '',
        '```python',
        'print("hello")',
        '```',
        '',
        '<script>document.cookie = "stolen";</script>',
        '',
        '> A safe blockquote',
        '',
        '[malicious](javascript:alert(document.cookie))',
      ].join('\n');

      const html = renderMarkdown(src);

      expect(html).toContain('<h1>');
      expect(html).toContain('<strong>important</strong>');
      expect(html).toContain('href="https://docs.example.com"');
      expect(html).toContain('<pre>');
      expect(html).toContain('<blockquote>');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('document.cookie');
      expect(html).not.toContain('javascript:');
    });
  });
});
