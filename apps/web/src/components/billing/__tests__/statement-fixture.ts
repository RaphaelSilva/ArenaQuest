import { vi } from 'vitest';
import type {
  CheckoutSession,
  CheckoutStatus,
  MyBillingStatement,
  MyStatementCharge,
  PayOption,
  PendingCheckout,
} from '@web/lib/me-billing-api';
import type { BillingReportCurrency, Standing } from '@web/lib/admin-billing-api';

export const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };
export const JPY: BillingReportCurrency = { code: 'JPY', exponent: 0, symbol: '¥' };
export const BTC: BillingReportCurrency = { code: 'BTC', exponent: 8, symbol: '₿' };

/** A statement for a member who has never had a contract — the empty case. */
export function emptyStatement(overrides: Partial<MyBillingStatement> = {}): MyBillingStatement {
  return {
    userId: 'u1',
    asOf: '2026-09-01',
    standing: 'good',
    oldestOverdueDate: null,
    currency: BRL,
    studentSince: null,
    currentMembershipSince: null,
    outstandingMinor: 0,
    contractGroups: [],
    invoices: [],
    // What the API sends under `PAYMENTS_PROVIDERS = none`: nothing to pay with.
    payOptions: [],
    // The API always sends the extras rail; never charged reads as this.
    extras: { standing: 'good', oldestOverdueDate: null, outstandingMinor: 0, charges: [] },
    ...overrides,
  };
}

/** One event charge as the statement carries it: the charge, its event, its ledger. */
export function extrasCharge(
  overrides: Partial<MyStatementCharge> = {},
): MyStatementCharge {
  return {
    id: 'ch1',
    eventId: 'e1',
    userId: 'u1',
    description: 'Winter Seminar',
    amountMinor: 25000,
    currency: 'BRL',
    termsSource: 'standard',
    termsNote: '',
    dueDate: '2026-08-01',
    graceDays: 5,
    status: 'open',
    issuedBy: 'admin-1',
    issuedAt: '2026-07-01T00:00:00Z',
    voidedAt: null,
    voidReason: null,
    balanceMinor: 25000,
    adjustments: [],
    payments: [],
    eventTitle: 'Winter Seminar',
    eventStartsAt: '2026-07-18T09:00:00Z',
    pendingCheckout: null,
    ...overrides,
  };
}

