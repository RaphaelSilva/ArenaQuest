/**
 * The two dictionaries carry the same keys, or neither does.
 *
 * `Dictionary` is derived from `dictPt` alone, and `get-dict` picks one or the
 * other by env var, so nothing in the type system compares them. A key added to
 * one language and forgotten in the other therefore type-checks, passes the
 * hardcoded-string scan, and ships as `undefined` in the build that missed it —
 * visible only to whoever runs that language.
 */

import { describe, it, expect } from 'vitest';
import { dictEn } from '@web/i18n/dict-en';
import { dictPt } from '@web/i18n/dict-pt';

/** Every leaf path, with the kind of value it holds. */
function paths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'function') return [`${prefix}:function`];
  if (node === null || typeof node !== 'object') return [`${prefix}:value`];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    paths(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('dictionary parity', () => {
  it('declares identical keys, of the same kind, in both languages', () => {
    const en = paths(dictEn).sort();
    const pt = paths(dictPt).sort();

    expect(en.filter((key) => !pt.includes(key))).toEqual([]);
    expect(pt.filter((key) => !en.includes(key))).toEqual([]);
  });

  it('leaves no entry empty in either language', () => {
    const empties: string[] = [];
    const walk = (node: unknown, prefix: string, language: string) => {
      if (typeof node === 'string' && node.trim() === '') empties.push(`${language}:${prefix}`);
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          walk(value, prefix ? `${prefix}.${key}` : key, language);
        }
      }
    };
    walk(dictEn, '', 'en');
    walk(dictPt, '', 'pt');
    expect(empties).toEqual([]);
  });
});
