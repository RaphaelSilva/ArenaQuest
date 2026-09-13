import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

/**
 * The three read-only reports over HTTP, against real SQLite.
 *
 * What only this layer can assert: the reports really are ADMIN-only, the
 * currency really does come from the `currencies` table (including a row
 * inserted after deploy), and a full report sweep really writes nothing — the
 * snapshot below reads every billing table before and after and deep-compares,
 * which is the one cheap guard against a report quietly repairing a cache.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ADMIN_ID = 'report-admin';
const STUDENT_A = 'report-student-a';
const STUDENT_B = 'report-student-b';
const STUDENT_C = 'report-student-c';

/** Every table migration 0026 creates, in the order the snapshot reads them. */
const BILLING_TABLES = [
  'currencies',
  'billing_plans',
  'subscriptions',
  'invoices',
  'invoice_adjustments',
  'payments',
  'billing_standing_holds',
] as const;

let adminToken: string;
let creatorToken: string;
let tutorToken: string;
let studentToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  await env.DB.batch(
    [
      [ADMIN_ID, 'Report Admin'],
      [STUDENT_A, 'Student A'],
      [STUDENT_B, 'Student B'],
      [STUDENT_C, 'Student C'],
    ].map(([id, name]) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      ).bind(id, name, `${id}@billing.test`, 'hash'),
    ),
  );

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, creatorToken, tutorToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'admin@r.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'r-cc', email: 'cc@r.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: 'r-tutor', email: 'tutor@r.test', roles: ['tutor'] }),
    adapter.signAccessToken({ sub: STUDENT_A, email: 's@r.test', roles: ['student'] }),
  ]);
});

