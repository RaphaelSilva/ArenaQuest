/**
 * Catalog search — pure parse + match + explain over a topic's title and tags.
 *
 * - Free tokens (via the shared `tokenize`) must each be a substring of the
 *   normalised title or of some normalised tag name (AND, any order).
 * - Tag-only terms (`#slug` inside the query, plus the `?tag=` URL parameter)
 *   must each equal one of the topic's tag slugs.
 * - Tokens shorter than 2 characters are ignored unless they are the whole query.
 *
 * No React, no side effects: every case is a plain unit test.
 */
import { normalizeText, tokenize } from '@arenaquest/shared/domain/search/normalize';
import { slugify } from '@arenaquest/shared/domain/tags/slugify';

export type TagLike = { id: string; name: string; slug: string };
type Searchable = { title: string; tags?: readonly TagLike[] | null };

/** `tagSlugs` holds the `#slug` terms of the query plus the `?tag=` parameter. */
export type ParsedQuery = { free: string[]; tagSlugs: string[] };

export type Haystack = { title: string; tags: { tag: TagLike; norm: string }[] };

/** `viaTags` lists the tags that contributed where the title alone did not satisfy the query. */
export type MatchResult = { matched: boolean; viaTags: TagLike[] };

const MIN_TOKEN_LENGTH = 2;

export function parseQuery(q: string, tagParam?: string | null): ParsedQuery {
  const tagSlugs: string[] = [];
  const freeParts: string[] = [];

  for (const term of (q ?? '').split(/\s+/u)) {
    if (!term) continue;
    if (term.startsWith('#')) {
      const slug = slugify(term.slice(1));
      if (slug) tagSlugs.push(slug);
    } else {
      freeParts.push(term);
    }
  }

  const tokens = tokenize(freeParts.join(' '));
  const wholeQueryIsOneToken = tokens.length === 1 && tagSlugs.length === 0;
  const free = wholeQueryIsOneToken
    ? tokens
    : tokens.filter((t) => t.length >= MIN_TOKEN_LENGTH);

  if (tagParam) {
    const slug = slugify(tagParam);
    if (slug) tagSlugs.push(slug);
  }

  return { free, tagSlugs };
}

export function isEmptyQuery(pq: ParsedQuery): boolean {
  return pq.free.length === 0 && pq.tagSlugs.length === 0;
}

export function buildHaystack(node: Searchable): Haystack {
  return {
    title: normalizeText(node.title),
    tags: (node.tags ?? []).map((tag) => ({ tag, norm: normalizeText(tag.name) })),
  };
}

const NO_MATCH: MatchResult = { matched: false, viaTags: [] };
const EMPTY_MATCH: MatchResult = { matched: true, viaTags: [] };

export function matchHaystack(h: Haystack, pq: ParsedQuery): MatchResult {
  if (isEmptyQuery(pq)) return EMPTY_MATCH;

  const via = new Map<string, TagLike>();

  for (const slug of pq.tagSlugs) {
    const hit = h.tags.find((t) => t.tag.slug === slug);
    if (!hit) return NO_MATCH;
    via.set(hit.tag.id, hit.tag);
  }

  for (const token of pq.free) {
    if (h.title.includes(token)) continue;
    const hits = h.tags.filter((t) => t.norm.includes(token));
    if (hits.length === 0) return NO_MATCH;
    for (const hit of hits) via.set(hit.tag.id, hit.tag);
  }

  return { matched: true, viaTags: Array.from(via.values()) };
}

export function matchTopic(node: Searchable, q: string, tagParam?: string | null): MatchResult {
  return matchHaystack(buildHaystack(node), parseQuery(q, tagParam));
}
