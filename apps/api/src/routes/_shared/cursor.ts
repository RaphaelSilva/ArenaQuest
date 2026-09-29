/**
 * Opaque keyset cursors for paginated listings (RFC 0020 section 10; the
 * helper RFC 0016 notes will reuse).
 *
 * The repository speaks in a decoded {@link CursorPosition} (`sortKey`, `id`);
 * clients only ever see the opaque string: base64url (no padding) of
 * `sortKey|id`. Decoding is strict — a malformed cursor is rejected, never
 * coerced — but a well-formed crafted cursor is harmless by construction: it
 * only moves the page position, while the scope's WHERE clause still decides
 * which rows are eligible.
 */
import type { CursorPosition } from '@arenaquest/shared/ports';

const MAX_CURSOR_LENGTH = 256;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SORT_KEY = /^[\x20-\x7E]{1,64}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;

export type DecodedCursor = { ok: true; after: CursorPosition | null } | { ok: false };

export function encodeCursor(position: CursorPosition): string {
  return btoa(`${position.sortKey}|${position.id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Absent or empty → first page (`after: null`); malformed → `{ ok: false }` (answer 400). */
export function decodeCursor(raw: string | null | undefined): DecodedCursor {
  if (raw === undefined || raw === null || raw === '') return { ok: true, after: null };
  if (raw.length > MAX_CURSOR_LENGTH || !BASE64URL.test(raw)) return { ok: false };

  let decoded: string;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    decoded = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return { ok: false };
  }

  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) return { ok: false };
  const sortKey = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!SORT_KEY.test(sortKey) || !ID.test(id)) return { ok: false };

  return { ok: true, after: { sortKey, id } };
}