async function billing(
  method: string,
  path: string,
  body?: unknown,
  token = adminToken,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const request = new IncomingRequest(`http://example.com${v1(`/admin/billing${path}`)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function jsonOf<T>(res: Response, expected: number): Promise<T> {
  if (res.status !== expected) {
    throw new Error(`expected ${expected}, got ${res.status}: ${await res.text()}`);
  }
  return res.json<T>();
}

type ReportCurrency = { code: string; exponent: number; symbol: string };
type MovementReport = {
  month: string;
  periodStart: string;
  periodEnd: string;
  currency: ReportCurrency;
  invoicedMinor: number;
  adjustmentsMinor: number;
  billedMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  invoicesIssued: number;
  activeStudents: number;
};
type AgingReport = {
  asOf: string;
  currency: ReportCurrency;
  buckets: Array<{ bucket: string; totalMinor: number; invoiceCount: number }>;
  totalMinor: number;
  invoiceCount: number;
};
type Statement = {
  userId: string;
  currency: ReportCurrency;
  studentSince: string | null;
  currentMembershipSince: string | null;
  outstandingMinor: number;
  contractGroups: Array<{
    contractGroupId: string;
    startDate: string;
    endDate: string | null;
    status: string;
    versions: Array<{ id: string }>;
  }>;
  invoices: Array<{
    id: string;
    balanceMinor: number;
    adjustments: unknown[];
    payments: unknown[];
  }>;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createPlan(currency = 'BRL', amountMinor = 15000): Promise<string> {
  const plan = await jsonOf<{ id: string }>(
    await billing('POST', '/plans', {
      name: `Plan ${crypto.randomUUID()}`,
      amountMinor,
      currency,
      cycle: 'monthly',
      graceDays: 5,
    }),
    201,
  );
  return plan.id;
}

async function signContract(
  userId: string,
  planId: string,
  startDate: string,
): Promise<{ id: string; contractGroupId: string }> {
  return jsonOf(
    await billing('POST', '/subscriptions', { userId, planId, dueDay: 10, startDate }),
    201,
  );
}

/**
 * Inserts an invoice directly.
 *
 * `issued_at` and a drifted `status` are the two things the lifecycle API
 * cannot produce on purpose, and both are exactly what these reports must be
 * pinned against.
 */
async function insertInvoice(row: {
  id: string;
  subscriptionId: string;
  userId: string;
  amountMinor: number;
  dueDate: string;
  issuedAt: string;
  currency?: string;
  status?: 'open' | 'paid' | 'void';
  periodStart?: string;
}): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO invoices
       (id, subscription_id, user_id, period_start, period_end, due_date,
        amount_minor, currency, grace_days, status, issued_at, voided_at, void_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.subscriptionId,
      row.userId,
      row.periodStart ?? row.dueDate,
      '2099-01-01',
      row.dueDate,
      row.amountMinor,
      row.currency ?? 'BRL',
      row.status ?? 'open',
      row.issuedAt,
      row.status === 'void' ? row.issuedAt : null,
      row.status === 'void' ? 'fixture' : null,
    )
    .run();
  return row.id;
}

async function insertPayment(invoiceId: string, amountMinor: number, paidAt: string, currency = 'BRL') {
  await env.DB.prepare(
    `INSERT INTO payments (id, invoice_id, amount_minor, currency, method, paid_at, note, recorded_by)
     VALUES (?, ?, ?, ?, 'pix', ?, 'fixture', ?)`,
  )
    .bind(crypto.randomUUID(), invoiceId, amountMinor, currency, paidAt, ADMIN_ID)
    .run();
}

async function insertAdjustment(invoiceId: string, amountMinor: number, appliedAt: string) {
  await env.DB.prepare(
    `INSERT INTO invoice_adjustments (id, invoice_id, kind, amount_minor, reason, applied_by, applied_at)
     VALUES (?, ?, 'discount', ?, 'fixture', ?, ?)`,
  )
    .bind(crypto.randomUUID(), invoiceId, amountMinor, ADMIN_ID, appliedAt)
    .run();
}

/** `asOf` minus `days`, so a boundary fixture states its intent in days. */
function daysBefore(asOf: string, days: number): string {
  return new Date(Date.parse(`${asOf}T00:00:00.000Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Monthly movement
// ---------------------------------------------------------------------------

describe('GET /reports/movement', () => {
  it('reconciles to the month ledger written through the lifecycle endpoints', async () => {
    // `issued_at` and `applied_at` default to now, so the month under test is
    // this one — which is also the honest end-to-end path through Task 03.
    const month = new Date().toISOString().slice(0, 7);
    const [year, monthIndex] = month.split('-').map(Number);
    const periodStart = `${month}-01`;
    const periodEnd = new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);

    const planId = await createPlan();
    const contractA = await signContract(STUDENT_A, planId, periodStart);
    const contractB = await signContract(STUDENT_B, planId, periodStart);

    const invoiceA = await jsonOf<{ id: string }>(
      await billing('POST', '/invoices', {
        subscriptionId: contractA.id,
        periodStart,
        periodEnd,
        dueDate: `${month}-10`,
        amountMinor: 15000,
      }),
      201,
    );
    await jsonOf(
      await billing('POST', '/invoices', {
        subscriptionId: contractB.id,
        periodStart,
        periodEnd,
        dueDate: `${month}-10`,
        amountMinor: 10000,
      }),
      201,
    );

    await jsonOf(
      await billing('POST', `/invoices/${invoiceA.id}/adjustments`, {
        kind: 'discount',
        amountMinor: -5000,
        reason: 'Camp week missed.',
      }),
      201,
    );
    const payment = await jsonOf<{ id: string }>(
      await billing('POST', `/invoices/${invoiceA.id}/payments`, {
        amountMinor: 10000,
        method: 'pix',
      }),
      201,
    );
    await jsonOf(
      await billing('POST', `/payments/${payment.id}/reverse`, { reason: 'Transfer bounced.' }),
      201,
    );

    const report = await jsonOf<MovementReport>(
      await billing('GET', `/reports/movement?month=${month}`),
      200,
    );

    expect(report).toMatchObject({
      month,
      periodStart,
      invoicedMinor: 25000,
      adjustmentsMinor: -5000,
      billedMinor: 20000,
      // The reversal cancels the payment inside the same month.
      receivedMinor: 0,
      outstandingMinor: 20000,
      invoicesIssued: 2,
      activeStudents: 2,
    });
    expect(report.currency).toEqual({ code: 'BRL', exponent: 2, symbol: 'R$' });
  });

  it("bills August and receives in September for one invoice paid late", async () => {
    const planId = await createPlan();
    const contract = await signContract(STUDENT_A, planId, '2026-01-01');
    const invoice = await insertInvoice({
      id: 'inv-late-payer',
      subscriptionId: contract.id,
      userId: STUDENT_A,
      amountMinor: 20000,
      dueDate: '2026-08-10',
      issuedAt: '2026-08-01 09:00:00',
    });
    await insertPayment(invoice, 20000, '2026-09-03');

    const august = await jsonOf<MovementReport>(
      await billing('GET', '/reports/movement?month=2026-08'),
      200,
    );
    const september = await jsonOf<MovementReport>(
      await billing('GET', '/reports/movement?month=2026-09'),
      200,
    );

    expect(august).toMatchObject({
      periodEnd: '2026-08-31',
      invoicedMinor: 20000,
      receivedMinor: 0,
      outstandingMinor: 20000,
    });
    expect(september).toMatchObject({
      periodEnd: '2026-09-30',
      invoicedMinor: 0,
      receivedMinor: 20000,
      outstandingMinor: 0,
    });
  });

  it('counts an amended student once across a three-version chain', async () => {
    const planId = await createPlan();
    const contract = await signContract(STUDENT_A, planId, '2026-01-01');
    await jsonOf(
      await billing('POST', `/subscriptions/${contract.id}/amend`, {
        startDate: '2026-04-01',
        termsNote: 'Scholarship agreed.',
        amountMinor: 9000,
      }),
      201,
    );
    const v2 = await jsonOf<Array<{ id: string; status: string; contractGroupId: string }>>(
      await billing('GET', `/subscriptions?userId=${STUDENT_A}&status=active`),
      200,
    );
    await jsonOf(
      await billing('POST', `/subscriptions/${v2[0].id}/amend`, {
        startDate: '2026-07-01',
        termsNote: 'Back to the standard price.',
        amountMinor: 15000,
      }),
      201,
    );
    await signContract(STUDENT_B, planId, '2026-02-01');

    const all = await jsonOf<unknown[]>(await billing('GET', '/subscriptions'), 200);
    const report = await jsonOf<MovementReport>(
      await billing('GET', '/reports/movement?month=2026-08'),
      200,
    );

    // Four rows, two students: the count groups on contract_group_id.
    expect(all).toHaveLength(4);
    expect(report.activeStudents).toBe(2);
  });

  it('ignores a drifted invoices.status cache and a voided invoice', async () => {
    const planId = await createPlan();
    const contract = await signContract(STUDENT_A, planId, '2026-01-01');
    // Cached "paid" with no payment behind it — the rows still owe 12000.
    await insertInvoice({
      id: 'inv-cached-paid',
      subscriptionId: contract.id,
      userId: STUDENT_A,
      amountMinor: 12000,
      dueDate: '2026-08-10',
      issuedAt: '2026-08-01 09:00:00',
      status: 'paid',
    });
    // Void, with money and an adjustment against it: contributes to nothing.
    const voided = await insertInvoice({
      id: 'inv-voided',
      subscriptionId: contract.id,
      userId: STUDENT_A,
      amountMinor: 90000,
      dueDate: '2026-08-10',
      issuedAt: '2026-08-02 09:00:00',
      status: 'void',
      periodStart: '2026-08-02',
    });
    await insertPayment(voided, 90000, '2026-08-15');
    await insertAdjustment(voided, -1000, '2026-08-16 09:00:00');

    const report = await jsonOf<MovementReport>(
      await billing('GET', '/reports/movement?month=2026-08'),
      200,
    );

    expect(report).toMatchObject({
      invoicedMinor: 12000,
      adjustmentsMinor: 0,
      receivedMinor: 0,
      outstandingMinor: 12000,
      invoicesIssued: 1,
    });
  });

  it('400s a malformed month rather than returning an empty report', async () => {
    for (const month of ['2026-13', 'August', '2026']) {
      expect((await billing('GET', `/reports/movement?month=${month}`)).status).toBe(400);
    }
    expect((await billing('GET', '/reports/movement')).status).toBe(400);
  });

  it('refuses a total that would span two currencies', async () => {
    const planId = await createPlan();
    const contract = await signContract(STUDENT_A, planId, '2026-01-01');
    await insertInvoice({
      id: 'inv-brl',
      subscriptionId: contract.id,
      userId: STUDENT_A,
      amountMinor: 15000,
      dueDate: '2026-08-10',
      issuedAt: '2026-08-01 09:00:00',
    });
    await insertInvoice({
      id: 'inv-jpy',
      subscriptionId: contract.id,
      userId: STUDENT_A,
      amountMinor: 4000,
      currency: 'JPY',
      dueDate: '2026-08-10',
      issuedAt: '2026-08-02 09:00:00',
      periodStart: '2026-08-02',
    });

    const res = await billing('GET', '/reports/movement?month=2026-08');
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('currency');
  });
});

// ---------------------------------------------------------------------------
// Receivables aging
// ---------------------------------------------------------------------------

describe('GET /reports/aging', () => {
  const AS_OF = '2026-09-30';

  it('separates 30 from 31, 60 from 61 and 90 from 91 days past due', async () => {
    const planId = await createPlan();
    const contract = await signContract(STUDENT_A, planId, '2026-01-01');

    for (const days of [30, 31, 60, 61, 90, 91]) {
      await insertInvoice({
        id: `inv-aging-${days}`,
        subscriptionId: contract.id,
        userId: STUDENT_A,
        amountMinor: 1000,
        dueDate: daysBefore(AS_OF, days),
        periodStart: daysBefore(AS_OF, days),
        issuedAt: '2026-06-01 09:00:00',
      });
    }

    const report = await jsonOf<AgingReport>(
      await billing('GET', `/reports/aging?asOf=${AS_OF}`),
      200,
    );
    const totals = Object.fromEntries(report.buckets.map((b) => [b.bucket, b.totalMinor]));

    expect(totals).toEqual({ '0-30': 1000, '31-60': 2000, '61-90': 2000, '90+': 1000 });
    expect(report.totalMinor).toBe(6000);
    expect(report.invoiceCount).toBe(6);
    expect(report.asOf).toBe(AS_OF);
    expect(report.currency).toEqual({ code: 'BRL', exponent: 2, symbol: 'R$' });
  });

  it('drops a voided invoice from every bucket and keeps a drifted cache in', async () => {
    const planId = await createPlan();
    const contract = await signContract(STUDENT_A, planId, '2026-01-01');
    await insertInvoice({
      id: 'inv-aging-void',
      subscriptionId: contract.id,
      userId: STUDENT_A,
      amountMinor: 50000,
      dueDate: daysBefore(AS_OF, 45),
      periodStart: daysBefore(AS_OF, 45),
      issuedAt: '2026-06-01 09:00:00',
      status: 'void',
    });
    await insertInvoice({
      id: 'inv-aging-drift',
      subscriptionId: contract.id,
      userId: STUDENT_A,
      amountMinor: 2000,
      dueDate: daysBefore(AS_OF, 45),
      periodStart: daysBefore(AS_OF, 46),
      issuedAt: '2026-06-02 09:00:00',
      status: 'paid',
    });

    const report = await jsonOf<AgingReport>(
      await billing('GET', `/reports/aging?asOf=${AS_OF}`),
      200,
    );

    expect(report.totalMinor).toBe(2000);
    expect(report.invoiceCount).toBe(1);
    expect(report.buckets.find((b) => b.bucket === '31-60')!.totalMinor).toBe(2000);
  });

  it('defaults asOf to today and 400s a malformed one', async () => {
    const report = await jsonOf<AgingReport>(await billing('GET', '/reports/aging'), 200);
    expect(report.asOf).toBe(new Date().toISOString().slice(0, 10));
    expect((await billing('GET', '/reports/aging?asOf=30-09-2026')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Per-student statement
// ---------------------------------------------------------------------------

describe('GET /students/{userId}/statement', () => {
  it('reconciles the ledger and reports both membership dates for a returning student', async () => {
    const planId = await createPlan();

    // The first membership, cancelled in 2018.
    const first = await signContract(STUDENT_C, planId, '2016-03-01');
    await jsonOf(
      await billing('PATCH', `/subscriptions/${first.id}`, {
        action: 'cancel',
        endDate: '2018-06-30',
      }),
      200,
    );

    // A re-enrolment opens a NEW contract group; the amendment stays inside it.
    const second = await signContract(STUDENT_C, planId, '2024-01-15');
    await jsonOf(
      await billing('POST', `/subscriptions/${second.id}/amend`, {
        startDate: '2025-06-01',
        termsNote: 'Adult class.',
        amountMinor: 18000,
      }),
      201,
    );

    const invoice = await insertInvoice({
      id: 'inv-statement',
      subscriptionId: second.id,
      userId: STUDENT_C,
      amountMinor: 18000,
      dueDate: '2026-08-10',
      issuedAt: '2026-08-01 09:00:00',
    });
    await insertAdjustment(invoice, -3000, '2026-08-05 09:00:00');
    await insertPayment(invoice, 5000, '2026-08-09');

    const statement = await jsonOf<Statement>(
      await billing('GET', `/students/${STUDENT_C}/statement`),
      200,
    );

    expect(statement.studentSince).toBe('2016-03-01');
    expect(statement.currentMembershipSince).toBe('2024-01-15');
    expect(statement.contractGroups).toHaveLength(2);
    expect(statement.contractGroups[0].startDate).toBe('2016-03-01');
    expect(statement.contractGroups[0].status).toBe('cancelled');
    expect(statement.contractGroups[1].versions).toHaveLength(2);
    expect(statement.contractGroups[1].status).toBe('active');

    // 18000 - 3000 - 5000 = 10000, recomputed from the signed rows.
    expect(statement.invoices).toHaveLength(1);
    expect(statement.invoices[0].balanceMinor).toBe(10000);
    expect(statement.invoices[0].adjustments).toHaveLength(1);
    expect(statement.invoices[0].payments).toHaveLength(1);
    expect(statement.outstandingMinor).toBe(10000);
    expect(statement.outstandingMinor).toBe(
      statement.invoices.reduce((sum, i) => sum + Math.max(i.balanceMinor, 0), 0),
    );
    expect(statement.currency).toEqual({ code: 'BRL', exponent: 2, symbol: 'R$' });
  });

  it('404s a student who does not exist', async () => {
    expect((await billing('GET', '/students/nobody-at-all/statement')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The read-only guarantee
// ---------------------------------------------------------------------------

describe('the reports write nothing', () => {
  it('leaves every billing table byte-identical across a full sweep', async () => {
    const planId = await createPlan();
    const contract = await signContract(STUDENT_A, planId, '2026-01-01');
    const invoice = await insertInvoice({
      id: 'inv-readonly',
      subscriptionId: contract.id,
      userId: STUDENT_A,
      amountMinor: 15000,
      dueDate: '2026-08-10',
      issuedAt: '2026-08-01 09:00:00',
      // Drifted on purpose: a report that "repaired" the cache would show here.
      status: 'paid',
    });
    await insertAdjustment(invoice, -2500, '2026-08-05 09:00:00');
    await insertPayment(invoice, 5000, '2026-08-09');

    const snapshot = async (): Promise<string> => {
      const dump: Record<string, unknown> = {};
      for (const table of BILLING_TABLES) {
        const { results } = await env.DB.prepare(
          `SELECT * FROM ${table} ORDER BY rowid`,
        ).all<Record<string, unknown>>();
        dump[table] = results;
      }
      return JSON.stringify(dump);
    };

    const before = await snapshot();

    expect((await billing('GET', '/reports/movement?month=2026-08')).status).toBe(200);
    expect((await billing('GET', '/reports/aging?asOf=2026-09-30')).status).toBe(200);
    expect((await billing('GET', `/students/${STUDENT_A}/statement`)).status).toBe(200);

    expect(await snapshot()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The currency table is the source of truth
// ---------------------------------------------------------------------------

describe('currencies come from the database, not from a constant', () => {
  it('accepts a plan in a currency inserted at runtime by SQL', async () => {
    // Exactly the documented operational workflow: `wrangler d1 execute`, not a
    // deploy (RFC 0013 #13). A hardcoded code list would 400 this.
    await env.DB.prepare(
      `INSERT INTO currencies (code, exponent, symbol, name, active) VALUES (?, ?, ?, ?, 0)`,
    )
      .bind('GBP', 2, '£', 'Pound sterling')
      .run();

    const created = await billing('POST', '/plans', {
      name: 'London seminar',
      amountMinor: 4200,
      currency: 'GBP',
      cycle: 'monthly',
      graceDays: 5,
    });

    const plan = await jsonOf<{ currency: string; amountMinor: number }>(created, 201);
    expect(plan).toMatchObject({ currency: 'GBP', amountMinor: 4200 });
  });

  it('still rejects a code with no row in currencies', async () => {
    const res = await billing('POST', '/plans', {
      name: 'Nowhere',
      amountMinor: 100,
      currency: 'XYZ',
      cycle: 'monthly',
      graceDays: 0,
    });
    expect(res.status).toBe(400);
  });

  it('reports a non-decimal currency with its own exponent, in minor units', async () => {
    await env.DB.prepare(`UPDATE currencies SET active = 0 WHERE code = 'BRL'`).run();
    await env.DB.prepare(`UPDATE currencies SET active = 1 WHERE code = 'JPY'`).run();

    const planId = await createPlan('JPY', 12000);
    const contract = await signContract(STUDENT_A, planId, '2026-01-01');
    await insertInvoice({
      id: 'inv-jpy-report',
      subscriptionId: contract.id,
      userId: STUDENT_A,
      amountMinor: 12000,
      currency: 'JPY',
      dueDate: '2026-08-10',
      issuedAt: '2026-08-01 09:00:00',
    });

    const report = await jsonOf<MovementReport>(
      await billing('GET', '/reports/movement?month=2026-08'),
      200,
    );

    expect(report.currency).toEqual({ code: 'JPY', exponent: 0, symbol: '¥' });
    // 12000 yen is 12000 minor units, not 120.00 — nothing here formats.
    expect(report.invoicedMinor).toBe(12000);
  });

  it('states the tenant active currency for a month with no rows', async () => {
    const report = await jsonOf<MovementReport>(
      await billing('GET', '/reports/movement?month=1999-01'),
      200,
    );
    expect(report.currency.code).toBe('BRL');
    expect(report.billedMinor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The role matrix
// ---------------------------------------------------------------------------

const REPORT_ROUTES = [
  '/reports/movement?month=2026-08',
  '/reports/aging',
  `/students/${STUDENT_A}/statement`,
];

describe('the reports are ADMIN-only', () => {
  const forbidden: Array<[string, () => string]> = [
    ['content_creator', () => creatorToken],
    ['tutor', () => tutorToken],
    ['student', () => studentToken],
  ];

  for (const [role, tokenOf] of forbidden) {
    for (const path of REPORT_ROUTES) {
      it(`403s a ${role} on GET ${path}`, async () => {
        expect((await billing('GET', path, undefined, tokenOf())).status).toBe(403);
      });
    }
  }

  it('401s an anonymous caller on every report', async () => {
    for (const path of REPORT_ROUTES) {
      expect((await billing('GET', path, undefined, '')).status).toBe(401);
    }
  });
});
