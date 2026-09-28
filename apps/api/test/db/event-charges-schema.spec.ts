import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyMigrations, parseStatements } from '../helpers/apply-migrations';

/**
 * Migration 0028 (RFC 0015 §1) keeps the extras ledger's invariants in the
 * schema, so every test here asserts the database itself rejects a violation.
 * Foreign keys are off by default in the Miniflare D1, hence the `PRAGMA`:
 * without it every `RESTRICT` case would pass vacuously.
 */

const MIGRATION_0028 = Object.values(
  import.meta.glob<string>('../../migrations/0028_*.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
)[0];

const NEW_TABLES = ['event_prices', 'event_charges', 'event_charge_adjustments', 'event_charge_payments'];

describe('event charges schema (migration 0028)', () => {
  let studentId: string;
  let adminId: string;
  let eventId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.DB.exec('PRAGMA foreign_keys = ON');
  });

  beforeEach(async () => {
    studentId = crypto.randomUUID();
    adminId = crypto.randomUUID();
    eventId = crypto.randomUUID();

    await env.DB.batch([
      env.DB
        .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(studentId, 'Student', `s-${studentId}@example.com`, 'hash'),
      env.DB
        .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(adminId, 'Admin', `a-${adminId}@example.com`, 'hash'),
      env.DB
        .prepare(
          `INSERT INTO events (id, slug, title, starts_at, status, created_by)
           VALUES (?, ?, 'Seminar', '2030-01-01 19:00:00', 'published', ?)`,
        )
        .bind(eventId, `seminar-${eventId}`, adminId),
    ]);
  });

  function insertCharge(
    id: string,
    overrides: { status?: string; userId?: string; amountMinor?: number; currency?: string } = {},
  ): Promise<unknown> {
    return env.DB
      .prepare(
        `INSERT INTO event_charges
           (id, event_id, user_id, description, amount_minor, currency, due_date, grace_days, status, issued_by)
         VALUES (?, ?, ?, 'Seminar', ?, ?, '2030-01-10', 5, ?, ?)`,
      )
      .bind(
        id,
        eventId,
        overrides.userId ?? studentId,
        overrides.amountMinor ?? 8000,
        overrides.currency ?? 'BRL',
        overrides.status ?? 'open',
        adminId,
      )
      .run();
  }

  function insertPayment(id: string, chargeId: string, amountMinor: number, reversesId: string | null = null) {
    return env.DB
      .prepare(
        `INSERT INTO event_charge_payments
           (id, charge_id, amount_minor, currency, method, paid_at, reverses_id, recorded_by)
         VALUES (?, ?, ?, 'BRL', 'pix', '2030-01-05', ?, ?)`,
      )
      .bind(id, chargeId, amountMinor, reversesId, adminId)
      .run();
  }

  // -------------------------------------------------------------------------
  // Additive
  // -------------------------------------------------------------------------

  it('only creates the four new tables and their indexes: no statement touches a pre-existing table', () => {
    const statements = parseStatements(MIGRATION_0028);
    expect(statements.length).toBeGreaterThan(0);

    for (const statement of statements) {
      const table =
        /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(statement)?.[1] ??
        /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+\s+ON (\w+)\s*\(/i.exec(statement)?.[1];
      expect(table, statement).toBeDefined();
      expect(NEW_TABLES).toContain(table);
    }
  });

  it('applies a second time without error: the migration is idempotent', async () => {
    const statements = parseStatements(MIGRATION_0028);
    await expect(env.DB.batch(statements.map((sql) => env.DB.prepare(sql)))).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------------
  // One live charge per (event, user)
  // -------------------------------------------------------------------------

  it('rejects a second live charge for the same (event, user)', async () => {
    await insertCharge(crypto.randomUUID());
    await expect(insertCharge(crypto.randomUUID())).rejects.toThrow();
  });

  it('accepts a live charge next to a voided one: a voided charge can be re-issued', async () => {
    await insertCharge(crypto.randomUUID(), { status: 'void' });
    await expect(insertCharge(crypto.randomUUID())).resolves.toBeDefined();
  });

  it('rejects a second reversal of the same payment', async () => {
    const chargeId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    await insertCharge(chargeId);
    await insertPayment(paymentId, chargeId, 8000);
    await insertPayment(crypto.randomUUID(), chargeId, -8000, paymentId);

    await expect(insertPayment(crypto.randomUUID(), chargeId, -8000, paymentId)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Money safety
  // -------------------------------------------------------------------------

  it('validates the currency through the currencies foreign key', async () => {
    await expect(insertCharge(crypto.randomUUID(), { currency: 'XYZ' })).rejects.toThrow();
  });

  it('rejects a negative charge amount, and a zero payment or adjustment', async () => {
    await expect(insertCharge(crypto.randomUUID(), { amountMinor: -1 })).rejects.toThrow();

    const chargeId = crypto.randomUUID();
    await insertCharge(chargeId);
    await expect(insertPayment(crypto.randomUUID(), chargeId, 0)).rejects.toThrow();
    await expect(
      env.DB
        .prepare(
          `INSERT INTO event_charge_adjustments (id, charge_id, kind, amount_minor, reason, applied_by)
           VALUES (?, ?, 'discount', 0, 'nothing', ?)`,
        )
        .bind(crypto.randomUUID(), chargeId, adminId)
        .run(),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // RESTRICT
  // -------------------------------------------------------------------------

  it('refuses to delete a user who has a charge', async () => {
    await insertCharge(crypto.randomUUID());
    await expect(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(studentId).run()).rejects.toThrow();
  });

  it('refuses to delete an event that has a charge', async () => {
    await insertCharge(crypto.randomUUID());
    await expect(env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId).run()).rejects.toThrow();
  });

  it('refuses to delete an event that has a price row', async () => {
    await env.DB
      .prepare(
        `INSERT INTO event_prices (event_id, amount_minor, currency, updated_by) VALUES (?, 8000, 'BRL', ?)`,
      )
      .bind(eventId, adminId)
      .run();
    await expect(env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId).run()).rejects.toThrow();
  });
});
