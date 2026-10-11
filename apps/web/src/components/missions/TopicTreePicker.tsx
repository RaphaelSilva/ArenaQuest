'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { normalizeText, tokenize } from '@arenaquest/shared/domain/search/normalize';
import { useDict } from '@web/context/dict-context';
import type { TopicNode } from '@web/lib/admin-topics-api';
import { buildTrail } from '@web/lib/topic-tree';
import { fieldClass, fieldStyle, hintClass, hintStyle } from './form-styles';

type Props = {
  topics: TopicNode[];
  /** The picked topic id, or `''`. */
  value: string;
  onChange: (topicId: string) => void;
  disabled?: boolean;
};

type PickerNode = {
  topic: TopicNode;
  /** Published and not archived: only these can be picked. */
  selectable: boolean;
  children: PickerNode[];
};

type Row = { node: PickerNode; depth: number; expanded: boolean };

function isSelectableTopic(topic: TopicNode): boolean {
  return topic.status === 'published' && !topic.archived;
}

/**
 * Nests `topics` by `parentId`, ordered by `order` then title. A node is kept
 * when it is selectable or is an ancestor of a selectable one — so a published
 * lesson under a draft or archived module stays reachable, its module shown as
 * a label that cannot be picked. A node whose parent is missing becomes a root.
 */
