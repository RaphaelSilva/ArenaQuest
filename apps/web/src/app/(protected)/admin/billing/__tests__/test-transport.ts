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
