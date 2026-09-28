import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, parseCursorParam } from '@api/routes/_shared/cursor';

describe('cursor helper', () => {
  it('round-trips a key', () => {
    const key = { sortKey: '2026-09-28 12:34:56', id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it('produces a URL-safe string without padding', () => {
    const encoded = encodeCursor({ sortKey: '2026-09-28 12:34:56', id: '??>>' });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('round-trips non-ASCII content', () => {
    const key = { sortKey: 'Chūdan', id: 'id-1' };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it.each([
    ['empty', ''],
    ['non-base64 characters', 'not base64!'],
    ['no separator', btoa('no-separator').replace(/=+$/, '')],
    ['empty sort key', encodeCursor({ sortKey: '', id: 'x' })],
    ['empty id', encodeCursor({ sortKey: 'x', id: '' })],
    ['invalid UTF-8', btoa(String.fromCharCode(0xff, 0x7c, 0x61)).replace(/=+$/, '')],
  ])('rejects %s', (_label, raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });

  it('parses the query parameter: absent → first page, malformed → undefined', () => {
    expect(parseCursorParam(undefined)).toBeNull();
    expect(parseCursorParam('')).toBeNull();
    expect(parseCursorParam('!!')).toBeUndefined();
    expect(parseCursorParam(encodeCursor({ sortKey: 's', id: 'i' }))).toEqual({ sortKey: 's', id: 'i' });
  });
});
