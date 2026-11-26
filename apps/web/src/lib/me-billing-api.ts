import type { HttpTransport } from './api-client';
import type {
  BillingStatementCharge,
  BillingStatementExtras,
  BillingStatementInvoice,
  BillingStudentStatement,
  Standing,
} from './admin-billing-api';
import type { components } from './api-types.gen';

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

// ---------------------------------------------------------------------------
// Online payment (RFC 0026 §3, §7) — wire shapes straight from the generated
// OpenAPI types, so a contract change fails `tsc` here rather than at runtime.
// ---------------------------------------------------------------------------

type Schemas = components['schemas'];

/** One provider and the methods it offers on this label, in the API's order. */
export type PayOption = Schemas['PayOption'];
export type PayMethod = PayOption['methods'][number];
/** The live hosted checkout on a receivable. It carries **no URL** by design. */
export type PendingCheckout = NonNullable<Schemas['PendingCheckout']>;
export type CheckoutSession = Schemas['CheckoutSession'];
export type CheckoutStatus = Schemas['CheckoutStatus'];
export type ReceivableKind = CheckoutStatus['kind'];

export type CreateCheckoutInput = {
  kind: ReceivableKind;
  id: string;
  /** Omitted when exactly one provider offers a method; required otherwise. */
  provider?: string;
};

export type MyStatementInvoice = BillingStatementInvoice & {
  pendingCheckout: PendingCheckout | null;
};
export type MyStatementCharge = BillingStatementCharge & {
  pendingCheckout: PendingCheckout | null;
};

/**
 * The caller's statement. `standing` is resolved by the API on every read from
 * the invoices, the hold and `asOf`. It is a label and nothing else: no route,
 * screen or control anywhere in this app is gated on it.
 *
 * `payOptions` is what the label offers online (`[]` when nothing is — the
 * statement never fails on payment configuration), and every receivable
 * carries its `pendingCheckout`.
 */
export type MyBillingStatement = Omit<BillingStudentStatement, 'invoices' | 'extras'> & {
  asOf: string;
  standing: Standing;
  oldestOverdueDate: string | null;
  payOptions: PayOption[];
  invoices: MyStatementInvoice[];
  extras: Omit<BillingStatementExtras, 'charges'> & { charges: MyStatementCharge[] };
};

/**
 * Why a checkout call was refused, as the UI needs to tell them apart. Every
 * code `POST /v1/me/billing/checkouts` and `GET …/checkouts/{id}` document maps
 * to exactly one kind; anything else is `unknown`.
 */
export type CheckoutErrorKind =
  /** `409 RECEIVABLE_NOT_PAYABLE` · `409 PAYMENTS_UNSUPPORTED_CURRENCY` — the receivable changed underneath. */
  | 'not_payable'
  /** `502 PAYMENTS_PROVIDER_ERROR` — the provider failed; trying again may work. */
  | 'provider_unavailable'
  /** `429 TooManyRequests` — ten new checkouts an hour. */
  | 'too_many_attempts'
  /** `500 PAYMENTS_CONFIG_INVALID` — nothing the student can fix. */
  | 'configuration'
  /** `409 CHECKOUT_IN_PROGRESS` — lost a double-click race, even after one retry. */
  | 'in_progress'
  /** `400 PAYMENT_PROVIDER_REQUIRED` — the offered providers changed since the statement was read. */
  | 'provider_required'
  /** `404 NotFound` — no provider bound, or the receivable / checkout is not the caller's. */
  | 'not_found'
  | 'unknown';

const CHECKOUT_ERROR_KINDS: Record<string, CheckoutErrorKind> = {
  RECEIVABLE_NOT_PAYABLE: 'not_payable',
  PAYMENTS_UNSUPPORTED_CURRENCY: 'not_payable',
  PAYMENTS_PROVIDER_ERROR: 'provider_unavailable',
  TooManyRequests: 'too_many_attempts',
  PAYMENTS_CONFIG_INVALID: 'configuration',
  CHECKOUT_IN_PROGRESS: 'in_progress',
  PAYMENT_PROVIDER_REQUIRED: 'provider_required',
  NotFound: 'not_found',
};

