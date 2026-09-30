/**
 * Opaque pagination cursor for keyset-paginated listings (RFC 0016 §5).
 *
 * On the wire a cursor is `base64url(sortKey|id)`; inside the API it is the
 * decoded `{ sortKey, id }` key the repositories page on. The encoding is an
 * HTTP concern — ports and controllers only ever see the decoded key — so a
 * client must treat the string as opaque and pass back exactly what it got.
 *
 * A cursor is a position, never a permission: the repository query decides the
 * audience, so a cursor copied from one listing cannot widen another.
 */

import type { Context } from 'hono';

export interface CursorKey {
  sortKey: string;
  id: string;
}

const SEPARATOR = '|';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** Encodes a page key into its opaque wire form. */
export function encodeCursor(key: CursorKey): string {
  return toBase64Url(`${key.sortKey}${SEPARATOR}${key.id}`);
}

/**
 * Decodes a wire cursor. Returns `null` for anything malformed — bad base64,
 * invalid UTF-8, a missing separator or an empty half — so the route can answer
 * `400 InvalidCursor` instead of guessing a position.
 *
 * The id is taken after the **last** separator: ids are UUIDs and never contain
 * one, while the sort key is a timestamp that does not either, so the split is
 * unambiguous for every cursor this module produced.
 */
export function decodeCursor(encoded: string): CursorKey | null {
  const decoded = fromBase64Url(encoded);
  if (decoded === null) return null;
  const at = decoded.lastIndexOf(SEPARATOR);
  if (at <= 0 || at === decoded.length - 1) return null;
  return { sortKey: decoded.slice(0, at), id: decoded.slice(at + 1) };
}

/**
 * Reads an optional `?cursor=` value: absent or empty → `null` (first page), a
 * valid cursor → its key, anything malformed → `undefined`, which the route
 * answers with {@link invalidCursorResponse}.
 */
export function parseCursorParam(raw: string | undefined): CursorKey | null | undefined {
  if (raw === undefined || raw === '') return null;
  return decodeCursor(raw) ?? undefined;
}

/** The `400` a malformed cursor earns. */
export function invalidCursorResponse(c: Context): Response {
  return c.json({ error: 'InvalidCursor' }, 400);
}
