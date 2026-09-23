import { describe, it, expect } from 'vitest';
import { dictEn } from '../dict-en';
import { dictPt } from '../dict-pt';

/**
 * Key parity across the two dictionaries is a compile-time guarantee
 * (`dictEn satisfies Dictionary`, where `Dictionary` is derived from `dictPt`).
 * What a type cannot catch is a Portuguese sentence copied into `dict-en`, and
 * the events board is where that would hurt most: it is the one surface a
 * stranger reads, and `NEXT_PUBLIC_LANGUAGE=en` is a whole deploy.
 */
function leafStrings(value: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof value === 'string') return [[path.join('.'), value]];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => leafStrings(child, [...path, key]));
}

describe('events dictionary', () => {
  it('carries the same key set in both languages', () => {
    const en = leafStrings(dictEn.events).map(([key]) => key);
    const pt = leafStrings(dictPt.events).map(([key]) => key);
    expect(en.sort()).toEqual(pt.sort());
  });

  it('resolves the contact label default per language, never in the API', () => {
    expect(dictPt.events.detail.contactDefaultLabel).toBe('Eu quero');
    expect(dictEn.events.detail.contactDefaultLabel).toBe("I'm interested");
  });

  it('formats dates with a locale per language', () => {
    expect(dictPt.events.locale).toBe('pt-BR');
    expect(dictEn.events.locale).toBe('en-US');
  });

  it('leaks no Portuguese literal into the English build', () => {
    // Words that only ever appear in the Portuguese copy of this section.
    const portuguese = /\b(evento|eventos|próximos|anteriores|entrar|cartaz|quando|onde)\b/i;

    for (const [key, value] of leafStrings(dictEn.events)) {
      expect(portuguese.test(value), `${key} = ${value}`).toBe(false);
    }
  });

  it('has no empty string in either language', () => {
    for (const [key, value] of [...leafStrings(dictEn.events), ...leafStrings(dictPt.events)]) {
      expect(value.trim(), key).not.toBe('');
    }
  });
});

/**
 * The milestone-wide sweep (Task 07).
 *
 * Tasks 05 and 06 introduced two whole sections — the public board and the
 * authoring backoffice — and the states added here finish them. The checks
 * below are the same three applied to the *admin* half, which nothing covered
 * before: the public board is the surface that would embarrass a dojo in front
 * of a stranger, but an `en` deploy whose backoffice is half in Portuguese is
 * just as broken, and only an English-speaking admin would ever find out.
 */
describe('events backoffice dictionary', () => {
  it('carries the same key set in both languages', () => {
    const en = leafStrings(dictEn.admin.events).map(([key]) => key);
    const pt = leafStrings(dictPt.admin.events).map(([key]) => key);
    expect(en.sort()).toEqual(pt.sort());
  });

  it('leaks no Portuguese literal into the English build', () => {
    const portuguese = /\b(evento|eventos|próximos|anteriores|entrar|cartaz|quando|onde)\b/i;

    for (const [key, value] of leafStrings(dictEn.admin.events)) {
      expect(portuguese.test(value), `${key} = ${value}`).toBe(false);
    }
  });

  it('has no empty string in either language', () => {
    const entries = [...leafStrings(dictEn.admin.events), ...leafStrings(dictPt.admin.events)];
    for (const [key, value] of entries) {
      expect(value.trim(), key).not.toBe('');
    }
  });
});

/**
 * Every state this task added exists in both languages, as a *distinct*
 * sentence.
 *
 * Parity alone would pass if a key were filled by copying its neighbour —
 * which is exactly how "no events yet" ends up on a board that failed to load.
 * The whole point of these states is that they are told apart, so the test
 * asserts they are different strings rather than merely present ones.
 */
describe('the board states say different things', () => {
  for (const [language, dict] of [
    ['pt', dictPt],
    ['en', dictEn],
  ] as const) {
    it(`separates empty, unavailable and past in ${language}`, () => {
      const board = dict.events.board;
      const distinct = [
        board.empty.upcomingTitle,
        board.empty.pastTitle,
        board.error.title,
        board.loading,
        dict.events.detail.pastBadge,
        dict.events.detail.notFoundTitle,
      ];
      expect(new Set(distinct).size).toBe(distinct.length);
    });

    it(`separates the admin empty state from the admin failure in ${language}`, () => {
      const list = dict.admin.events.list;
      const distinct = [list.emptyTitle, list.emptyFilteredTitle, list.errorTitle, list.loading];
      expect(new Set(distinct).size).toBe(distinct.length);
    });
  }
});
