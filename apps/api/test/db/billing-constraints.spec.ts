import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyMigrations, parseStatements } from '../helpers/apply-migrations';

/**
 * Migration 0026 carries most of Milestone 19's invariants in the schema rather
 * than in a service, so every test here asserts the database *rejects* the
 * violation. Each one would pass vacuously without the `PRAGMA` below, because
 * foreign keys are off by default in the Miniflare D1 and `ON DELETE RESTRICT`
 * would never fire.
 */

const MIGRATION_0026 = Object.values(
  import.meta.glob<string>('../../migrations/0026_*.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
)[0];

async function countRows(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('billing schema constraints (migration 0026)', () => {
  let studentId: string;
  let adminId: string;
  let planId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    // Foreign keys must be on for ON DELETE RESTRICT to fire in the local SQLite.
    await env.DB.exec('PRAGMA foreign_keys = ON');
  });

  beforeEach(async () => {
    studentId = crypto.randomUUID();
    adminId = crypto.randomUUID();
    planId = crypto.randomUUID();

    await env.DB.batch([
      env.DB
        .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(studentId, 'Student', `s-${studentId}@example.com`, 'hash'),
      env.DB
        .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(adminId, 'Admin', `a-${adminId}@example.com`, 'hash'),
      env.DB
        .prepare(
          `INSERT INTO billing_plans (id, name, amount_minor, currency, cycle, grace_days)
           VALUES (?, 'Monthly', 15000, 'BRL', 'monthly', 5)`,
        )
        .bind(planId),
    ]);
  });

  function insertSubscription(
    id: string,
    overrides: { status?: string; supersedesId?: string | null; userId?: string } = {},
  ): Promise<unknown> {
    return env.DB
      .prepare(
        `INSERT INTO subscriptions
           (id, user_id, plan_id, contract_group_id, supersedes_id, terms_source,
            amount_minor, currency, cycle, grace_days, due_day, status,
            start_date, terms_note, signed_by)
         VALUES (?, ?, ?, ?, ?, 'standard', 15000, 'BRL', 'monthly', 5, 10, ?, '2026-01-01', '', ?)`,
      )
      .bind(
        id,
        overrides.userId ?? studentId,
        planId,
        id,
        overrides.supersedesId ?? null,
        overrides.status ?? 'active',
        adminId,
      )
      .run();
  }

  function insertInvoice(id: string, subscriptionId: string, periodStart: string): Promise<unknown> {
    return env.DB
      .prepare(
        `INSERT INTO invoices
           (id, subscription_id, user_id, period_start, period_end, due_date,
            amount_minor, currency, grace_days, status)
         VALUES (?, ?, ?, ?, '2026-02-01', '2026-01-10', 15000, 'BRL', 5, 'open')`,
      )
      .bind(id, subscriptionId, studentId, periodStart)
      .run();
  }

  // -------------------------------------------------------------------------
  // Currencies
  // -------------------------------------------------------------------------

  it('seeds the reference currencies with their real exponents', async () => {
    const { results } = await env.DB
      .prepare('SELECT code, exponent, active FROM currencies ORDER BY code')
      .all<{ code: string; exponent: number; active: number }>();

    expect(results.map((r) => r.code)).toEqual(['BRL', 'BTC', 'EUR', 'JPY', 'USD']);
    expect(results.find((r) => r.code === 'JPY')?.exponent).toBe(0);
    expect(results.find((r) => r.code === 'BTC')?.exponent).toBe(8);
    expect(results.filter((r) => r.active === 1).map((r) => r.code)).toEqual(['BRL']);
  });

  it('rejects a second active currency', async () => {
    await expect(
      env.DB.prepare("UPDATE currencies SET active = 1 WHERE code = 'USD'").run(),
    ).rejects.toThrow();
  });

  it('rejects a plan denominated in an unknown currency', async () => {
    await expect(
      env.DB
        .prepare(
          `INSERT INTO billing_plans (id, name, amount_minor, currency, cycle, grace_days)
           VALUES (?, 'Bogus', 1000, 'XXX', 'monthly', 5)`,
        )
        .bind(crypto.randomUUID())
        .run(),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  it('rejects a second active subscription for one student', async () => {
    await insertSubscription(crypto.randomUUID());
    await expect(insertSubscription(crypto.randomUUID())).rejects.toThrow();
  });

  it('allows a non-active contract alongside the active one', async () => {
    await insertSubscription(crypto.randomUUID(), { status: 'cancelled' });
    await insertSubscription(crypto.randomUUID(), { status: 'active' });

    const row = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ? AND status = 'active'")
      .bind(studentId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('rejects a forked amendment chain (two successors for one version)', async () => {
    const first = crypto.randomUUID();
    await insertSubscription(first, { status: 'superseded' });
    await insertSubscription(crypto.randomUUID(), { status: 'active', supersedesId: first });

    // Cancelled, so the one-active index cannot be what rejects this row.
    await expect(
      insertSubscription(crypto.randomUUID(), { status: 'cancelled', supersedesId: first }),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------

  it('rejects a duplicate (subscription_id, period_start): the invoice run idempotency key', async () => {
    const subscriptionId = crypto.randomUUID();
    await insertSubscription(subscriptionId);
    await insertInvoice(crypto.randomUUID(), subscriptionId, '2026-01-01');

    await expect(
      insertInvoice(crypto.randomUUID(), subscriptionId, '2026-01-01'),
    ).rejects.toThrow();
  });

  it('rejects a payment referencing an unknown invoice', async () => {
    await expect(
      env.DB
        .prepare(
          `INSERT INTO payments (id, invoice_id, amount_minor, currency, method, paid_at, recorded_by)
           VALUES (?, ?, 1000, 'BRL', 'pix', '2026-01-05', ?)`,
        )
        .bind(crypto.randomUUID(), crypto.randomUUID(), adminId)
        .run(),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Deleting a student with financial history
  // -------------------------------------------------------------------------

  it('refuses to delete a student holding an invoice, but lets the row be anonymised', async () => {
    const subscriptionId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();
    await insertSubscription(subscriptionId);
    await insertInvoice(invoiceId, subscriptionId, '2026-01-01');

    await expect(
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(studentId).run(),
    ).rejects.toThrow();

    // The GDPR path is anonymising the same row, which must leave the ledger
    // whole and still reachable by user_id.
    await env.DB
      .prepare("UPDATE users SET name = 'Deleted user', email = ? WHERE id = ?")
      .bind(`anon-${studentId}@deleted.invalid`, studentId)
      .run();

    const joined = await env.DB
      .prepare(
        `SELECT u.name, u.email, i.id AS invoice_id, s.id AS subscription_id
           FROM invoices i
           JOIN users u ON u.id = i.user_id
           JOIN subscriptions s ON s.id = i.subscription_id
          WHERE i.user_id = ?`,
      )
      .bind(studentId)
      .all<{ name: string; email: string; invoice_id: string; subscription_id: string }>();

    expect(joined.results).toHaveLength(1);
    expect(joined.results[0].name).toBe('Deleted user');
    expect(joined.results[0].email).toBe(`anon-${studentId}@deleted.invalid`);
    expect(joined.results[0].invoice_id).toBe(invoiceId);
    expect(joined.results[0].subscription_id).toBe(subscriptionId);
  });

  it('cascades a standing hold when its user goes, and never a financial row', async () => {
    const holderId = crypto.randomUUID();
    await env.DB
      .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(holderId, 'Holder', `h-${holderId}@example.com`, 'hash')
      .run();
    await env.DB
      .prepare(
        'INSERT INTO billing_standing_holds (user_id, reason, set_by) VALUES (?, ?, ?)',
      )
      .bind(holderId, 'Payment under verification', adminId)
      .run();

    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(holderId).run();

    expect(await countRows('billing_standing_holds')).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Re-application
  // -------------------------------------------------------------------------

  it('applies migration 0026 a second time as a no-op', async () => {
    const subscriptionId = crypto.randomUUID();
    await insertSubscription(subscriptionId);
    await insertInvoice(crypto.randomUUID(), subscriptionId, '2026-01-01');

    const before = {
      currencies: await countRows('currencies'),
      billing_plans: await countRows('billing_plans'),
      subscriptions: await countRows('subscriptions'),
      invoices: await countRows('invoices'),
    };

    const statements = parseStatements(MIGRATION_0026);
    expect(statements.length).toBeGreaterThan(0);
    await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));

    expect({
      currencies: await countRows('currencies'),
      billing_plans: await countRows('billing_plans'),
      subscriptions: await countRows('subscriptions'),
      invoices: await countRows('invoices'),
    }).toEqual(before);
  });
});