function buildPickerTree(topics: TopicNode[]): PickerNode[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const kept = new Set<string>();
  for (const topic of topics) {
    if (!isSelectableTopic(topic)) continue;
    let cur: TopicNode | undefined = topic;
    while (cur && !kept.has(cur.id)) {
      kept.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }

  const nodes = new Map<string, PickerNode>();
  for (const id of kept) {
    const topic = byId.get(id)!;
    nodes.set(id, { topic, selectable: isSelectableTopic(topic), children: [] });
  }
  const roots: PickerNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.topic.parentId ? nodes.get(node.topic.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: PickerNode[]) => {
    list.sort((a, b) => a.topic.order - b.topic.order || a.topic.title.localeCompare(b.topic.title));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="motion-safe:transition-transform motion-safe:duration-200"
      style={{ transform: open ? 'rotate(90deg)' : 'none' }}
    >
      <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[oklch(0.74_0.19_52_/_0.12)]';

/**
 * One topic out of the published, non-archived ones, picked from the topic
 * hierarchy: modules collapse, both modules and lessons carry a radio, and a
 * search narrows the tree to the matching branches. The selected line shows the
 * full path. Read-only, it shows that path and nothing to click.
 *
 * Keyboard: Tab reaches the search, the picked (or first) radio and each
 * chevron; on a radio, ↑/↓ move between radios, → expands, ← collapses, and
 * Enter/Space pick it. Chevrons toggle on Enter/Space.
 */
export function TopicTreePicker({ topics, value, onChange, disabled = false }: Props) {
  const d = useDict().admin.missions.requirements;
  const [query, setQuery] = useState('');
  // Explicit expand/collapse choices; everything else follows the defaults below.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const radioRefs = useRef(new Map<string, HTMLButtonElement>());

  const tree = useMemo(() => buildPickerTree(topics), [topics]);
  const trail = useMemo(() => (value ? buildTrail(topics, value) : []), [topics, value]);

  const tokens = useMemo(() => tokenize(query), [query]);
  const hasQuery = tokens.length > 0;

  // Nodes whose own title matches, and nodes with a matching node below them.
  const { selfMatches, descendantMatches } = useMemo(() => {
    const self = new Set<string>();
    const below = new Set<string>();
    if (!hasQuery) return { selfMatches: self, descendantMatches: below };
    const visit = (node: PickerNode): boolean => {
      let childMatched = false;
      for (const child of node.children) if (visit(child)) childMatched = true;
      if (childMatched) below.add(node.topic.id);
      const title = normalizeText(node.topic.title);
      const matched = tokens.every((t) => title.includes(t));
      if (matched) self.add(node.topic.id);
      return matched || childMatched;
    };
    tree.forEach(visit);
    return { selfMatches: self, descendantMatches: below };
  }, [tree, tokens, hasQuery]);

  const valueAncestors = useMemo(() => new Set(trail.slice(0, -1).map((t) => t.id)), [trail]);

  // Visible rows, depth-first: a branch shows while searching only when it
  // matches, sits under a match, or leads to one.
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (node: PickerNode, depth: number, underMatch: boolean) => {
      const id = node.topic.id;
      if (hasQuery && !underMatch && !selfMatches.has(id) && !descendantMatches.has(id)) return;
      const fallback = hasQuery ? descendantMatches.has(id) : depth === 0 || valueAncestors.has(id);
      const expanded = node.children.length > 0 && (overrides.get(id) ?? fallback);
      out.push({ node, depth, expanded });
      if (expanded) {
        for (const child of node.children) walk(child, depth + 1, underMatch || selfMatches.has(id));
      }
    };
    tree.forEach((root) => walk(root, 0, false));
    return out;
  }, [tree, hasQuery, selfMatches, descendantMatches, valueAncestors, overrides]);

  const pathLine = value
    ? d.topicSelected(trail.length > 0 ? d.topicPath(trail.map((t) => t.title)) : d.topicUnknown)
    : d.topicNone;

  if (disabled) {
    return (
      <p className={hintClass} style={hintStyle}>
        {pathLine}
      </p>
    );
  }

  const radios = rows.filter((r) => r.node.selectable).map((r) => r.node.topic.id);
  const tabStop = radios.includes(value) ? value : radios[0];

  const toggle = (id: string, expanded: boolean) =>
    setOverrides((prev) => new Map(prev).set(id, !expanded));

  const select = (id: string) => {
    if (id !== value) onChange(id);
  };

  const handleSearch = (next: string) => {
    setQuery(next);
    // A new search starts from its own auto-expansion, not from earlier clicks.
    setOverrides(new Map());
  };

  const handleRadioKey = (e: KeyboardEvent<HTMLButtonElement>, row: Row) => {
    const id = row.node.topic.id;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = radios[radios.indexOf(id) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) radioRefs.current.get(next)?.focus();
    } else if (e.key === 'ArrowRight' && row.node.children.length > 0 && !row.expanded) {
      e.preventDefault();
      toggle(id, false);
    } else if (e.key === 'ArrowLeft' && row.expanded) {
      e.preventDefault();
      toggle(id, true);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={hintClass} style={hintStyle}>
          {pathLine}
        </p>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors duration-200 hover:text-[color:var(--accent)] ${focusRing}`}
            style={{ color: 'var(--text2)' }}
          >
            {d.topicClear}
          </button>
        )}
      </div>

      {tree.length === 0 ? (
        <p className={hintClass} style={hintStyle}>
          {d.topicsEmpty}
        </p>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={d.topicSearchPlaceholder}
            aria-label={d.topicSearchLabel}
            className={fieldClass}
            style={fieldStyle}
          />
          <div
            role="radiogroup"
            aria-label={d.fields.topic}
            className="max-h-56 overflow-y-auto pr-1"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--bg4) transparent' }}
          >
            {rows.length === 0 && (
              <p className="py-3 text-center text-xs" style={hintStyle}>
                {d.topicNoMatch}
              </p>
            )}
            {rows.map((row) => {
              const { topic, selectable, children } = row.node;
              const checked = topic.id === value;
              return (
                <div
                  key={topic.id}
                  data-testid="topic-tree-row"
                  data-depth={row.depth}
                  className="relative flex items-center rounded-lg pr-2 transition-colors duration-150 hover:bg-[color:var(--bg3)]"
                  style={{
                    paddingLeft: `${row.depth}rem`,
                    background: checked ? 'var(--accent-glow)' : undefined,
                  }}
                >
                  {checked && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 left-0 top-0 w-[3px] rounded-r-[2px]"
                      style={{ background: 'var(--accent)' }}
                    />
                  )}
                  {children.length > 0 ? (
                    <button
                      type="button"
                      aria-expanded={row.expanded}
                      aria-label={row.expanded ? d.topicCollapse(topic.title) : d.topicExpand(topic.title)}
                      onClick={() => toggle(topic.id, row.expanded)}
                      className={`flex h-8 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors duration-200 hover:text-[color:var(--accent)] ${focusRing}`}
                      style={{ color: 'var(--text3)' }}
                    >
                      <ChevronIcon open={row.expanded} />
                    </button>
                  ) : (
                    <span aria-hidden="true" className="h-8 w-6 flex-shrink-0" />
                  )}
                  {selectable ? (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      tabIndex={topic.id === tabStop ? 0 : -1}
                      ref={(el) => {
                        if (el) radioRefs.current.set(topic.id, el);
                        else radioRefs.current.delete(topic.id);
                      }}
                      onClick={() => select(topic.id)}
                      onKeyDown={(e) => handleRadioKey(e, row)}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 text-left text-sm ${focusRing}`}
                      style={{ color: checked ? 'var(--accent)' : 'var(--text)' }}
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border"
                        style={{ borderColor: checked ? 'var(--accent)' : 'var(--border2)', background: 'var(--bg3)' }}
                      >
                        {checked && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />}
                      </span>
                      <span className="truncate">{topic.title}</span>
                    </button>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm" style={{ color: 'var(--text3)' }}>
                      <span className="truncate">{topic.title}</span>
                      <span
                        className="flex-shrink-0 rounded-[20px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
                      >
                        {d.topicUnpublished}
                      </span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
