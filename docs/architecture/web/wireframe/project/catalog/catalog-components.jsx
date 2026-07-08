// ArenaQuest Catálogo — recursive tree navigator
// Depends on: CATALOG_TREE, CATALOG_COMMENTS (catalog-data.js), renderMarkdown (markdown.js)

const { useState, useMemo, useEffect, useRef } = React;

// ---------- ICONS ----------
const I = {
  Folder: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 4.5a1 1 0 011-1H5l1.5 1.5h5a1 1 0 011 1V11a1 1 0 01-1 1h-10a1 1 0 01-1-1V4.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
  Chev: ({ dir }) => <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: dir === 'down' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}><path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  ChevR: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Play: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4.5 3L11 7L4.5 11V3z" fill="currentColor"/></svg>,
  Pause: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3.5" y="3" width="2.5" height="8" rx="0.5" fill="currentColor"/><rect x="8" y="3" width="2.5" height="8" rx="0.5" fill="currentColor"/></svg>,
  Video: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M10.5 6.5L14 4.5v7l-3.5-2v-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  Audio: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 6v4M6.5 4v8M9.5 5.5v5M12.5 6.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  Pdf: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2h6l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  Comments: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4a1 1 0 011-1h8a1 1 0 011 1v5a1 1 0 01-1 1H6L3.5 12V10H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
  Heart: ({ filled }) => <svg width="12" height="12" viewBox="0 0 12 12" fill={filled ? 'currentColor' : 'none'}><path d="M6 10.5S1.5 7.5 1.5 4.5a2.5 2.5 0 015 0a2.5 2.5 0 015 0c0 3-4.5 6-4.5 6z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  Reply: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 3L1.5 5.5L4 8M1.5 5.5H8a2.5 2.5 0 010 5H7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Download: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v6.5M3.5 6L6 8.5L8.5 6M2 10.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Sun: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.8" stroke="currentColor" strokeWidth="1.2"/><path d="M7 1.5V3M7 11v1.5M1.5 7H3M11 7h1.5M3.2 3.2L4.2 4.2M9.8 9.8L10.8 10.8M3.2 10.8L4.2 9.8M9.8 4.2L10.8 3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  Moon: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11.5 8.5A5.5 5.5 0 014 1a5.5 5.5 0 100 11 5.5 5.5 0 007.5-3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
  Home: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 6L6.5 2L11 6V11a1 1 0 01-1 1H3a1 1 0 01-1-1V6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  Loop: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6a4 4 0 014-4h2l-1.5-1.5M10 6a4 4 0 01-4 4H4l1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// ---------- HASH ROUTING ----------