/** The kinds after which the statement no longer describes the receivable. */
const STALE_STATEMENT_KINDS: readonly CheckoutErrorKind[] = [
  'not_payable',
  'in_progress',
  'provider_required',
  'not_found',
];

export class MeBillingApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'MeBillingApiError';
  }

  /** The refusal as the pay UI distinguishes it; a transport failure is `unknown`. */
  get checkoutKind(): CheckoutErrorKind {
    if (this.status === 429) return 'too_many_attempts';
    return CHECKOUT_ERROR_KINDS[this.code] ?? 'unknown';
  }

  /** True when the receivable changed underneath and the statement should be read again. */
  get statementIsStale(): boolean {
    return STALE_STATEMENT_KINDS.includes(this.checkoutKind);
  }

  /** Seconds from a `429`'s `Retry-After` header, when the server sent one. */
  get retryAfterSeconds(): number | null {
    const value = this.details.retryAfterSeconds;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  /** The server's human-readable explanation, when it sent one. */
  get detailMessage(): string | null {
    return typeof this.details.message === 'string' ? this.details.message : null;
  }
}

/** How long a lost creation race waits before its single retry. */
export const CHECKOUT_RETRY_DELAY_MS = 800;

async function toError(res: Response, fallback: string): Promise<MeBillingApiError> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const retryAfter = Number(res.headers?.get?.('Retry-After'));
  return new MeBillingApiError(
    typeof body.error === 'string' ? body.error : fallback,
    res.status,
    Number.isFinite(retryAfter) && retryAfter > 0
      ? { ...body, retryAfterSeconds: retryAfter }
      : body,
  );
}

export type MeBillingApiOptions = {
  /** Injectable for tests; defaults to a real timer. */
  wait?: (ms: number) => Promise<void>;
};

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createMeBillingApi(http: HttpTransport, options: MeBillingApiOptions = {}) {
  const wait = options.wait ?? defaultWait;

  async function postCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    // Exactly the three keys the strict body accepts — never a user id.
    const body: CreateCheckoutInput = { kind: input.kind, id: input.id };
    if (input.provider !== undefined) body.provider = input.provider;
    const res = await http('POST', '/me/billing/checkouts', { body: JSON.stringify(body) });
    if (!res.ok) throw await toError(res, 'CHECKOUT_CREATE_FAILED');
    return (await res.json()) as CheckoutSession;
  }

  return {
    /** The caller's own statement. Takes no parameter — the endpoint accepts none. */
    async getMyStatement(): Promise<MyBillingStatement> {
      const res = await http('GET', '/me/billing');
      if (!res.ok) throw await toError(res, 'MY_BILLING_STATEMENT_FAILED');
      return (await res.json()) as MyBillingStatement;
    },

    /**
     * Creates the hosted checkout for one of the caller's receivables, or gets
     * the open one back (`201` and `200` carry the same body). *Open again* is
     * this same call with `provider: pendingCheckout.provider`.
     *
     * A `409 CHECKOUT_IN_PROGRESS` (a double click whose winner has no session
     * yet) is retried **once** after a short wait; a second one is thrown.
     */
    async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
      try {
        return await postCheckout(input);
      } catch (err) {
        if (!(err instanceof MeBillingApiError) || err.checkoutKind !== 'in_progress') throw err;
        await wait(CHECKOUT_RETRY_DELAY_MS);
        return postCheckout(input);
      }
    },

    /** One of the caller's own checkouts. The status is the row's own; there is no URL here. */
    async getCheckout(checkoutId: string): Promise<CheckoutStatus> {
      const res = await http('GET', `/me/billing/checkouts/${encodeURIComponent(checkoutId)}`);
      if (!res.ok) throw await toError(res, 'CHECKOUT_STATUS_FAILED');
      return (await res.json()) as CheckoutStatus;
    },
  };
}
