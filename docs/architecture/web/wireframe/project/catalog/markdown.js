// Tiny markdown renderer — handles headings, bold, italic, lists, blockquote, code.
// Returns React elements. No third-party deps.
window.renderMarkdown = function renderMarkdown(md) {
  if (!md) return null;
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;

  const inline = (text, keyPrefix) => {
    const parts = [];
    let rest = text;
    let key = 0;
    const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/;
    while (rest.length) {
      const m = rest.match(re);
      if (!m) { parts.push(rest); break; }
      if (m.index > 0) parts.push(rest.slice(0, m.index));
      const k = `${keyPrefix}-${key++}`;
      if (m[2]) parts.push(React.createElement('strong', { key: k }, m[2]));
      else if (m[3]) parts.push(React.createElement('em', { key: k }, m[3]));
      else if (m[4]) parts.push(React.createElement('code', { key: k, className: 'md-code' }, m[4]));
      rest = rest.slice(m.index + m[0].length);
    }
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      blocks.push(React.createElement(`h${Math.min(level + 1, 5)}`, { key: `b${i}`, className: `md-h md-h${level}` }, inline(h[2], `b${i}`)));
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(React.createElement('blockquote', { key: `b${i}`, className: 'md-quote' }, inline(buf.join(' '), `b${i}`)));
      continue;
    }

    // List
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^[-*]\s+/, '');
        items.push(React.createElement('li', { key: `li${i}` }, inline(text, `li${i}`)));
        i++;
      }
      blocks.push(React.createElement('ul', { key: `b${i}`, className: 'md-list' }, items));
      continue;
    }

    // Paragraph (collect until blank line)
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|>|[-*]\s)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(React.createElement('p', { key: `p${i}`, className: 'md-p' }, inline(para.join(' '), `p${i}`)));
  }

  return blocks;
};
