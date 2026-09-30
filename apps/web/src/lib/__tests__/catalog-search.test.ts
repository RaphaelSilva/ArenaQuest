import { describe, it, expect } from 'vitest';
import {
  buildHaystack,
  isEmptyQuery,
  matchHaystack,
  matchTopic,
  parseQuery,
  type TagLike,
} from '../catalog-search';

const tag = (id: string, name: string, slug: string): TagLike => ({ id, name, slug });

const SOCO = tag('t-soco', 'Soco', 'soco');
const FAIXA = tag('t-faixa', 'Faixa Amarela', 'faixa-amarela');
const CHUDAN = tag('t-chudan', 'Chūdan', 'chudan');

describe('parseQuery', () => {
  it('splits free tokens and #slug terms', () => {
    expect(parseQuery('tsuki #Soco')).toEqual({ free: ['tsuki'], tagSlugs: ['soco'] });
  });

  it('adds the ?tag= parameter as a tag slug', () => {
    expect(parseQuery('kata', 'Faixa Amarela')).toEqual({ free: ['kata'], tagSlugs: ['faixa-amarela'] });
  });

  it('ignores a lone # term', () => {
    expect(parseQuery('#')).toEqual({ free: [], tagSlugs: [] });
  });

  it('ignores a 1-character token in a multi-token query', () => {
    expect(parseQuery('a chudan').free).toEqual(['chudan']);
  });

  it('honours a 1-character token when it is the whole query', () => {
    expect(parseQuery('a').free).toEqual(['a']);
  });

  it('reports an empty query', () => {
    expect(isEmptyQuery(parseQuery('   '))).toBe(true);
    expect(isEmptyQuery(parseQuery('', 'soco'))).toBe(false);
  });
});

describe('matchTopic — RFC 0017 Motivation rows', () => {
  it('`chudan` matches "Chūdan" by title', () => {
    expect(matchTopic({ title: 'Chūdan', tags: [] }, 'chudan')).toEqual({ matched: true, viaTags: [] });
  });

  it('`tsuki chudan` matches "Chūdan Tsuki" in any order', () => {
    expect(matchTopic({ title: 'Chūdan Tsuki', tags: [] }, 'tsuki chudan').matched).toBe(true);
  });

  it('`kata  basica` matches "Kata Básica" despite extra whitespace and accents', () => {
    expect(matchTopic({ title: 'Kata Básica', tags: [] }, 'kata  basica').matched).toBe(true);
  });

  it('`soco` matches a topic tagged "Soco" whose title lacks it, and explains via the tag', () => {
    const r = matchTopic({ title: 'Oi Tsuki', tags: [SOCO] }, 'soco');
    expect(r).toEqual({ matched: true, viaTags: [SOCO] });
  });

  it('`faixa amarela` matches a topic tagged "Faixa Amarela"', () => {
    const r = matchTopic({ title: 'Kihon', tags: [FAIXA, SOCO] }, 'faixa amarela');
    expect(r).toEqual({ matched: true, viaTags: [FAIXA] });
  });
});

describe('matchTopic — tag terms and composition', () => {
  it('`#soco` requires the exact tag slug', () => {
    expect(matchTopic({ title: 'Oi Tsuki', tags: [SOCO] }, '#soco')).toEqual({ matched: true, viaTags: [SOCO] });
    expect(matchTopic({ title: 'Soco', tags: [] }, '#soco').matched).toBe(false);
  });

  it('`#so` does not match by slug prefix', () => {
    expect(matchTopic({ title: 'Oi Tsuki', tags: [SOCO] }, '#so').matched).toBe(false);
  });

  it('composes ?tag= with q (both must hold)', () => {
    const node = { title: 'Oi Tsuki', tags: [SOCO] };
    expect(matchTopic(node, 'tsuki', 'soco')).toEqual({ matched: true, viaTags: [SOCO] });
    expect(matchTopic(node, 'mae', 'soco').matched).toBe(false);
    expect(matchTopic({ title: 'Oi Tsuki', tags: [] }, 'tsuki', 'soco').matched).toBe(false);
  });

  it('mixes title and tag tokens, explaining only the tag part', () => {
    const r = matchTopic({ title: 'Chūdan Tsuki', tags: [SOCO, CHUDAN] }, 'tsuki soco');
    expect(r).toEqual({ matched: true, viaTags: [SOCO] });
  });

  it('a title-only hit has no viaTags', () => {
    expect(matchTopic({ title: 'Chūdan Tsuki', tags: [CHUDAN] }, 'chudan').viaTags).toEqual([]);
  });

  it('does not match when a token is in neither title nor tags', () => {
    expect(matchTopic({ title: 'Chūdan Tsuki', tags: [SOCO] }, 'tsuki geri')).toEqual({
      matched: false,
      viaTags: [],
    });
  });

  it('an empty query matches everything with no viaTags', () => {
    expect(matchTopic({ title: 'Anything', tags: null }, '')).toEqual({ matched: true, viaTags: [] });
  });

  it('keeps title-substring behaviour (no regression)', () => {
    expect(matchTopic({ title: 'Grandchild Topic' }, 'Grandchild').matched).toBe(true);
    expect(matchTopic({ title: 'Força e Potência' }, 'Força').matched).toBe(true);
  });

  it('matchHaystack reuses a precomputed haystack', () => {
    const h = buildHaystack({ title: 'Oi Tsuki', tags: [SOCO] });
    expect(matchHaystack(h, parseQuery('soco')).matched).toBe(true);
    expect(matchHaystack(h, parseQuery('geri')).matched).toBe(false);
  });
});
