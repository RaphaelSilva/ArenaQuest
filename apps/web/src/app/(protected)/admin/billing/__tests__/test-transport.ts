import { vi } from 'vitest';

/**
 * A fake `HttpTransport` for the billing console tests.
 *
 * The tests drive the real `createAdminBillingApi` over it, so an assertion on
 * a request is an assertion on the URL and body that would actually go out —
 * which is what proves the standing filter round-trips to the server rather
 * than filtering a cached list.
 */
export type TransportHandler = (
  method: string,
  path: string,
  options?: { body?: string },
) => unknown;

export function makeTransport(handler: TransportHandler) {
  return vi.fn(async (method: string, path: string, options?: { body?: string }) => {
    const data = handler(method, path, options);
    return {
      ok: true,
      status: 200,
      json: async () => data ?? {},
    } as unknown as Response;
  });
}

/** One answer of the status-aware transport below. */
export type Reply = { status: number; body?: unknown };

/**
 * Like `makeTransport`, but the handler picks the HTTP status too — what the
 * online-payment surfaces need, since a refund's outcome and a reused payment
 * link are told apart by the status (`200` vs `201`) and by the refusal's code.
 */
export function makeStatusTransport(
  handler: (method: string, path: string, options?: { body?: string }) => Reply,
) {
  return vi.fn(async (method: string, path: string, options?: { body?: string }) => {
    const reply = handler(method, path, options);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? {},
    } as unknown as Response;
  });
}

/**
 * What `useAuthContext()` hands the gateway components in a test. The role is
 * the only field `useHasRole` reads; an `admin` sees the gateway actions and a
 * `content_creator` must see none.
 */
export const ADMIN_USER = { id: 'admin-1', roles: [{ name: 'admin' }] };
export const CONTENT_CREATOR_USER = { id: 'creator-1', roles: [{ name: 'content_creator' }] };
