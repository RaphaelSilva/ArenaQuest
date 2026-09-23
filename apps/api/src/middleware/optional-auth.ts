import type { Context, MiddlewareHandler } from 'hono';
import type { VerifiedToken } from '@arenaquest/shared/ports';
import '@api/types/hono-env';

/**
 * The first middleware in this codebase that does **not** reject.
 *
 * `authGuard` answers `401` for a missing or unverifiable token. That is the
 * right answer for a member surface and the wrong one for the events board,
 * which is reachable without an account: a reader whose session expired while
 * the tab was open must see the public page, not an error. So this is a sibling
 * of `authGuard`, not a flag on it — the guard keeps exactly one behaviour and
 * this file keeps the other, and no existing route changes meaning.
 *
 * Contract, in order of how easy each is to break:
 *
 * 1. **It never returns a status.** Missing, malformed, unverifiable and
 *    expired tokens all fall through to `next()`. Adding a single early
 *    `return c.json(...)` here would turn every route beneath it into an
 *    authenticated one.
 * 2. **It sets `user` only on a positive verification.** Downstream code reads
 *    the audience from `c.get('user')`, so anything less than a verified
 *    payload must leave the context untouched and the caller anonymous.
 * 3. **A thrown verification is not silently an anonymous read.** See below.
 */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  const token = readBearerToken(c.req.header('Authorization'));

  if (token !== null) {
    try {
      const payload = await c.get('auth').verifyAccessToken(token);
      // `null` is the adapter's ordinary answer for expired, tampered or
      // foreign-signed tokens. It is not an error here — it is anonymity.
      if (payload) c.set('user', payload);
    } catch (error) {
      // A *throw* is a different event: the adapter failed rather than
      // declined, e.g. Web Crypto refused the key. Degrading to anonymous is
      // still the chosen behaviour — this surface has a correct anonymous
      // answer and a 500 on a public page would be worse than a narrower one —
      // but it is logged rather than swallowed, so a broken JWT_SECRET shows up
      // as noise in the logs instead of as a silent, permanent downgrade of
      // every signed-in reader.
      console.error('[optional-auth] access token verification threw; proceeding anonymously', error);
    }
  }

  await next();
};

/**
 * The viewer identity the audience rule is resolved against, or `null`.
 *
 * Deliberately the only way a handler beneath {@link optionalAuth} learns who
 * is calling: audience is never a request parameter, so there is no query,
 * header or body field to read instead of this.
 */
export function resolveViewerUserId(c: Context): string | null {
  // `hono-env` types `user` as always present because `authGuard` sets it
  // before any handler runs. Under `optionalAuth` it legitimately may not be.
  const user = c.get('user') as VerifiedToken | undefined;
  return typeof user?.sub === 'string' && user.sub.length > 0 ? user.sub : null;
}

/**
 * Extracts the raw token from an `Authorization` header, or `null`.
 *
 * Anything that is not a non-empty `Bearer <token>` is treated as "no token"
 * rather than as a bad one, because the two outcomes are identical here and
 * collapsing them removes a branch that could grow a status code later.
 */
function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}
