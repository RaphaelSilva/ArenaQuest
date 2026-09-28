import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { D1EventChargeRepository } from '@api/adapters/db/d1-event-charge-repository';
import { D1EventRepository } from '@api/adapters/db/d1-event-repository';
import { D1UserGroupRepository } from '@api/adapters/db/d1-user-group-repository';
import { D1BillingRepository } from '@api/adapters/db/d1-billing-repository';
import { EventChargeService } from '@api/core/billing/event-charge-service';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';
import { applyMigrations } from '../helpers/apply-migrations';

/**
 * EventChargeService against the real D1 adapters (workers pool).
 *
 * Every write rule of the extras rail, each branch asserted by status. The
 * repository is real so "writes nothing" is checked on the table, not on a
 * spy.
 */

const { ChargeStatus, ContractTermsSource, PaymentMethod, AdjustmentKind } = Entities.Config;

function expectOk<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status}: ${JSON.stringify(result.meta)}`);
  return result.data;
}

function expectStatus<T>(result: ControllerResult<T>, status: number): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.status).toBe(status);
}

describe('EventChargeService', () => {
  let service: EventChargeService;
  let repo: D1EventChargeRepository;
  let adminId: string;
  let userA: string;
  let userB: string;
  let eventId: string;

  async function insertUser(): Promise<string> {
    const id = crypto.randomUUID();
    await env.DB
      .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, 'User', `u-${id}@example.com`, 'hash')
      .run();
    return id;
  }

  async function insertEvent(status = 'published', audience = 'members'): Promise<string> {
    const id = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO events (id, slug, title, starts_at, status, audience, created_by)
         VALUES (?, ?, 'Seminar', '2030-01-01 19:00:00', ?, ?, ?)`,
      )
      .bind(id, `seminar-${id}`, status, audience, adminId)
      .run();
    return id;
  }

  async function count(sql: string, ...binds: unknown[]): Promise<number> {
    const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
    return row?.n ?? 0;
  }

  async function priced(amountMinor = 8000, forEvent = eventId) {
    expectOk(await service.setPrice(forEvent, { amountMinor, dueInDays: 7, graceDays: 3 }, adminId));
  }

  async function issueOne(forEvent = eventId, userId = userA) {
    const data = expectOk(await service.issueCharges({ eventId: forEvent, userIds: [userId] }, adminId));
    return data.created[0];
  }

  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.DB.exec('PRAGMA foreign_keys = ON');
    repo = new D1EventChargeRepository(env.DB);
    service = new EventChargeService(
      repo,
      new D1EventRepository(env.DB),
      new D1UserGroupRepository(env.DB),
      new D1BillingRepository(env.DB),
    );
  });

  beforeEach(async () => {
    adminId = await insertUser();
    userA = await insertUser();
    userB = await insertUser();
    eventId = await insertEvent();
  });

  // -------------------------------------------------------------------------
  // Price
  // -------------------------------------------------------------------------

  describe('price', () => {
    it('sets, reads and clears a price in the active currency', async () => {
      const price = expectOk(await service.setPrice(eventId, { amountMinor: 8000 }, adminId));
      expect(price).toMatchObject({ amountMinor: 8000, currency: 'BRL', dueInDays: 0, graceDays: 5 });
      expect(expectOk(await service.getPrice(eventId)).amountMinor).toBe(8000);

      expectOk(await service.clearPrice(eventId, adminId));
      expectStatus(await service.getPrice(eventId), 404);
    });

    it('refuses a price in a non-active currency with 400', async () => {
      expectStatus(await service.setPrice(eventId, { amountMinor: 8000, currency: 'USD' }, adminId), 400);
      expectStatus(await service.getPrice(eventId), 404);
    });

    it('404s an unknown event, and clearing a missing price', async () => {
      expectStatus(await service.setPrice('nope', { amountMinor: 1 }, adminId), 404);
      expectStatus(await service.getPrice('nope'), 404);
      expectStatus(await service.clearPrice(eventId, adminId), 404);
    });

    it('clearing the price leaves issued charges untouched', async () => {
      await priced();
      const charge = await issueOne();
      expectOk(await service.clearPrice(eventId, adminId));
      expect((await repo.getCharge(charge.id))?.amountMinor).toBe(8000);
    });
  });

  // -------------------------------------------------------------------------
  // Issue
  // -------------------------------------------------------------------------

  describe('issueCharges', () => {
    it('is idempotent: the same command creates, then absorbs every pair', async () => {
      await priced();
      const command = { eventId, userIds: [userA, userB] };

      const first = expectOk(await service.issueCharges(command, adminId));
      expect(first.created.map((c) => c.userId).sort()).toEqual([userA, userB].sort());
      expect(first.absorbed).toEqual([]);

      const second = expectOk(await service.issueCharges(command, adminId));
      expect(second.created).toEqual([]);
      expect(second.absorbed).toEqual(
        expect.arrayContaining([{ eventId, userId: userA }, { eventId, userId: userB }]),
      );
      expect(await count('SELECT COUNT(*) AS n FROM event_charges WHERE event_id = ?', eventId)).toBe(2);
    });

    it('snapshots the price as standard with its due-in days and grace', async () => {
      await priced();
      const charge = await issueOne();
      const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      expect(charge).toMatchObject({
        amountMinor: 8000,
        currency: 'BRL',
        termsSource: ContractTermsSource.STANDARD,
        dueDate: due,
        graceDays: 3,
        description: 'Seminar',
        status: ChargeStatus.OPEN,
      });
    });

    it.each(['draft', 'archived'])('refuses a %s event with 409 and writes nothing', async (status) => {
      const other = await insertEvent(status);
      await priced(8000, other);
      expectStatus(await service.issueCharges({ eventId: other, userIds: [userA] }, adminId), 409);
      expect(await count('SELECT COUNT(*) AS n FROM event_charges WHERE event_id = ?', other)).toBe(0);
    });

    it('requires a termsNote for an amount differing from the price, and stores it negotiated', async () => {
      await priced();
      expectStatus(
        await service.issueCharges({ eventId, userIds: [userA], amountMinor: 5000 }, adminId),
        400,
      );
      const data = expectOk(
        await service.issueCharges(
          { eventId, userIds: [userA], amountMinor: 5000, termsNote: 'Scholarship' },
          adminId,
        ),
      );
      expect(data.created[0]).toMatchObject({
        amountMinor: 5000,
        termsSource: ContractTermsSource.NEGOTIATED,
        termsNote: 'Scholarship',
      });
    });

    it('treats an explicit amount equal to the price as standard', async () => {
      await priced();
      const data = expectOk(
        await service.issueCharges({ eventId, userIds: [userA], amountMinor: 8000 }, adminId),
      );
      expect(data.created[0].termsSource).toBe(ContractTermsSource.STANDARD);
    });

    it('without a price: no amount is 400, any amount is negotiated and needs a note', async () => {
      expectStatus(await service.issueCharges({ eventId, userIds: [userA] }, adminId), 400);
      expectStatus(
        await service.issueCharges({ eventId, userIds: [userA], amountMinor: 3000 }, adminId),
        400,
      );
      const data = expectOk(
        await service.issueCharges(
          { eventId, userIds: [userA], amountMinor: 3000, termsNote: 'Walk-in', dueDate: '2030-02-01' },
          adminId,
        ),
      );
      expect(data.created[0]).toMatchObject({
        termsSource: ContractTermsSource.NEGOTIATED,
        dueDate: '2030-02-01',
        graceDays: 5,
      });
    });

    it('refuses a non-active currency: 400 on the command, 409 on a stale price', async () => {
      await priced();
      expectStatus(
        await service.issueCharges({ eventId, userIds: [userA], currency: 'USD' }, adminId),
        400,
      );
      await env.DB.prepare("UPDATE event_prices SET currency = 'USD' WHERE event_id = ?").bind(eventId).run();
      expectStatus(await service.issueCharges({ eventId, userIds: [userA] }, adminId), 409);
      expect(await count('SELECT COUNT(*) AS n FROM event_charges WHERE event_id = ?', eventId)).toBe(0);
    });

    it('404s an unknown event and an unknown user, writing nothing', async () => {
      expectStatus(await service.issueCharges({ eventId: 'nope', userIds: [userA] }, adminId), 404);
      await priced();
      expectStatus(
        await service.issueCharges({ eventId, userIds: [userA, 'no-such-user'] }, adminId),
        404,
      );
      expect(await count('SELECT COUNT(*) AS n FROM event_charges WHERE event_id = ?', eventId)).toBe(0);
    });

    it('400s duplicate, empty and oversized userIds', async () => {
      await priced();
      expectStatus(await service.issueCharges({ eventId, userIds: [userA, userA] }, adminId), 400);
      expectStatus(await service.issueCharges({ eventId, userIds: [] }, adminId), 400);
      const many = Array.from({ length: 201 }, (_, i) => `u-${i}`);
      expectStatus(await service.issueCharges({ eventId, userIds: many }, adminId), 400);
    });

    it('re-issues after a void', async () => {
      await priced();
      const first = await issueOne();
      expectOk(await service.voidCharge(first.id, 'Mistake', adminId));
      const second = await issueOne();
      expect(second.id).not.toBe(first.id);
    });
  });

  // -------------------------------------------------------------------------
  // Audience — warn, never write
  // -------------------------------------------------------------------------

  describe('outsideAudience', () => {
    it('lists users outside a restricted audience, still charges them, and writes no audience row', async () => {
      const restricted = await insertEvent('published', 'restricted');
      await priced(8000, restricted);
      const direct = await insertUser();
      const viaGroup = await insertUser();
      const groupId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO user_groups (id, name) VALUES (?, ?)').bind(groupId, `g-${groupId}`),
        env.DB.prepare('INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)').bind(groupId, viaGroup),
        env.DB.prepare('INSERT INTO event_audience_user (event_id, user_id) VALUES (?, ?)').bind(restricted, direct),
        env.DB.prepare('INSERT INTO event_audience_group (event_id, group_id) VALUES (?, ?)').bind(restricted, groupId),
      ]);
      const audienceRows = () =>
        Promise.all([
          count('SELECT COUNT(*) AS n FROM event_audience_user'),
          count('SELECT COUNT(*) AS n FROM event_audience_group'),
        ]);
      const before = await audienceRows();

      const check = expectOk(await service.checkAudience(restricted, [direct, viaGroup, userA]));
      expect(check).toEqual({ eventId: restricted, audience: 'restricted', outsideAudience: [userA] });

      const data = expectOk(
        await service.issueCharges({ eventId: restricted, userIds: [direct, viaGroup, userA] }, adminId),
      );
      expect(data.created).toHaveLength(3);
      expect(data.outsideAudience).toEqual([userA]);
      expect(await audienceRows()).toEqual(before);
    });

    it.each(['public', 'members'])('is always empty for a %s event', async (audience) => {
      const open = await insertEvent('published', audience);
      await priced(8000, open);
      const data = expectOk(await service.issueCharges({ eventId: open, userIds: [userA] }, adminId));
      expect(data.outsideAudience).toEqual([]);
      expect(expectOk(await service.checkAudience(open, [userA])).outsideAudience).toEqual([]);
    });

    it('404s the audience check of an unknown event', async () => {
      expectStatus(await service.checkAudience('nope', [userA]), 404);
    });
  });

  // -------------------------------------------------------------------------
  // Ledger
  // -------------------------------------------------------------------------

  describe('payments and reversals', () => {
    it('pay, reverse, reverse the reversal, reverse twice', async () => {
      await priced();
      const charge = await issueOne();

      const payment = expectOk(
        await service.recordPayment(charge.id, { amountMinor: 8000, method: PaymentMethod.PIX }, adminId),
      );
      expect((await repo.getCharge(charge.id))?.status).toBe(ChargeStatus.PAID);

      const reversal = expectOk(await service.reversePayment(payment.id, { reason: 'Bounced' }, adminId));
      expect(reversal).toMatchObject({ amountMinor: -8000, reversesId: payment.id, note: 'Bounced' });
      expect((await repo.getCharge(charge.id))?.status).toBe(ChargeStatus.OPEN);

      expectStatus(await service.reversePayment(reversal.id, { reason: 'Again' }, adminId), 409);
      expectStatus(await service.reversePayment(payment.id, { reason: 'Again' }, adminId), 409);
    });

    it('validates payments: non-positive 400, foreign currency 400, unknown 404, void 409', async () => {
      await priced();
      const charge = await issueOne();
      expectStatus(await service.recordPayment(charge.id, { amountMinor: 0, method: PaymentMethod.CASH }, adminId), 400);
      expectStatus(
        await service.recordPayment(charge.id, { amountMinor: 10, method: PaymentMethod.CASH, currency: 'USD' }, adminId),
        400,
      );
      expectStatus(await service.recordPayment('nope', { amountMinor: 10, method: PaymentMethod.CASH }, adminId), 404);
      expectOk(await service.voidCharge(charge.id, 'Cancelled', adminId));
      expectStatus(await service.recordPayment(charge.id, { amountMinor: 10, method: PaymentMethod.CASH }, adminId), 409);
    });

    it('validates reversals: blank reason 400, unknown payment 404', async () => {
      expectStatus(await service.reversePayment('nope', { reason: ' ' }, adminId), 400);
      expectStatus(await service.reversePayment('nope', { reason: 'x' }, adminId), 404);
    });
  });

  describe('adjustments', () => {
    it('applies a signed, reasoned adjustment', async () => {
      await priced();
      const charge = await issueOne();
      const adj = expectOk(
        await service.applyAdjustment(charge.id, { kind: AdjustmentKind.DISCOUNT, amountMinor: -1000, reason: 'Early bird' }, adminId),
      );
      expect(adj.amountMinor).toBe(-1000);
      expect((await repo.getCharge(charge.id))?.balanceMinor).toBe(7000);
    });

    it('refuses zero (400), no reason (400), unknown (404) and void (409)', async () => {
      await priced();
      const charge = await issueOne();
      const kind = AdjustmentKind.SURCHARGE;
      expectStatus(await service.applyAdjustment(charge.id, { kind, amountMinor: 0, reason: 'x' }, adminId), 400);
      expectStatus(await service.applyAdjustment(charge.id, { kind, amountMinor: 5, reason: '' }, adminId), 400);
      expectStatus(await service.applyAdjustment('nope', { kind, amountMinor: 5, reason: 'x' }, adminId), 404);
      expectOk(await service.voidCharge(charge.id, 'Cancelled', adminId));
      expectStatus(await service.applyAdjustment(charge.id, { kind, amountMinor: 5, reason: 'x' }, adminId), 409);
    });
  });

  describe('voidCharge', () => {
    it('refuses without a reason (400), with net payments (409), twice (409), unknown (404)', async () => {
      await priced();
      const charge = await issueOne();
      expectStatus(await service.voidCharge(charge.id, '  ', adminId), 400);
      expectStatus(await service.voidCharge('nope', 'x', adminId), 404);

      const payment = expectOk(
        await service.recordPayment(charge.id, { amountMinor: 2000, method: PaymentMethod.CASH }, adminId),
      );
      expectStatus(await service.voidCharge(charge.id, 'Cancelled', adminId), 409);

      expectOk(await service.reversePayment(payment.id, { reason: 'Refund' }, adminId));
      const voided = expectOk(await service.voidCharge(charge.id, 'Cancelled', adminId));
      expect(voided).toMatchObject({ status: ChargeStatus.VOID, voidReason: 'Cancelled' });
      expectStatus(await service.voidCharge(charge.id, 'Again', adminId), 409);
    });
  });

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  describe('getEventSummary', () => {
    it('charged + adjustments - received equals the sum of the live balances', async () => {
      await priced();
      const userC = await insertUser();
      const data = expectOk(await service.issueCharges({ eventId, userIds: [userA, userB, userC] }, adminId));
      const [a, b, c] = [userA, userB, userC].map((u) => data.created.find((x) => x.userId === u)!);

      expectOk(await service.recordPayment(a.id, { amountMinor: 8000, method: PaymentMethod.PIX }, adminId));
      expectOk(await service.recordPayment(b.id, { amountMinor: 3000, method: PaymentMethod.CASH }, adminId));
      expectOk(
        await service.applyAdjustment(b.id, { kind: AdjustmentKind.DISCOUNT, amountMinor: -500, reason: 'Friend' }, adminId),
      );
      expectOk(
        await service.applyAdjustment(c.id, { kind: AdjustmentKind.WAIVER, amountMinor: -100, reason: 'Rounding' }, adminId),
      );
      expectOk(await service.voidCharge(c.id, 'Did not attend', adminId));

      const summary = expectOk(await service.getEventSummary(eventId));
      const live = (await repo.listCharges({ eventId })).filter((x) => x.status !== ChargeStatus.VOID);
      const sumOfBalances = live.reduce((sum, x) => sum + x.balanceMinor, 0);

      expect(summary).toMatchObject({
        currency: 'BRL',
        chargedMinor: 16000,
        adjustmentsMinor: -500,
        receivedMinor: 11000,
        chargeCount: 3,
        counts: { open: 1, paid: 1, void: 1 },
      });
      expect(summary.chargedMinor + summary.adjustmentsMinor - summary.receivedMinor).toBe(sumOfBalances);
      expect(summary.outstandingMinor).toBe(sumOfBalances);
    });

    it('is empty in the active currency for an uncharged event, and 404s an unknown one', async () => {
      expect(expectOk(await service.getEventSummary(eventId))).toMatchObject({
        currency: 'BRL',
        chargedMinor: 0,
        chargeCount: 0,
      });
      expectStatus(await service.getEventSummary('nope'), 404);
    });
  });

  it('getChargeDetail returns the ledger split, and 404s an unknown charge', async () => {
    await priced();
    const charge = await issueOne();
    const payment = expectOk(
      await service.recordPayment(charge.id, { amountMinor: 1000, method: PaymentMethod.CASH }, adminId),
    );
    const detail = expectOk(await service.getChargeDetail(charge.id));
    expect(detail.payments.map((p) => p.id)).toEqual([payment.id]);
    expect(detail.adjustments).toEqual([]);
    expect(detail.balanceMinor).toBe(7000);
    expectStatus(await service.getChargeDetail('nope'), 404);
  });

  it('emits a billing.charge.* audit line with the actor for each write', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await priced();
    const charge = await issueOne();
    expectOk(await service.recordPayment(charge.id, { amountMinor: 100, method: PaymentMethod.CASH }, adminId));

    const events = info.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(events.map((e) => e.event)).toEqual([
      'billing.charge.set_price',
      'billing.charge.issue',
      'billing.charge.issue_batch',
      'billing.charge.payment',
    ]);
    expect(events.every((e) => e.actor === adminId)).toBe(true);
    info.mockRestore();
  });
});