function pathFromHash() {
  const h = window.location.hash || '';
  const m = h.match(/^#\/?(.*)$/);
  if (!m || !m[1]) return [];
  return m[1].split('/').filter(Boolean);
}
function hashFromPath(p) {
  return p.length ? `#/${p.join('/')}` : '#/';
}

// Resolve a path through the tree; returns { trail: [{node, depth}], current, looped: false }
// trail INCLUDES root + each descended node, so trail.length = path.length + 1
function resolvePath(tree, path) {
  const trail = [{ node: tree, depth: 0 }];
  const visited = new Set([tree.id]);
  let cur = tree;
  for (let i = 0; i < path.length; i++) {
    const next = (cur.children || []).find(c => c.id === path[i]);
    if (!next) break;
    if (visited.has(next.id)) {
      // Loop protection: stop here, surface flag
      return { trail, current: cur, looped: true, loopAt: next.id };
    }
    visited.add(next.id);
    trail.push({ node: next, depth: i + 1 });
    cur = next;
  }
  return { trail, current: trail[trail.length - 1].node, looped: false };
}

// Count totals recursively (with cycle protection)
function countDeep(node, visited = new Set()) {
  if (visited.has(node.id)) return { topics: 0, media: 0 };
  visited.add(node.id);
  let topics = 0, media = (node.media || []).length;
  for (const c of (node.children || [])) {
    const sub = countDeep(c, visited);
    topics += 1 + sub.topics;
    media += sub.media;
  }
  return { topics, media };
}

// ---------- TREE SIDEBAR ----------
function TreeNode({ node, path, currentPath, depth, onNav }) {
  const here = [...path, node.id];
  const isCurrent = currentPath.length === here.length && currentPath.every((id, i) => id === here[i]);
  const isAncestor = here.every((id, i) => currentPath[i] === id) && currentPath.length > here.length;
  const [open, setOpen] = useState(isAncestor || isCurrent || depth === 0);
  const hasChildren = (node.children || []).length > 0;

  useEffect(() => {
    if (isAncestor || isCurrent) setOpen(true);
  }, [isAncestor, isCurrent]);

  return (
    <div className="tn">
      <div
        className={`tn-row ${isCurrent ? 'is-current' : ''}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => { onNav(here); if (hasChildren) setOpen(true); }}
      >
        <button
          className="tn-chev"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) setOpen(o => !o); }}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          aria-label="toggle"
        >
          <I.Chev dir={open ? 'down' : 'right'} />
        </button>
        <span className="tn-icon"><I.Folder /></span>
        <span className="tn-label">{node.title}</span>
        {hasChildren && <span className="tn-count">{node.children.length}</span>}
      </div>
      {open && hasChildren && (
        <div className="tn-children">
          {node.children.map(c => (
            <TreeNode key={c.id} node={c} path={here} currentPath={currentPath} depth={depth + 1} onNav={onNav} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- MEDIA ----------
function MediaItem({ m, expanded, onToggle }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // Mock playback for audio — animates progress when "playing"
  useEffect(() => {
    if (m.kind !== 'audio' || !playing) return;
    const id = setInterval(() => {
      setProgress(p => {
        const np = p + 0.6;
        if (np >= 100) { setPlaying(false); return 0; }
        return np;
      });
    }, 200);
    return () => clearInterval(id);
  }, [playing, m.kind]);

  const kindMeta = {
    video: { label: 'Vídeo', color: 'oklch(0.74 0.19 52)', bg: 'oklch(0.74 0.19 52 / 0.12)' },
    audio: { label: 'Áudio', color: 'oklch(0.68 0.17 150)', bg: 'oklch(0.68 0.17 150 / 0.12)' },
    pdf:   { label: 'PDF',   color: 'oklch(0.65 0.16 240)', bg: 'oklch(0.65 0.16 240 / 0.12)' },
  }[m.kind];

  return (
    <div className={`media-card ${expanded ? 'is-open' : ''}`}>
      <div className="media-head" onClick={onToggle}>
        <div className="media-kind" style={{ background: kindMeta.bg, color: kindMeta.color }}>
          {m.kind === 'video' && <I.Video />}
          {m.kind === 'audio' && <I.Audio />}
          {m.kind === 'pdf' && <I.Pdf />}
        </div>
        <div className="media-info">
          <div className="media-title">{m.title}</div>
          <div className="media-sub">
            <span className="media-kind-label" style={{ color: kindMeta.color }}>{kindMeta.label}</span>
            {m.duration && <><span className="media-dot">·</span><span>{m.duration}</span></>}
            {m.pages && <><span className="media-dot">·</span><span>{m.pages} páginas</span></>}
            {m.size && <><span className="media-dot">·</span><span>{m.size}</span></>}
          </div>
        </div>
        <button className="media-action">
          {m.kind === 'pdf'
            ? <><I.Download /> Abrir</>
            : <><I.Play /> {expanded ? 'Recolher' : 'Reproduzir'}</>}
        </button>
      </div>

      {expanded && m.kind === 'video' && (
        <div className="media-body">
          <div className="video-stage">
            <div className="video-stripes"/>
            <div className="video-watermark">player · {m.title}</div>
            <button className="video-play-big"><I.Play /></button>
            <div className="video-controls">
              <div className="video-scrub"><div className="video-scrub-fill" style={{ width: '32%' }}/></div>
              <div className="video-controls-row">
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>00:00 / {m.duration}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>HD · 1080p</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {expanded && m.kind === 'audio' && (
        <div className="media-body">
          <div className="audio-stage">
            <button className="audio-play" onClick={() => setPlaying(p => !p)} aria-label="play">
              {playing ? <I.Pause /> : <I.Play />}
            </button>
            <div className="audio-wave">
              {Array.from({ length: 56 }).map((_, i) => {
                const h = 4 + Math.abs(Math.sin(i * 0.7) * 18) + (i % 3) * 4;
                const active = (i / 56) * 100 < progress;
                return <span key={i} className="bar" style={{ height: h, background: active ? 'var(--accent)' : 'var(--bg4)' }}/>;
              })}
            </div>
            <span className="audio-time">{m.duration}</span>
          </div>
        </div>
      )}

      {expanded && m.kind === 'pdf' && (
        <div className="media-body">
          <div className="pdf-stage">
            <div className="pdf-paper">
              <div className="pdf-paper-stripes" />
              <span className="pdf-mono">documento.pdf · página 1 de {m.pages || '—'}</span>
            </div>
            <div className="pdf-actions">
              <button className="btn-primary"><I.Download /> Baixar ({m.size})</button>
              <button className="btn-ghost">Pré-visualizar inline</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- SUBTOPIC CARD ----------
function SubtopicCard({ node, onOpen, index }) {
  const counts = useMemo(() => {
    const direct = {
      video: (node.media || []).filter(m => m.kind === 'video').length,
      audio: (node.media || []).filter(m => m.kind === 'audio').length,
      pdf:   (node.media || []).filter(m => m.kind === 'pdf').length,
    };
    const deep = countDeep(node);
    return { direct, deep, kids: (node.children || []).length };
  }, [node]);

  return (
    <button className="sub-card" onClick={onOpen}>
      <div className="sub-card-num">{String(index).padStart(2, '0')}</div>
      <div className="sub-card-body">
        <div className="sub-card-title">{node.title}</div>
        <div className="sub-card-desc">
          {(node.description || '').replace(/[#*>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)}
          {(node.description || '').length > 120 && '…'}
        </div>
        <div className="sub-card-meta">
          {counts.kids > 0 && <span className="meta-pill"><I.Folder /> {counts.kids} {counts.kids === 1 ? 'subtópico' : 'subtópicos'}</span>}
          {counts.direct.video > 0 && <span className="meta-pill v"><I.Video /> {counts.direct.video}</span>}
          {counts.direct.audio > 0 && <span className="meta-pill a"><I.Audio /> {counts.direct.audio}</span>}
          {counts.direct.pdf > 0 && <span className="meta-pill p"><I.Pdf /> {counts.direct.pdf}</span>}
          {counts.kids > 0 && counts.deep.media > 0 && <span className="meta-pill deep">+{counts.deep.media} no total</span>}
        </div>
      </div>
      <div className="sub-card-arrow"><I.ChevR /></div>
    </button>
  );
}

// ---------- COMMENTS ----------
function Comment({ c }) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(c.likes || 0);
  return (
    <div className="comment">
      <div className="c-avatar">{c.initials}</div>
      <div className="c-body">
        <div className="c-head">
          <span className="c-name">{c.name}</span>
          {c.badge && <span className="c-badge">{c.badge}</span>}
          <span className="c-time">{c.time}</span>
        </div>
        <p className="c-text">{c.text}</p>
        <div className="c-actions">
          <button className={`c-btn ${liked ? 'liked' : ''}`} onClick={() => { setLiked(!liked); setLikes(l => liked ? l - 1 : l + 1); }}>
            <I.Heart filled={liked} /> {likes}
          </button>
          <button className="c-btn"><I.Reply /> Responder</button>
        </div>
        {c.replies && c.replies.length > 0 && (
          <div className="c-replies">
            {c.replies.map(r => (
              <div className="comment" key={r.id} style={{ marginTop: 10 }}>
                <div className="c-avatar small">{r.initials}</div>
                <div className="c-body">
                  <div className="c-head"><span className="c-name">{r.name}</span><span className="c-time">{r.time}</span></div>
                  <p className="c-text">{r.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

window.AQApp = {
  I, pathFromHash, hashFromPath, resolvePath, countDeep,
  TreeNode, MediaItem, SubtopicCard, Comment,
};
