import type { HttpTransport } from './api-client';
import type { BillingStudentStatement, Standing } from './admin-billing-api';

// ---------------------------------------------------------------------------
// Client for `GET /v1/me/billing` — the caller's own statement (RFC 0013 §3).
//
// The endpoint is self-only by construction: it declares no path parameter, no
// query, no header and no body, because the subject is the `sub` of the
// verified access token. The method below therefore takes **no argument** —
// there is nothing a caller could pass that would name another student, and
// inventing a parameter here would only suggest otherwise.
//
// The statement shape is the admin one plus the resolved standing, so the
// wire types are imported from `admin-billing-api` rather than declared a
// second time: the student and the admin read the same statement.
// ---------------------------------------------------------------------------

/**
 * The caller's statement. `standing` is resolved by the API on every read from
 * the invoices, the hold and `asOf`. It is a label and nothing else: no route,
 * screen or control anywhere in this app is gated on it.
 */
export type MyBillingStatement = BillingStudentStatement & {
  asOf: string;
  standing: Standing;
  oldestOverdueDate: string | null;
};

export class MeBillingApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'MeBillingApiError';
  }

  /** The server's human-readable explanation, when it sent one. */
  get detailMessage(): string | null {
    return typeof this.details.message === 'string' ? this.details.message : null;
  }
}

export function createMeBillingApi(http: HttpTransport) {
  return {
    /** The caller's own statement. Takes no parameter — the endpoint accepts none. */
    async getMyStatement(): Promise<MyBillingStatement> {
      const res = await http('GET', '/me/billing');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new MeBillingApiError(
          typeof body.error === 'string' ? body.error : 'MY_BILLING_STATEMENT_FAILED',
          res.status,
          body,
        );
      }
      return (await res.json()) as MyBillingStatement;
    },
  };
}
