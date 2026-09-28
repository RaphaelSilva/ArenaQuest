import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi, afterAll } from 'vitest';
import { D1BillingRepository } from '@api/adapters/db/d1-billing-repository';
import { D1EventChargeRepository } from '@api/adapters/db/d1-event-charge-repository';
import { D1EventRepository } from '@api/adapters/db/d1-event-repository';
import { D1UserGroupRepository } from '@api/adapters/db/d1-user-group-repository';
import { BillingService, type BillingRunDeps } from '@api/core/billing/billing-service';
import { EventChargeService } from '@api/core/billing/event-charge-service';
import { Entities } from '@arenaquest/shared/types/entities';
import type { MailMessage } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import { applyMigrations } from '../helpers/apply-migrations';

/**
 * The daily run against the real D1 adapters, wired the way the container
 * wires it (M22 Task 06): "writes no row in any `event_charge*` table" is
 * checked on the tables themselves, not on a spy.
 */

const { PaymentMethod } = Entities.Config;

const TABLES = ['event_prices', 'event_charges', 'event_charge_adjustments', 'event_charge_payments'];

function expectOk<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status}: ${JSON.stringify(result.meta)}`);
  return result.data;
}

describe('BillingService.runBillingCycle - extras ledger on D1', () => {
  let billing: BillingService;
  let charges: EventChargeService;
  let adminId: string;
  let buyerId: string;
  let payerId: string;
  const sent: MailMessage[] = [];
  let deps: BillingRunDeps;

  async function insertUser(): Promise<string> {
    const id = crypto.randomUUID();
    await env.DB
      .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, 'User', `u-${id}@example.com`, 'hash')
      .run();
    return id;
  }

  async function counts(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const table of TABLES) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      result[table] = row?.n ?? 0;
    }
    return result;
  }

  beforeAll(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await applyMigrations(env.DB);
    await env.DB.exec('PRAGMA foreign_keys = ON');

    const chargeRepo = new D1EventChargeRepository(env.DB);
    const billingRepo = new D1BillingRepository(env.DB);
    billing = new BillingService(billingRepo, async () => true, chargeRepo);
    charges = new EventChargeService(
      chargeRepo,
      new D1EventRepository(env.DB),
      new D1UserGroupRepository(env.DB),
      billingRepo,
    );

    adminId = await insertUser();
    buyerId = await insertUser();
    payerId = await insertUser();

    const eventId = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO events (id, slug, title, starts_at, status, audience, created_by)
         VALUES (?, ?, 'Seminário de Março', '2030-01-01 19:00:00', 'published', 'members', ?)`,
      )
      .bind(eventId, `seminar-${eventId}`, adminId)
      .run();

    expectOk(await charges.setPrice(eventId, { amountMinor: 15000, dueInDays: 7, graceDays: 3 }, adminId));
    const issued = expectOk(
      await charges.issueCharges(
        { eventId, userIds: [buyerId, payerId], dueDate: '2030-03-10' },
        adminId,
      ),
    );
    // One charge carries ledger rows too, so every table has something to keep.
    const paid = issued.created.find((charge) => charge.userId === payerId)!;
    expectOk(await charges.recordPayment(paid.id, { amountMinor: 5000, method: PaymentMethod.PIX }, adminId));

    deps = {
      mailer: { async send(message) { sent.push(message); } },
      directory: {
        async findRecipient(userId) {
          return { userId, name: 'Student', email: `${userId}@dojo.test` };
        },
        async listAdmins() {
          return [{ userId: adminId, name: 'Sensei', email: 'sensei@dojo.test' }];
        },
      },
    };
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('leaves every event_charge* table row count unchanged across the due and grace-lapse runs', async () => {
    const before = await counts();
    expect(before.event_prices).toBeGreaterThan(0);
    expect(before.event_charges).toBeGreaterThanOrEqual(2);
    expect(before.event_charge_payments).toBeGreaterThan(0);

    const onDue = expectOk(await billing.runBillingCycle(deps, { asOf: '2030-03-10' }, adminId));
    const lapsed = expectOk(await billing.runBillingCycle(deps, { asOf: '2030-03-14' }, adminId));
    // And a same-day re-run.
    expectOk(await billing.runBillingCycle(deps, { asOf: '2030-03-14', since: '2030-03-14' }, adminId));

    expect(await counts()).toEqual(before);

    // The run did read the ledger: both buyers were reminded on both days.
    expect(onDue.extrasReminders.map((line) => line.kind)).toEqual(['extras_due_date', 'extras_due_date']);
    expect(lapsed.extrasReminders.map((line) => line.kind)).toEqual([
      'extras_grace_lapsed',
      'extras_grace_lapsed',
    ]);
    expect(sent.some((message) => message.text.includes('Seminário de Março'))).toBe(true);
  });
});
