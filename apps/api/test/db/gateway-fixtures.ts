import { env } from 'cloudflare:test';

/**
 * The smallest billing world a gateway spec needs: a student and an admin, one
 * open contract invoice and one open event charge, both in BRL. Every id is
 * fresh per call, so a spec can build several worlds in one database.
 */
export interface GatewayWorld {
  studentId: string;
  adminId: string;
  invoiceId: string;
  chargeId: string;
}

export async function seedGatewayWorld(): Promise<GatewayWorld> {
  const studentId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const planId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const invoiceId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const chargeId = crypto.randomUUID();

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
    env.DB
      .prepare(
        `INSERT INTO subscriptions
           (id, user_id, plan_id, contract_group_id, supersedes_id, terms_source,
            amount_minor, currency, cycle, grace_days, due_day, status,
            start_date, terms_note, signed_by)
         VALUES (?, ?, ?, ?, NULL, 'standard', 15000, 'BRL', 'monthly', 5, 10, 'active', '2026-01-01', '', ?)`,
      )
      .bind(subscriptionId, studentId, planId, subscriptionId, adminId),
    env.DB
      .prepare(
        `INSERT INTO invoices
           (id, subscription_id, user_id, period_start, period_end, due_date,
            amount_minor, currency, grace_days, status)
         VALUES (?, ?, ?, '2026-01-01', '2026-02-01', '2026-01-10', 15000, 'BRL', 5, 'open')`,
      )
      .bind(invoiceId, subscriptionId, studentId),
    env.DB
      .prepare(
        `INSERT INTO events (id, slug, title, starts_at, status, created_by)
         VALUES (?, ?, 'Seminar', '2030-01-01 19:00:00', 'published', ?)`,
      )
      .bind(eventId, `seminar-${eventId}`, adminId),
    env.DB
      .prepare(
        `INSERT INTO event_charges
           (id, event_id, user_id, description, amount_minor, currency, due_date, grace_days, status, issued_by)
         VALUES (?, ?, ?, 'Seminar', 8000, 'BRL', '2030-01-10', 5, 'open', ?)`,
      )
      .bind(chargeId, eventId, studentId, adminId),
  ]);

  return { studentId, adminId, invoiceId, chargeId };
}

/** A ledger row on the contract rail, written straight to the table. */
export async function insertInvoicePayment(
  world: GatewayWorld,
  row: { id?: string; method: string; externalReference: string | null; amountMinor?: number; recordedBy?: string },
): Promise<string> {
  const id = row.id ?? crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO payments
         (id, invoice_id, amount_minor, currency, method, paid_at, external_reference, recorded_by)
       VALUES (?, ?, ?, 'BRL', ?, '2026-01-05', ?, ?)`,
    )
    .bind(id, world.invoiceId, row.amountMinor ?? 15000, row.method, row.externalReference, row.recordedBy ?? world.adminId)
    .run();
  return id;
}

/** A ledger row on the extras rail, written straight to the table. */
export async function insertChargePayment(
  world: GatewayWorld,
  row: { id?: string; method: string; externalReference: string | null; amountMinor?: number; recordedBy?: string },
): Promise<string> {
  const id = row.id ?? crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO event_charge_payments
         (id, charge_id, amount_minor, currency, method, paid_at, external_reference, recorded_by)
       VALUES (?, ?, ?, 'BRL', ?, '2030-01-05', ?, ?)`,
    )
    .bind(id, world.chargeId, row.amountMinor ?? 8000, row.method, row.externalReference, row.recordedBy ?? world.adminId)
    .run();
  return id;
}
