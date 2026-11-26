import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1BillingRepository } from '@api/adapters/db/d1-billing-repository';
import { D1EventChargeRepository } from '@api/adapters/db/d1-event-charge-repository';
import { SYSTEM_PAYMENT_ACTOR_ID } from '@api/adapters/db/d1-gateway-repository';
import { applyMigrations, parseStatements } from '../helpers/apply-migrations';
import {
  insertChargePayment,
  insertInvoicePayment,
  seedGatewayWorld,
  type GatewayWorld,
} from './gateway-fixtures';

/**
 * Migration 0033 (RFC 0026 section 2) keeps the gateway's invariants in the
 * schema, so most tests here assert that the database *rejects* a violation.
 * Foreign keys are switched on explicitly: they are off by default in the
 * Miniflare D1 and `ON DELETE RESTRICT` would otherwise never fire.
 */

function rawMigration(pattern: Record<string, string>): string {
  return Object.values(pattern)[0];
}

const MIGRATION_0032 = rawMigration(
  import.meta.glob<string>('../../migrations/0032_*.sql', { eager: true, query: '?raw', import: 'default' }),
);
const MIGRATION_0033 = rawMigration(
  import.meta.glob<string>('../../migrations/0033_*.sql', { eager: true, query: '?raw', import: 'default' }),
);

async function replay0033(): Promise<void> {
  await env.DB.batch(parseStatements(MIGRATION_0033).map((sql) => env.DB.prepare(sql)));
}

