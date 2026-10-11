import type { MiddlewareHandler } from 'hono';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import '@api/types/hono-env';

/** The one status value the gate reacts to. */
export const PUBLISH_STATUS = 'published';

export type PublishGateMethod = 'POST' | 'PATCH' | 'PUT';

export interface PublishGateOptions {
  /** HTTP methods whose body is inspected. Defaults to `['PATCH']`. */
  methods?: ReadonlyArray<PublishGateMethod>;
}

const DEFAULT_METHODS: ReadonlyArray<PublishGateMethod> = ['PATCH'];

/**
 * Admin-only, **on the publish transition alone**.
 *
 * `routes/admin/billing.ts` sets the precedent for a sub-router that is
 * stricter than the `/v1/admin/*` umbrella, but it applies `requireRole` to the
 * whole router. Doing that on an authoring router would lock a
 * `content_creator` out of the drafts they are employed to write. The gate is
 * therefore conditional on the payload: publishing puts a page on the open
 * internet — for events, a person's phone number too — and that act is an
 * admin's; every other write, `archived` included, stays open to both roles.
 *
 * Shared by the events router (PATCH only, the default) and the topics router
 * (POST on the collection and PATCH on an item, because topics — unlike
 * events — accept a status on create). This is layer 3 of RFC 0025 §2: the
 * assistant's account is a content creator, so no tool path can publish even
 * if a tool were wrong.
 *
 * Reading the body here is safe — `HonoRequest.json()` caches its parse, so the
 * Zod validator downstream sees the same object rather than a consumed stream.
 * A body that is not JSON is passed through untouched, so the validator (and
 * not this middleware) owns the `400`.
 */
export function publishGate(options: PublishGateOptions = {}): MiddlewareHandler {
  const methods = options.methods ?? DEFAULT_METHODS;

  return async (c, next) => {
    if (!methods.includes(c.req.method as PublishGateMethod)) return next();

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return next();
    }

    const status = (body as { status?: unknown } | null)?.status;
    if (status !== PUBLISH_STATUS) return next();

    return requireRole(ROLES.ADMIN)(c, next);
  };
}
