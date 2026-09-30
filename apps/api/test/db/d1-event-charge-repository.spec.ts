import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1EventChargeRepository } from '@api/adapters/db/d1-event-charge-repository';
import type { IssueChargeItem } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { applyMigrations } from '../helpers/apply-migrations';

const { ChargeStatus, ContractTermsSource, PaymentMethod, AdjustmentKind } = Entities.Config;

describe('D1EventChargeRepository', () => {
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

  async function insertEvent(): Promise<string> {
    const id = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO events (id, slug, title, starts_at, status, created_by)
         VALUES (?, ?, 'Seminar', '2030-01-01 19:00:00', 'published', ?)`,
      )
      .bind(id, `seminar-${id}`, adminId)
      .run();
    return id;
  }

  function item(userId: string, overrides: Partial<IssueChargeItem> = {}): IssueChargeItem {
    return {
      userId,
      amountMinor: 8000,
      currency: 'BRL',
      termsSource: ContractTermsSource.STANDARD,
      dueDate: '2030-01-10',
      graceDays: 5,
      ...overrides,
    };
  }

  function issue(items: IssueChargeItem[], forEvent = eventId) {
    return repo.issueCharges({ eventId: forEvent, description: 'Seminar', issuedBy: adminId, items });
  }

  function pay(chargeId: string, amountMinor: number, reversesId: string | null = null) {
    return repo.recordPayment({
      chargeId,
      amountMinor,
      currency: 'BRL',
      method: PaymentMethod.PIX,
      paidAt: '2030-01-05',
      reversesId,
      recordedBy: adminId,
    });
  }

  async function countCharges(forEvent = eventId): Promise<number> {
    const row = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM event_charges WHERE event_id = ?')
      .bind(forEvent)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  beforeAll(async () => {
    await applyMigrations(env.DB);
    // The currency is validated by a foreign key, which Miniflare leaves off.
    await env.DB.exec('PRAGMA foreign_keys = ON');
    repo = new D1EventChargeRepository(env.DB);
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
    it('returns null for an event with no price row: not for sale', async () => {
      expect(await repo.getPrice(eventId)).toBeNull();
    });

    it('sets, replaces and clears the price row, defaulting its optional columns', async () => {
      const created = await repo.setPrice({ eventId, amountMinor: 8000, currency: 'BRL', updatedBy: adminId });
      expect(created).toMatchObject({ eventId, amountMinor: 8000, currency: 'BRL', dueInDays: 0, graceDays: 5 });

      const replaced = await repo.setPrice({
        eventId,
        amountMinor: 9000,
        currency: 'BRL',
        dueInDays: 7,
        graceDays: 2,
        updatedBy: adminId,
      });
      expect(replaced).toMatchObject({ amountMinor: 9000, dueInDays: 7, graceDays: 2 });
      expect(await repo.getPrice(eventId)).toEqual(replaced);

      await repo.clearPrice(eventId);
      expect(await repo.getPrice(eventId)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Issue
  // -------------------------------------------------------------------------

  describe('issueCharges', () => {
    it('creates one open charge per item with every snapshot column', async () => {
      const result = await issue([
        item(userA),
        item(userB, {
          amountMinor: 5000,
          termsSource: ContractTermsSource.NEGOTIATED,
          termsNote: 'Guest rate',
          graceDays: 2,
        }),
      ]);

      expect(result.absorbed).toEqual([]);
      expect(result.created).toHaveLength(2);
      expect(result.created[0]).toMatchObject({
        eventId,
        userId: userA,
        description: 'Seminar',
        amountMinor: 8000,
        currency: 'BRL',
        termsSource: ContractTermsSource.STANDARD,
        termsNote: '',
        dueDate: '2030-01-10',
        graceDays: 5,
        status: ChargeStatus.OPEN,
        issuedBy: adminId,
        voidedAt: null,
        voidReason: null,
      });
      expect(result.created[1]).toMatchObject({
        userId: userB,
        amountMinor: 5000,
        termsSource: ContractTermsSource.NEGOTIATED,
        termsNote: 'Guest rate',
        graceDays: 2,
      });
    });

    it('is idempotent: a second identical issue creates nothing and absorbs every pair', async () => {
      const first = await issue([item(userA), item(userB)]);
      expect(first.created).toHaveLength(2);
      const before = await countCharges();

      const second = await issue([item(userA), item(userB)]);

      expect(second.created).toEqual([]);
      expect(second.absorbed).toEqual([
        { eventId, userId: userA },
        { eventId, userId: userB },
      ]);
      expect(await countCharges()).toBe(before);
    });

    it('creates only the new pairs of a partially repeated issue', async () => {
      await issue([item(userA)]);
      const result = await issue([item(userA), item(userB)]);

      expect(result.created.map((c) => c.userId)).toEqual([userB]);
      expect(result.absorbed).toEqual([{ eventId, userId: userA }]);
    });

    it('absorbs a user repeated inside one call', async () => {
      const result = await issue([item(userA), item(userA)]);

      expect(result.created).toHaveLength(1);
      expect(result.absorbed).toEqual([{ eventId, userId: userA }]);
      expect(await countCharges()).toBe(1);
    });

    it('re-issues a new live charge after the previous one was voided', async () => {
      const { created } = await issue([item(userA)]);
      await repo.voidCharge(created[0].id, 'Wrong amount', adminId);

      const again = await issue([item(userA, { amountMinor: 7000 })]);

      expect(again.absorbed).toEqual([]);
      expect(again.created).toHaveLength(1);
      expect(again.created[0].id).not.toBe(created[0].id);
      expect(again.created[0].status).toBe(ChargeStatus.OPEN);
      expect((await repo.getCharge(created[0].id))?.status).toBe(ChargeStatus.VOID);
      expect(await countCharges()).toBe(2);
    });

    it('settles a zero-amount charge at issue', async () => {
      const { created } = await issue([item(userA, { amountMinor: 0 })]);
      expect(created[0].status).toBe(ChargeStatus.PAID);
    });

    it('throws: and writes nothing - on a constraint failure, instead of reporting it absorbed', async () => {
      await expect(issue([item(userA), item(userB, { currency: 'XYZ' })])).rejects.toThrow();
      await expect(issue([item(userA), item(userB, { amountMinor: -1 })])).rejects.toThrow();
      expect(await countCharges()).toBe(0);
    });

    it('returns an empty result for no items', async () => {
      expect(await issue([])).toEqual({ created: [], absorbed: [] });
    });
  });

  // -------------------------------------------------------------------------
  // Ledger and the status cache
  // -------------------------------------------------------------------------

  describe('ledger', () => {
    it('flips to paid when a payment equals the balance, back to open on a reversal, and rejects a second reversal', async () => {
      const { created } = await issue([item(userA)]);
      const chargeId = created[0].id;

      const payment = await pay(chargeId, 8000);
      expect(payment).toMatchObject({ chargeId, amountMinor: 8000, method: PaymentMethod.PIX, reversesId: null });
      expect(await repo.getCharge(chargeId)).toMatchObject({ status: ChargeStatus.PAID, balanceMinor: 0 });

      const reversal = await pay(chargeId, -8000, payment.id);
      expect(reversal.reversesId).toBe(payment.id);
      expect(await repo.getCharge(chargeId)).toMatchObject({ status: ChargeStatus.OPEN, balanceMinor: 8000 });

      await expect(pay(chargeId, -8000, payment.id)).rejects.toThrow();
      expect(await repo.getCharge(chargeId)).toMatchObject({ status: ChargeStatus.OPEN, balanceMinor: 8000 });
    });

    it('stays open on a partial payment', async () => {
      const { created } = await issue([item(userA)]);
      await pay(created[0].id, 3000);
      expect(await repo.getCharge(created[0].id)).toMatchObject({ status: ChargeStatus.OPEN, balanceMinor: 5000 });
    });

    it('settles through an adjustment that zeroes the balance', async () => {
      const { created } = await issue([item(userA)]);
      const adjustment = await repo.applyAdjustment({
        chargeId: created[0].id,
        kind: AdjustmentKind.WAIVER,
        amountMinor: -8000,
        reason: 'Scholarship',
        appliedBy: adminId,
      });

      expect(adjustment).toMatchObject({ kind: AdjustmentKind.WAIVER, amountMinor: -8000, reason: 'Scholarship' });
      expect(await repo.getCharge(created[0].id)).toMatchObject({ status: ChargeStatus.PAID, balanceMinor: 0 });
    });

    it('never changes the status of a void charge', async () => {
      const { created } = await issue([item(userA)]);
      const chargeId = created[0].id;
      await repo.voidCharge(chargeId, 'Issued by mistake', adminId);

      await pay(chargeId, 8000);
      expect((await repo.getCharge(chargeId))?.status).toBe(ChargeStatus.VOID);

      await repo.applyAdjustment({
        chargeId,
        kind: AdjustmentKind.SURCHARGE,
        amountMinor: 500,
        reason: 'Late fee',
        appliedBy: adminId,
      });
      expect((await repo.getCharge(chargeId))?.status).toBe(ChargeStatus.VOID);
    });

    it('computes balance = amount + sum of adjustments - sum of payments on get and list', async () => {
      const { created } = await issue([item(userA), item(userB, { amountMinor: 5000 })]);
      const [chargeA, chargeB] = created;

      await repo.applyAdjustment({
        chargeId: chargeA.id,
        kind: AdjustmentKind.DISCOUNT,
        amountMinor: -1000,
        reason: 'Early bird',
        appliedBy: adminId,
      });
      await repo.applyAdjustment({
        chargeId: chargeA.id,
        kind: AdjustmentKind.SURCHARGE,
        amountMinor: 250,
        reason: 'Mat fee',
        appliedBy: adminId,
      });
      const payment = await pay(chargeA.id, 2000);
      await pay(chargeA.id, -2000, payment.id);
      await pay(chargeA.id, 1500);

      const expectedA = 8000 - 1000 + 250 - 2000 + 2000 - 1500;
      expect((await repo.getCharge(chargeA.id))?.balanceMinor).toBe(expectedA);

      const listed = await repo.listCharges({ eventId });
      expect(listed.map((c) => [c.id, c.balanceMinor])).toEqual(
        expect.arrayContaining([
          [chargeA.id, expectedA],
          [chargeB.id, 5000],
        ]),
      );
    });

    it('reads a payment back by id and returns null for an unknown one', async () => {
      const { created } = await issue([item(userA)]);
      const payment = await pay(created[0].id, 100);
      expect(await repo.getPayment(payment.id)).toEqual(payment);
      expect(await repo.getPayment(crypto.randomUUID())).toBeNull();
    });

    it('lists the ledger in occurrence order, filtered by charge, event, user and date', async () => {
      const otherEvent = await insertEvent();
      const { created } = await issue([item(userA), item(userB)]);
      const other = await issue([item(userA)], otherEvent);

      await repo.recordPayment({
        chargeId: created[0].id,
        amountMinor: 1000,
        currency: 'BRL',
        method: PaymentMethod.CASH,
        paidAt: '2000-01-01',
        recordedBy: adminId,
      });
      await pay(created[1].id, 2000);
      await pay(other.created[0].id, 3000);
      await repo.applyAdjustment({
        chargeId: created[0].id,
        kind: AdjustmentKind.CREDIT,
        amountMinor: -500,
        reason: 'Credit',
        appliedBy: adminId,
      });

      const byCharge = await repo.listLedger({ chargeId: created[0].id });
      expect(byCharge.map((e) => e.entry)).toEqual(['payment', 'adjustment']);

      const byEvent = await repo.listLedger({ eventId });
      expect(byEvent).toHaveLength(3);

      const byUser = await repo.listLedger({ userId: userA });
      expect(byUser).toHaveLength(3);

      const inRange = await repo.listLedger({ eventId, from: '2030-01-01', to: '2030-12-31' });
      expect(inRange.map((e) => (e.entry === 'payment' ? e.payment.amountMinor : null))).toEqual([2000]);

      const sorted = [...byUser].map((e) => e.occurredAt);
      expect(sorted).toEqual([...sorted].sort());
    });
  });

  // -------------------------------------------------------------------------
  // Void and list filters
  // -------------------------------------------------------------------------

  describe('voidCharge and listCharges', () => {
    it('voids once: a second void keeps the first reason - and returns null for an unknown id', async () => {
      const { created } = await issue([item(userA)]);

      const voided = await repo.voidCharge(created[0].id, 'First reason', adminId);
      expect(voided).toMatchObject({ status: ChargeStatus.VOID, voidReason: 'First reason' });
      expect(voided?.voidedAt).not.toBeNull();

      const again = await repo.voidCharge(created[0].id, 'Second reason', adminId);
      expect(again?.voidReason).toBe('First reason');

      expect(await repo.voidCharge(crypto.randomUUID(), 'x', adminId)).toBeNull();
    });

    it('filters by event, user, status and due range', async () => {
      const otherEvent = await insertEvent();
      const { created } = await issue([
        item(userA, { dueDate: '2030-01-10' }),
        item(userB, { dueDate: '2030-02-10' }),
      ]);
      await issue([item(userA, { dueDate: '2030-03-10' })], otherEvent);
      await pay(created[1].id, 8000);

      expect((await repo.listCharges({ eventId })).map((c) => c.userId)).toEqual([userA, userB]);
      expect((await repo.listCharges({ userId: userA })).map((c) => c.eventId)).toEqual([eventId, otherEvent]);
      expect((await repo.listCharges({ eventId, status: ChargeStatus.PAID })).map((c) => c.id)).toEqual([
        created[1].id,
      ]);
      expect(
        (await repo.listCharges({ userId: userA, dueFrom: '2030-02-01', dueTo: '2030-03-31' })).map((c) => c.eventId),
      ).toEqual([otherEvent]);
    });

    it('returns null from getCharge for an unknown id', async () => {
      expect(await repo.getCharge(crypto.randomUUID())).toBeNull();
    });
  });
});