export function statementWith(
  standing: Standing,
  overrides: Partial<MyBillingStatement> = {},
): MyBillingStatement {
  return emptyStatement({
    standing,
    outstandingMinor: 150000,
    studentSince: '2024-02-01',
    currentMembershipSince: '2026-01-01',
    contractGroups: [
      {
        contractGroupId: 'cg1',
        startDate: '2026-01-01',
        endDate: null,
        status: 'active',
        versions: [
          {
            id: 'sub1',
            userId: 'u1',
            planId: 'plan1',
            contractGroupId: 'cg1',
            supersedesId: null,
            termsSource: 'negotiated',
            amountMinor: 30000,
            currency: 'BRL',
            cycle: 'monthly',
            graceDays: 5,
            dueDay: 10,
            status: 'active',
            startDate: '2026-01-01',
            endDate: null,
            termsNote: 'Sibling discount agreed with the instructor.',
            signedBy: 'admin-1',
            signedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    ],
    invoices: [
      {
        id: 'inv1',
        subscriptionId: 'sub1',
        userId: 'u1',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        dueDate: '2026-07-10',
        amountMinor: 30000,
        currency: 'BRL',
        graceDays: 5,
        status: 'open',
        issuedAt: '2026-07-01T00:00:00Z',
        voidedAt: null,
        voidReason: null,
        balanceMinor: 20000,
        pendingCheckout: null,
        adjustments: [
          {
            id: 'adj1',
            invoiceId: 'inv1',
            kind: 'discount',
            amountMinor: -5000,
            reason: 'Two missed weeks.',
            appliedBy: 'admin-1',
            appliedAt: '2026-07-05T00:00:00Z',
          },
        ],
        payments: [
          {
            id: 'pay1',
            invoiceId: 'inv1',
            amountMinor: 5000,
            currency: 'BRL',
            method: 'pix',
            paidAt: '2026-07-08T00:00:00Z',
            externalReference: null,
            note: '',
            reversesId: null,
            recordedBy: 'admin-1',
            recordedAt: '2026-07-08T00:00:00Z',
          },
        ],
      },
    ],
    ...overrides,
  });
}

/**
 * A fake `HttpTransport` driving the real `createMeBillingApi`, so an assertion
 * on the call count is an assertion on requests that would actually go out.
 */
export function makeStatementTransport(next: () => MyBillingStatement | Error) {
  return vi.fn(async () => {
    const result = next();
    if (result instanceof Error) {
      return { ok: false, status: 500, json: async () => ({ error: 'BOOM' }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => result } as unknown as Response;
  });
}

// ---------------------------------------------------------------------------
// Online payment (RFC 0026) — shared by the statement and the dashboard card.
// ---------------------------------------------------------------------------

/** One provider offering Pix and card: the single-button case. */
export const ONE_PROVIDER: PayOption[] = [{ provider: 'mercadopago', methods: ['pix', 'card'] }];

/** Two providers, one method each, in the order the API lists them. */
export const TWO_PROVIDERS: PayOption[] = [
  { provider: 'mercadopago', methods: ['pix'] },
  { provider: 'stripe', methods: ['card'] },
];

export function pendingCheckout(overrides: Partial<PendingCheckout> = {}): PendingCheckout {
  return {
    checkoutId: 'co1',
    provider: 'mercadopago',
    createdAt: '2026-09-01T12:00:00.000Z',
    expiresAt: '2099-01-01T12:00:00.000Z',
    createdBy: 'u1',
    ...overrides,
  };
}

export function checkoutSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    checkoutId: 'co1',
    provider: 'mercadopago',
    url: 'https://pay.example.test/checkout/co1',
    expiresAt: '2099-01-01T12:00:00.000Z',
    amountMinor: 20000,
    currency: 'BRL',
    status: 'open',
    ...overrides,
  };
}

export function checkoutStatus(overrides: Partial<CheckoutStatus> = {}): CheckoutStatus {
  return {
    checkoutId: 'co1',
    provider: 'mercadopago',
    kind: 'invoice',
    receivableId: 'inv1',
    status: 'open',
    amountMinor: 20000,
    currency: 'BRL',
    createdAt: '2026-09-01T12:00:00.000Z',
    expiresAt: '2099-01-01T12:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

/**
 * A fake `HttpTransport` for the whole `/me/billing` surface: the statement,
 * `POST …/checkouts` and `GET …/checkouts/{id}`. Each handler is read at call
 * time, so a test can change what the API answers between two requests.
 */
export function makeBillingTransport(handlers: {
  statement: () => MyBillingStatement;
  createCheckout?: (body: Record<string, unknown>) => Reply | Promise<Reply>;
  getCheckout?: (checkoutId: string) => Reply | Promise<Reply>;
}) {
  const respond = (reply: Reply) =>
    ({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: new Headers(reply.headers ?? {}),
      json: async () => reply.body,
    }) as unknown as Response;

  return vi.fn(async (method: string, path: string, options?: { body?: unknown }) => {
    if (method === 'GET' && path === '/me/billing') {
      return respond({ status: 200, body: handlers.statement() });
    }
    if (method === 'POST' && path === '/me/billing/checkouts' && handlers.createCheckout) {
      const body = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
      return respond(await handlers.createCheckout(body));
    }
    if (method === 'GET' && path.startsWith('/me/billing/checkouts/') && handlers.getCheckout) {
      return respond(await handlers.getCheckout(path.slice('/me/billing/checkouts/'.length)));
    }
    return respond({ status: 404, body: { error: 'NotFound' } });
  });
}
