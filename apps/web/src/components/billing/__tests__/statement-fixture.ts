import { vi } from 'vitest';
import type { MyBillingStatement } from '@web/lib/me-billing-api';
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