async function countRows(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('payment gateway schema (migration 0033)', () => {
  let world: GatewayWorld;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.DB.exec('PRAGMA foreign_keys = ON');
  });

  beforeEach(async () => {
    world = await seedGatewayWorld();
  });

  function insertCheckout(overrides: Record<string, unknown> = {}): Promise<unknown> {
    const row: Record<string, unknown> = {
      id: crypto.randomUUID(),
      provider: 'mercadopago',
      receivable_kind: 'invoice',
      receivable_id: world.invoiceId,
      user_id: world.studentId,
      created_by: world.studentId,
      amount_minor: 15000,
      currency: 'BRL',
      status: 'open',
      checkout_url: 'https://pay.example.invalid/x',
      expires_at: '2030-01-01T00:00:00.000Z',
      ...overrides,
    };
    const columns = Object.keys(row);
    return env.DB
      .prepare(
        `INSERT INTO gateway_checkouts (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      )
      .bind(...columns.map((c) => row[c]))
      .run();
  }

  // -------------------------------------------------------------------------
  // Additive
  // -------------------------------------------------------------------------

  it('alters or rebuilds no money table: the only table dropped and renamed is job_runs', () => {
    const statements = parseStatements(MIGRATION_0033);
    const destructive = statements.filter((s) => /^\s*(ALTER|DROP)\b/i.test(s));
    expect(destructive.map((s) => s.replace(/\s+/g, ' '))).toEqual([
      'DROP TABLE IF EXISTS job_runs_new',
      'DROP TABLE job_runs',
      'ALTER TABLE job_runs_new RENAME TO job_runs',
    ]);
    expect(statements.some((s) => /\b(UPDATE|DELETE)\b/i.test(s.replace(/ON DELETE RESTRICT/gi, '')))).toBe(false);
  });

  it('replays cleanly on a database that already holds billing data', async () => {
    await insertInvoicePayment(world, { method: 'gateway', externalReference: 'mercadopago:replay-1' });
    await insertChargePayment(world, { method: 'pix', externalReference: 'R-1' });
    await insertCheckout();
    const before = {
      users: await countRows('users'),
      payments: await countRows('payments'),
      chargePayments: await countRows('event_charge_payments'),
      checkouts: await countRows('gateway_checkouts'),
    };

    await replay0033();
    await replay0033();

    expect({
      users: await countRows('users'),
      payments: await countRows('payments'),
      chargePayments: await countRows('event_charge_payments'),
      checkouts: await countRows('gateway_checkouts'),
    }).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // The system actor
  // -------------------------------------------------------------------------

  it('inserts the system actor once: status system, empty hash, .invalid address, no role', async () => {
    const { results } = await env.DB
      .prepare("SELECT id, name, email, password_hash, status FROM users WHERE status = 'system'")
      .all();
    expect(results).toEqual([
      {
        id: SYSTEM_PAYMENT_ACTOR_ID,
        name: 'Payment gateway',
        email: 'payment-gateway@system.invalid',
        password_hash: '',
        status: 'system',
      },
    ]);

    const roles = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM user_roles WHERE user_id = ?')
      .bind(SYSTEM_PAYMENT_ACTOR_ID)
      .first<{ n: number }>();
    expect(roles?.n).toBe(0);
  });

  it('lets the system actor be the recorded_by of a payment on both rails', async () => {
    await insertInvoicePayment(world, {
      method: 'gateway',
      externalReference: 'mercadopago:actor-1',
      recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
    });
    await insertChargePayment(world, {
      method: 'gateway',
      externalReference: 'mercadopago:actor-1',
      recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
    });
    await expect(
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(SYSTEM_PAYMENT_ACTOR_ID).run(),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // job_runs rebuild
  // -------------------------------------------------------------------------

  it('copies every job_runs row verbatim through the rebuild', async () => {
    // Back to the 0032 shape, with rows in it, then the rebuild on top.
    await env.DB.exec('DROP TABLE job_runs');
    await env.DB.batch(parseStatements(MIGRATION_0032).map((sql) => env.DB.prepare(sql)));
    await expect(
      env.DB
        .prepare(
          `INSERT INTO job_runs (id, job, trigger, status, started_at)
           VALUES ('old-shape', 'reconcile_payments', 'cron', 'running', '2026-11-01T06:00:00.000Z')`,
        )
        .run(),
    ).rejects.toThrow();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO job_runs (id, job, trigger, status, actor_id, started_at, finished_at, duration_ms, summary, error)
         VALUES ('run-1', 'billing', 'cron', 'ok', NULL, '2026-11-01T06:00:00.000Z', '2026-11-01T06:00:02.000Z', 2000, '{"issued":3}', NULL)`,
      ),
      env.DB.prepare(
        `INSERT INTO job_runs (id, job, trigger, status, actor_id, started_at, finished_at, duration_ms, summary, error)
         VALUES ('run-2', 'sweep_submissions', 'manual', 'failed', 'admin-1', '2026-11-02T06:00:00.000Z', '2026-11-02T06:00:01.000Z', 1000, NULL, 'boom')`,
      ),
      env.DB.prepare(
        `INSERT INTO job_runs (id, job, trigger, status, started_at)
         VALUES ('run-3', 'billing', 'cron', 'running', '2026-11-03T06:00:00.000Z')`,
      ),
    ]);
    const before = await env.DB.prepare('SELECT * FROM job_runs ORDER BY id').all();
    expect(before.results).toHaveLength(3);

    await replay0033();

    const after = await env.DB.prepare('SELECT * FROM job_runs ORDER BY id').all();
    expect(after.results).toEqual(before.results);

    const index = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'job_runs' AND name = 'idx_job_runs_job_started'")
      .first();
    expect(index).not.toBeNull();
    const leftover = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE name = 'job_runs_new'")
      .first();
    expect(leftover).toBeNull();
  });

  it('admits reconcile_payments as a job and still refuses an unknown one', async () => {
    await env.DB
      .prepare(
        `INSERT INTO job_runs (id, job, trigger, status, started_at)
         VALUES (?, 'reconcile_payments', 'cron', 'running', '2026-11-01T06:17:00.000Z')`,
      )
      .bind(crypto.randomUUID())
      .run();
    await expect(
      env.DB
        .prepare(
          `INSERT INTO job_runs (id, job, trigger, status, started_at)
           VALUES (?, 'something_else', 'cron', 'running', '2026-11-01T06:17:00.000Z')`,
        )
        .bind(crypto.randomUUID())
        .run(),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Money-level idempotency: the gateway reference, per rail
  // -------------------------------------------------------------------------

  it('refuses a second gateway row with the same reference on payments', async () => {
    await insertInvoicePayment(world, { method: 'gateway', externalReference: 'mercadopago:111' });
    await expect(
      insertInvoicePayment(world, { method: 'gateway', externalReference: 'mercadopago:111' }),
    ).rejects.toThrow(/UNIQUE/);
    // Another provider's same bare id is another reference.
    await insertInvoicePayment(world, { method: 'gateway', externalReference: 'stripe:111' });
  });

  it('refuses a second gateway row with the same reference on event_charge_payments', async () => {
    await insertChargePayment(world, { method: 'gateway', externalReference: 'mercadopago:222' });
    await expect(
      insertChargePayment(world, { method: 'gateway', externalReference: 'mercadopago:222' }),
    ).rejects.toThrow(/UNIQUE/);
    await insertChargePayment(world, { method: 'gateway', externalReference: 'stripe:222' });
  });

  it('keeps the rails apart: one reference may sit on each', async () => {
    await insertInvoicePayment(world, { method: 'gateway', externalReference: 'mercadopago:333' });
    await insertChargePayment(world, { method: 'gateway', externalReference: 'mercadopago:333' });
  });

  it('still lets admin-typed references repeat, and NULL never collides, on both rails', async () => {
    await insertInvoicePayment(world, { method: 'gateway', externalReference: 'mercadopago:444' });
    await insertInvoicePayment(world, { method: 'pix', externalReference: 'mercadopago:444' });
    await insertInvoicePayment(world, { method: 'cash', externalReference: 'R-77' });
    await insertInvoicePayment(world, { method: 'cash', externalReference: 'R-77' });
    await insertInvoicePayment(world, { method: 'gateway', externalReference: null });
    await insertInvoicePayment(world, { method: 'gateway', externalReference: null });

    await insertChargePayment(world, { method: 'gateway', externalReference: 'mercadopago:444' });
    await insertChargePayment(world, { method: 'pix', externalReference: 'mercadopago:444' });
    await insertChargePayment(world, { method: 'cash', externalReference: 'R-77' });
    await insertChargePayment(world, { method: 'cash', externalReference: 'R-77' });
    await insertChargePayment(world, { method: 'gateway', externalReference: null });
    await insertChargePayment(world, { method: 'gateway', externalReference: null });
  });

  it('findGatewayPayment returns the gateway row for a reference, on each rail, and nothing else', async () => {
    const billing = new D1BillingRepository(env.DB);
    const charges = new D1EventChargeRepository(env.DB);

    await insertInvoicePayment(world, { method: 'pix', externalReference: 'mercadopago:555' });
    expect(await billing.findGatewayPayment('mercadopago:555')).toBeNull();
    const invoicePaymentId = await insertInvoicePayment(world, {
      method: 'gateway',
      externalReference: 'mercadopago:555',
      recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
    });
    expect(await billing.findGatewayPayment('mercadopago:555')).toMatchObject({
      id: invoicePaymentId,
      invoiceId: world.invoiceId,
      method: 'gateway',
      externalReference: 'mercadopago:555',
      recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
    });
    // The other rail does not see it.
    expect(await charges.findGatewayPayment('mercadopago:555')).toBeNull();

    const chargePaymentId = await insertChargePayment(world, {
      method: 'gateway',
      externalReference: 'stripe:pi_9',
    });
    expect(await charges.findGatewayPayment('stripe:pi_9')).toMatchObject({
      id: chargePaymentId,
      chargeId: world.chargeId,
      method: 'gateway',
      externalReference: 'stripe:pi_9',
    });
    expect(await billing.findGatewayPayment('stripe:pi_9')).toBeNull();
    expect(await billing.findGatewayPayment('mercadopago:unknown')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // gateway_checkouts
  // -------------------------------------------------------------------------

  it('refuses a second open checkout for one receivable, whatever the provider', async () => {
    await insertCheckout();
    await expect(insertCheckout({ provider: 'stripe' })).rejects.toThrow(/UNIQUE/);
  });

  it('allows a new open checkout once the previous one is closed, and one per rail', async () => {
    await insertCheckout({ status: 'expired' });
    await insertCheckout({ status: 'cancelled' });
    await insertCheckout();
    await insertCheckout({ receivable_kind: 'event_charge', receivable_id: world.chargeId, amount_minor: 8000 });
  });

  it('refuses a cross-rail payment id, and both payment ids at once', async () => {
    const invoicePaymentId = await insertInvoicePayment(world, { method: 'gateway', externalReference: 'mercadopago:c1' });
    const chargePaymentId = await insertChargePayment(world, { method: 'gateway', externalReference: 'mercadopago:c1' });

    // An invoice checkout pointing at the extras ledger.
    await expect(
      insertCheckout({ status: 'paid', charge_payment_id: chargePaymentId }),
    ).rejects.toThrow(/CHECK/);
    // An event-charge checkout pointing at the contract ledger.
    await expect(
      insertCheckout({
        status: 'paid',
        receivable_kind: 'event_charge',
        receivable_id: world.chargeId,
        invoice_payment_id: invoicePaymentId,
      }),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertCheckout({ status: 'paid', invoice_payment_id: invoicePaymentId, charge_payment_id: chargePaymentId }),
    ).rejects.toThrow(/CHECK/);

    // The matching pairs pass.
    await insertCheckout({ status: 'paid', invoice_payment_id: invoicePaymentId });
    await insertCheckout({
      status: 'paid',
      receivable_kind: 'event_charge',
      receivable_id: world.chargeId,
      charge_payment_id: chargePaymentId,
    });
  });

  it('refuses a payment id that is not on the ledger, and protects a referenced ledger row', async () => {
    await expect(
      insertCheckout({ status: 'paid', invoice_payment_id: 'no-such-payment' }),
    ).rejects.toThrow();

    const invoicePaymentId = await insertInvoicePayment(world, { method: 'gateway', externalReference: 'mercadopago:fk1' });
    await insertCheckout({ status: 'paid', invoice_payment_id: invoicePaymentId });
    await expect(
      env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(invoicePaymentId).run(),
    ).rejects.toThrow();
  });

  it('refuses an unknown provider, kind, status or currency and a non-positive amount', async () => {
    await expect(insertCheckout({ provider: 'paypal' })).rejects.toThrow(/CHECK/);
    await expect(insertCheckout({ receivable_kind: 'donation' })).rejects.toThrow(/CHECK/);
    await expect(insertCheckout({ status: 'pending' })).rejects.toThrow(/CHECK/);
    await expect(insertCheckout({ amount_minor: 0 })).rejects.toThrow(/CHECK/);
    await expect(insertCheckout({ amount_minor: -1 })).rejects.toThrow(/CHECK/);
    await expect(insertCheckout({ currency: 'XXX' })).rejects.toThrow();
    await expect(insertCheckout({ user_id: 'no-such-user' })).rejects.toThrow();
    await expect(insertCheckout({ created_by: 'no-such-user' })).rejects.toThrow();
  });

  it('keeps provider session and payment ids unique per provider, not globally', async () => {
    await insertCheckout({ status: 'paid', provider_session_id: 's-1', provider_payment_id: 'p-1' });
    await expect(
      insertCheckout({ status: 'expired', provider_session_id: 's-1' }),
    ).rejects.toThrow(/UNIQUE/);
    await expect(
      insertCheckout({ status: 'expired', provider_payment_id: 'p-1' }),
    ).rejects.toThrow(/UNIQUE/);
    await insertCheckout({ status: 'expired', provider: 'stripe', provider_session_id: 's-1', provider_payment_id: 'p-1' });
  });

  it('protects a student who has a checkout from deletion', async () => {
    const other = await seedGatewayWorld();
    await env.DB
      .prepare(
        `INSERT INTO gateway_checkouts
           (id, provider, receivable_kind, receivable_id, user_id, created_by, amount_minor, currency, status, checkout_url, expires_at)
         VALUES (?, 'mercadopago', 'event_charge', ?, ?, ?, 8000, 'BRL', 'open', 'https://pay.example.invalid/y', '2030-01-01T00:00:00.000Z')`,
      )
      .bind(crypto.randomUUID(), other.chargeId, other.studentId, other.adminId)
      .run();
    await expect(
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(other.adminId).run(),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // gateway_events
  // -------------------------------------------------------------------------

  it('keys an event on (provider, event_id) and caps its error at 1024 characters', async () => {
    const insertEvent = (provider: string, eventId: string, extra: { outcome?: string; error?: string | null } = {}) =>
      env.DB
        .prepare(
          `INSERT INTO gateway_events (provider, event_id, type, outcome, error) VALUES (?, ?, 'payment', ?, ?)`,
        )
        .bind(provider, eventId, extra.outcome ?? 'received', extra.error ?? null)
        .run();

    const eventId = crypto.randomUUID();
    await insertEvent('mercadopago', eventId);
    await expect(insertEvent('mercadopago', eventId)).rejects.toThrow(/UNIQUE/);
    await insertEvent('stripe', eventId);

    await expect(insertEvent('mercadopago', crypto.randomUUID(), { outcome: 'done' })).rejects.toThrow(/CHECK/);
    await insertEvent('mercadopago', crypto.randomUUID(), { outcome: 'failed', error: 'x'.repeat(1024) });
    await expect(
      insertEvent('mercadopago', crypto.randomUUID(), { outcome: 'failed', error: 'x'.repeat(1025) }),
    ).rejects.toThrow(/CHECK/);

    const row = await env.DB
      .prepare('SELECT attempts, received_at, dismissed_at FROM gateway_events WHERE provider = ? AND event_id = ?')
      .bind('mercadopago', eventId)
      .first<{ attempts: number; received_at: string; dismissed_at: string | null }>();
    expect(row?.attempts).toBe(1);
    expect(row?.received_at).toBeTruthy();
    expect(row?.dismissed_at).toBeNull();
  });

  it('carries the dismissal columns on both tables, the dismisser being a real user', async () => {
    const id = crypto.randomUUID();
    await insertCheckout({ id, status: 'mismatch' });
    await expect(
      env.DB.prepare("UPDATE gateway_checkouts SET dismissed_by = 'no-such-user' WHERE id = ?").bind(id).run(),
    ).rejects.toThrow();
    await env.DB
      .prepare("UPDATE gateway_checkouts SET dismissed_at = datetime('now'), dismissed_by = ?, dismiss_note = 'seen' WHERE id = ?")
      .bind(world.adminId, id)
      .run();
    const row = await env.DB
      .prepare('SELECT status, dismiss_note FROM gateway_checkouts WHERE id = ?')
      .bind(id)
      .first<{ status: string; dismiss_note: string }>();
    expect(row).toEqual({ status: 'mismatch', dismiss_note: 'seen' });
  });
});
