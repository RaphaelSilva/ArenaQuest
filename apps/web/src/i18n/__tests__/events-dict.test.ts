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
