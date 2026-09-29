import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '@api/routes/_shared/cursor';

describe('opaque cursor helper', () => {
  const pos = { sortKey: '2026-09-29 12:34:56', id: '6f1c2d3e-0000-4000-8000-123456789abc' };

  it('round-trips a position through an opaque base64url string', () => {
    const raw = encodeCursor(pos);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(raw).not.toContain(pos.id);
    expect(decodeCursor(raw)).toEqual({ ok: true, after: pos });
  });

  it('treats an absent or empty cursor as the first page', () => {
    expect(decodeCursor(undefined)).toEqual({ ok: true, after: null });
    expect(decodeCursor(null)).toEqual({ ok: true, after: null });
    expect(decodeCursor('')).toEqual({ ok: true, after: null });
  });

  it('splits on the last separator', () => {
    const raw = encodeCursor({ sortKey: 'a|b', id: 'abc' });
    expect(decodeCursor(raw)).toEqual({ ok: true, after: { sortKey: 'a|b', id: 'abc' } });
  });

  it.each([
    ['non-base64url characters', 'abc$%^'],
    ['standard base64 padding', `${btoa('x|y')}=`],
    ['no separator', btoa('nosep').replace(/=+$/, '')],
    ['empty sort key', btoa('|abc').replace(/=+$/, '')],
    ['id with SQL', btoa("2026-01-01|x' OR 1=1").replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')],
    ['oversized', 'A'.repeat(300)],
  ])('rejects a malformed cursor (%s)', (_label, raw) => {
    expect(decodeCursor(raw)).toEqual({ ok: false });
  });
});
