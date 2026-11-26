import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  D1GatewayRepository,
  GATEWAY_DISPUTE_DETAIL_PREFIX,
  GATEWAY_EVENT_ERROR_MAX_LENGTH,
} from '@api/adapters/db/d1-gateway-repository';
import type { CreateGatewayCheckoutInput } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { applyMigrations } from '../helpers/apply-migrations';
import {
  insertChargePayment,
  insertInvoicePayment,
  seedGatewayWorld,
  type GatewayWorld,
} from './gateway-fixtures';

/**
 * `gateway_checkouts` and `gateway_events` through their D1 adapter (RFC 0026
 * sections 2, 6 and 9): the conditional writes that carry the idempotency, and
 * the ordering rules the reconcile run and the exceptions list rely on. The
 * clock is injected, so "30 minutes ago" is a fact of the test, not a sleep.
 */

const { CheckoutStatus, GatewayEventOutcome } = Entities.Config;

const T0 = Date.parse('2026-11-20T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('D1GatewayRepository', () => {
  let world: GatewayWorld;
  let clock: number;
  let repo: D1GatewayRepository;

  const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.DB.exec('PRAGMA foreign_keys = ON');
  });

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM gateway_events'),
      env.DB.prepare('DELETE FROM gateway_checkouts'),
    ]);
    world = await seedGatewayWorld();
    clock = T0;
    repo = new D1GatewayRepository(env.DB, () => new Date(clock));
  });

  function checkoutInput(overrides: Partial<CreateGatewayCheckoutInput> = {}): CreateGatewayCheckoutInput {
    return {
      id: crypto.randomUUID(),
      provider: 'mercadopago',
      receivableKind: 'invoice',
      receivableId: world.invoiceId,
      userId: world.studentId,
      createdBy: world.studentId,
      amountMinor: 15000,
      currency: 'BRL',
      checkoutUrl: 'about:blank',
      expiresAt: at(24 * HOUR),
      ...overrides,
    };
  }

  /** A checkout on a receivable of its own, so any number can be open at once. */
  async function openCheckoutNow(overrides: Partial<CreateGatewayCheckoutInput> = {}) {
    const own = await seedGatewayWorld();
    return repo.createCheckout(
      checkoutInput({ receivableId: own.invoiceId, userId: own.studentId, createdBy: own.studentId, ...overrides }),
    );
  }

  // -------------------------------------------------------------------------
  // Checkouts
  // -------------------------------------------------------------------------

  it('createCheckout writes an open row and getCheckout reads it back', async () => {
    const input = checkoutInput({ createdBy: world.adminId });
    const created = await repo.createCheckout(input);

    expect(created).toEqual({
      id: input.id,
      provider: 'mercadopago',
      receivableKind: 'invoice',
      receivableId: world.invoiceId,
      userId: world.studentId,
      createdBy: world.adminId,
      amountMinor: 15000,
      currency: 'BRL',
      status: CheckoutStatus.OPEN,
      providerSessionId: null,
      providerPaymentId: null,
      invoicePaymentId: null,
      chargePaymentId: null,
      checkoutUrl: 'about:blank',
      expiresAt: at(24 * HOUR),
      createdAt: at(0),
      updatedAt: at(0),
      closedAt: null,
      lastCheckedAt: null,
      failureDetail: null,
      dismissedAt: null,
      dismissedBy: null,
      dismissNote: null,
    });
    expect(await repo.getCheckout(input.id)).toEqual(created);
    expect(await repo.getCheckout('missing')).toBeNull();
  });

  it('createCheckout fails while the receivable has an open checkout, on any provider', async () => {
    await repo.createCheckout(checkoutInput());
    await expect(repo.createCheckout(checkoutInput({ provider: 'stripe' }))).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('findOpenCheckout returns the one open row of a receivable and ignores closed ones', async () => {
    expect(await repo.findOpenCheckout('invoice', world.invoiceId)).toBeNull();

    const first = await repo.createCheckout(checkoutInput());
    expect((await repo.findOpenCheckout('invoice', world.invoiceId))?.id).toBe(first.id);
    // The same id on the other rail is another receivable.
    expect(await repo.findOpenCheckout('event_charge', world.invoiceId)).toBeNull();

    await repo.closeCheckout(first.id, { status: CheckoutStatus.CANCELLED });
    expect(await repo.findOpenCheckout('invoice', world.invoiceId)).toBeNull();

    const second = await repo.createCheckout(checkoutInput({ provider: 'stripe' }));
    expect((await repo.findOpenCheckout('invoice', world.invoiceId))?.id).toBe(second.id);
  });

  it('updateCheckout stores the provider answer without touching the status', async () => {
    const created = await repo.createCheckout(checkoutInput());
    clock = T0 + 5_000;

    const updated = await repo.updateCheckout(created.id, {
      providerSessionId: 'pref-1',
      checkoutUrl: 'https://pay.example.invalid/pref-1',
      expiresAt: at(2 * HOUR),
    });
    expect(updated).toMatchObject({
      status: CheckoutStatus.OPEN,
      providerSessionId: 'pref-1',
      checkoutUrl: 'https://pay.example.invalid/pref-1',
      expiresAt: at(2 * HOUR),
      failureDetail: null,
      createdAt: at(0),
      updatedAt: at(5_000),
    });

    // An omitted key is left alone; null clears the detail.
    const noted = await repo.updateCheckout(created.id, { failureDetail: 'provider status: pending' });
    expect(noted).toMatchObject({ providerSessionId: 'pref-1', failureDetail: 'provider status: pending' });
    expect((await repo.updateCheckout(created.id, { failureDetail: null }))?.failureDetail).toBeNull();

    // An empty patch changes nothing, not even updated_at.
    clock = T0 + 60_000;
    expect((await repo.updateCheckout(created.id, {}))?.updatedAt).toBe(at(5_000));
    expect(await repo.updateCheckout('missing', { checkoutUrl: 'x' })).toBeNull();
  });

  it('closeCheckout moves an open checkout once: the second caller gets null', async () => {
    const created = await repo.createCheckout(checkoutInput());
    const paymentId = await insertInvoicePayment(world, { method: 'gateway', externalReference: 'mercadopago:pay-1' });
    clock = T0 + 10_000;

    const [a, b] = await Promise.all([
      repo.closeCheckout(created.id, { status: CheckoutStatus.PAID, providerPaymentId: 'pay-1', invoicePaymentId: paymentId }),
      repo.closeCheckout(created.id, { status: CheckoutStatus.PAID, providerPaymentId: 'pay-1', invoicePaymentId: paymentId }),
    ]);
    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({
      status: CheckoutStatus.PAID,
      providerPaymentId: 'pay-1',
      invoicePaymentId: paymentId,
      chargePaymentId: null,
      closedAt: at(10_000),
      updatedAt: at(10_000),
    });

    expect(await repo.closeCheckout(created.id, { status: CheckoutStatus.EXPIRED })).toBeNull();
    expect((await repo.getCheckout(created.id))?.status).toBe(CheckoutStatus.PAID);
    expect(await repo.closeCheckout('missing', { status: CheckoutStatus.EXPIRED })).toBeNull();
  });

  it('closeCheckout only leaves the statuses named in from', async () => {
    const created = await repo.createCheckout(
      checkoutInput({ receivableKind: 'event_charge', receivableId: world.chargeId, amountMinor: 8000 }),
    );
    const expired = await repo.closeCheckout(created.id, { status: CheckoutStatus.EXPIRED, failureDetail: 'expired unpaid' });
    expect(expired).toMatchObject({ status: CheckoutStatus.EXPIRED, failureDetail: 'expired unpaid' });

    // Default `from` is open only: a late payment needs the caller to name the closed states.
    expect(await repo.closeCheckout(created.id, { status: CheckoutStatus.PAID })).toBeNull();
    expect(await repo.closeCheckout(created.id, { status: CheckoutStatus.PAID, from: [] })).toBeNull();

    const paymentId = await insertChargePayment(world, { method: 'gateway', externalReference: 'mercadopago:late-1' });
    const paid = await repo.closeCheckout(created.id, {
      status: CheckoutStatus.PAID,
      from: [CheckoutStatus.OPEN, CheckoutStatus.EXPIRED, CheckoutStatus.CANCELLED],
      providerPaymentId: 'late-1',
      chargePaymentId: paymentId,
    });
    expect(paid).toMatchObject({
      status: CheckoutStatus.PAID,
      providerPaymentId: 'late-1',
      chargePaymentId: paymentId,
      invoicePaymentId: null,
      // Not named in the input, so left as it was.
      failureDetail: 'expired unpaid',
    });
  });

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  it('recordEvent inserts once and afterwards returns the stored row', async () => {
    const first = await repo.recordEvent({ provider: 'mercadopago', eventId: 'evt-1', type: 'payment', providerPaymentId: 'pay-1' });
    expect(first.inserted).toBe(true);
    expect(first.event).toEqual({
      provider: 'mercadopago',
      eventId: 'evt-1',
      type: 'payment',
      providerPaymentId: 'pay-1',
      checkoutId: null,
      receivedAt: at(0),
      processedAt: null,
      outcome: GatewayEventOutcome.RECEIVED,
      attempts: 1,
      error: null,
      dismissedAt: null,
      dismissedBy: null,
      dismissNote: null,
    });

    await repo.markEvent('mercadopago', 'evt-1', { outcome: GatewayEventOutcome.APPLIED });
    clock = T0 + HOUR;

    const again = await repo.recordEvent({ provider: 'mercadopago', eventId: 'evt-1', type: 'refund' });
    expect(again.inserted).toBe(false);
    // Nothing of the second delivery is written: stored outcome, type, time and attempts.
    expect(again.event).toMatchObject({
      outcome: GatewayEventOutcome.APPLIED,
      type: 'payment',
      providerPaymentId: 'pay-1',
      receivedAt: at(0),
      attempts: 1,
    });

    // The same id from another provider is another event.
    expect((await repo.recordEvent({ provider: 'stripe', eventId: 'evt-1', type: 'payment' })).inserted).toBe(true);
  });

  it('recordEvent under two concurrent calls leaves one row and one inserter', async () => {
    const results = await Promise.all([
      repo.recordEvent({ provider: 'mercadopago', eventId: 'evt-race', type: 'payment' }),
      repo.recordEvent({ provider: 'mercadopago', eventId: 'evt-race', type: 'payment' }),
      repo.recordEvent({ provider: 'mercadopago', eventId: 'evt-race', type: 'payment' }),
    ]);
    expect(results.filter((r) => r.inserted)).toHaveLength(1);
    for (const result of results) expect(result.event.outcome).toBe(GatewayEventOutcome.RECEIVED);

    const row = await env.DB
      .prepare("SELECT COUNT(*) AS n, SUM(attempts) AS attempts FROM gateway_events WHERE event_id = 'evt-race'")
      .first<{ n: number; attempts: number }>();
    expect(row).toEqual({ n: 1, attempts: 1 });
  });

  it('markEvent settles an unsettled event once and never overwrites a settled one', async () => {
    const checkout = await repo.createCheckout(checkoutInput());
    await repo.recordEvent({ provider: 'mercadopago', eventId: 'evt-2', type: 'payment' });
    clock = T0 + 2_000;

    const failed = await repo.markEvent('mercadopago', 'evt-2', {
      outcome: GatewayEventOutcome.FAILED,
      error: 'x'.repeat(GATEWAY_EVENT_ERROR_MAX_LENGTH + 300),
    });
    expect(failed).toMatchObject({ outcome: GatewayEventOutcome.FAILED, attempts: 1, processedAt: at(2_000) });
    expect(failed?.error).toHaveLength(GATEWAY_EVENT_ERROR_MAX_LENGTH);

    // A new attempt on a known unsettled event: re-opened and counted.
    const reopened = await repo.markEvent('mercadopago', 'evt-2', {
      outcome: GatewayEventOutcome.RECEIVED,
      countAttempt: true,
    });
    expect(reopened).toMatchObject({ outcome: GatewayEventOutcome.RECEIVED, attempts: 2, processedAt: at(2_000) });

    clock = T0 + 9_000;
    const [a, b] = await Promise.all([
      repo.markEvent('mercadopago', 'evt-2', {
        outcome: GatewayEventOutcome.APPLIED,
        checkoutId: checkout.id,
        providerPaymentId: 'pay-2',
        error: null,
      }),
      repo.markEvent('mercadopago', 'evt-2', { outcome: GatewayEventOutcome.DUPLICATE }),
    ]);
    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);

    const settled = winners[0]!;
    expect(settled.attempts).toBe(2);
    expect(settled.processedAt).toBe(at(9_000));

    // Final: neither another outcome nor a re-open changes it.
    expect(await repo.markEvent('mercadopago', 'evt-2', { outcome: GatewayEventOutcome.FAILED, error: 'late' })).toBeNull();
    expect(await repo.markEvent('mercadopago', 'evt-2', { outcome: GatewayEventOutcome.RECEIVED, countAttempt: true })).toBeNull();
    const stored = (await repo.recordEvent({ provider: 'mercadopago', eventId: 'evt-2', type: 'payment' })).event;
    expect(stored.outcome).toBe(settled.outcome);
    expect(stored.attempts).toBe(2);

    expect(await repo.markEvent('mercadopago', 'missing', { outcome: GatewayEventOutcome.APPLIED })).toBeNull();
    expect(await repo.markEvent('stripe', 'evt-2', { outcome: GatewayEventOutcome.APPLIED })).toBeNull();
  });

  it('markEvent links the checkout and the payment and leaves omitted keys alone', async () => {
    const checkout = await repo.createCheckout(checkoutInput());
    await repo.recordEvent({ provider: 'mercadopago', eventId: 'evt-3', type: 'payment', providerPaymentId: 'pay-3' });

    const failed = await repo.markEvent('mercadopago', 'evt-3', {
      outcome: GatewayEventOutcome.FAILED,
      checkoutId: checkout.id,
      error: 'ledger write failed',
    });
    expect(failed).toMatchObject({ checkoutId: checkout.id, providerPaymentId: 'pay-3', error: 'ledger write failed' });

    const applied = await repo.markEvent('mercadopago', 'evt-3', { outcome: GatewayEventOutcome.APPLIED, error: null });
    expect(applied).toMatchObject({
      outcome: GatewayEventOutcome.APPLIED,
      checkoutId: checkout.id,
      providerPaymentId: 'pay-3',
      error: null,
    });
  });

  // -------------------------------------------------------------------------
  // Reconciliation work lists
  // -------------------------------------------------------------------------

  it('listCheckoutsToConfirm: past expiry or closed first, then least recently asked, never-asked first', async () => {
    // Created about 2 h ago, a second apart, so every open one is older than
    // 30 minutes and creation order is the tie-break among the never-asked.
    clock = T0 - 2 * HOUR;
    const openCheckout = async (overrides: Partial<CreateGatewayCheckoutInput> = {}) => {
      clock += 1_000;
      return openCheckoutNow(overrides);
    };
    const youngOpenAsked = await openCheckout();
    const youngOpenNever = await openCheckout();
    const youngOpenAskedEarlier = await openCheckout();
    const expiredOpenAsked = await openCheckout({ expiresAt: at(-HOUR) });
    const expiredOpenNever = await openCheckout({ expiresAt: at(-HOUR) });
    const cancelledNever = await openCheckout();
    const expiredAskedBeforeClose = await openCheckout();
    const expiredAskedAfterClose = await openCheckout();
    const paid = await openCheckout();
    const failed = await openCheckout();

    const stampChecked = async (id: string, offsetMs: number) => {
      clock = T0 + offsetMs;
      await repo.markChecked(id);
    };
    await stampChecked(youngOpenAsked.id, -40 * MINUTE);
    await stampChecked(youngOpenAskedEarlier.id, -90 * MINUTE);
    await stampChecked(expiredOpenAsked.id, -50 * MINUTE);
    await stampChecked(expiredAskedBeforeClose.id, -70 * MINUTE);

    clock = T0 - HOUR;
    await repo.closeCheckout(cancelledNever.id, { status: CheckoutStatus.CANCELLED });
    await repo.closeCheckout(expiredAskedBeforeClose.id, { status: CheckoutStatus.EXPIRED });
    await repo.closeCheckout(expiredAskedAfterClose.id, { status: CheckoutStatus.EXPIRED });
    await repo.closeCheckout(paid.id, { status: CheckoutStatus.PAID });
    await repo.closeCheckout(failed.id, { status: CheckoutStatus.FAILED });
    // The final ask already happened: it drops off the list.
    await stampChecked(expiredAskedAfterClose.id, -30 * MINUTE);

    // Too young to ask: 10 minutes old, not expired.
    clock = T0 - 10 * MINUTE;
    const fresh = await openCheckoutNow();

    clock = T0;
    const all = await repo.listCheckoutsToConfirm(25);
    expect(all.total).toBe(7);
    expect(all.items.map((c) => c.id)).toEqual([
      // Past expiry or closed — never asked first (by creation), then least recently asked.
      expiredOpenNever.id,
      cancelledNever.id,
      expiredAskedBeforeClose.id,
      expiredOpenAsked.id,
      // Open and unexpired, older than 30 minutes.
      youngOpenNever.id,
      youngOpenAskedEarlier.id,
      youngOpenAsked.id,
    ]);
    const listed = new Set(all.items.map((c) => c.id));
    for (const absent of [paid, failed, fresh, expiredAskedAfterClose]) expect(listed.has(absent.id)).toBe(false);

    // The cap keeps the head of the order and still reports everything due.
    const capped = await repo.listCheckoutsToConfirm(3);
    expect(capped.total).toBe(7);
    expect(capped.items.map((c) => c.id)).toEqual([expiredOpenNever.id, cancelledNever.id, expiredAskedBeforeClose.id]);
    expect(await repo.listCheckoutsToConfirm(0)).toEqual({ items: [], total: 7 });
  });

  it('listCheckoutsToConfirm compares instants, whatever text format a row was written in', async () => {
    clock = T0 - 10 * MINUTE;
    const young = await openCheckoutNow();
    // Same checkout, timestamps rewritten the way SQLite's datetime() default writes them.
    await env.DB
      .prepare("UPDATE gateway_checkouts SET created_at = '2026-11-20 11:20:00', expires_at = '2026-11-21 12:00:00' WHERE id = ?")
      .bind(young.id)
      .run();
    clock = T0;
    expect((await repo.listCheckoutsToConfirm(25)).items.map((c) => c.id)).toEqual([young.id]);

    await env.DB
      .prepare("UPDATE gateway_checkouts SET created_at = '2026-11-20 11:45:00' WHERE id = ?")
      .bind(young.id)
      .run();
    expect((await repo.listCheckoutsToConfirm(25)).total).toBe(0);

    // Expiring exactly now counts as past expiry.
    await env.DB
      .prepare("UPDATE gateway_checkouts SET expires_at = '2026-11-20 12:00:00' WHERE id = ?")
      .bind(young.id)
      .run();
    expect((await repo.listCheckoutsToConfirm(25)).total).toBe(1);
  });

  it('markChecked stamps last_checked_at and nothing else', async () => {
    const created = await repo.createCheckout(checkoutInput());
    clock = T0 + 7 * MINUTE;
    await repo.markChecked(created.id);
    expect(await repo.getCheckout(created.id)).toEqual({ ...created, lastCheckedAt: at(7 * MINUTE) });
    await expect(repo.markChecked('missing')).resolves.toBeUndefined();
  });

  it('listUnsettledEvents: failed or received, 15 minutes to 72 hours old, fewest attempts first', async () => {
    const record = async (eventId: string, offsetMs: number) => {
      clock = T0 + offsetMs;
      await repo.recordEvent({ provider: 'mercadopago', eventId, type: 'payment' });
    };
    await record('too-young', -10 * MINUTE);
    await record('too-old', -73 * HOUR);
    await record('applied', -2 * HOUR);
    await record('orphan', -2 * HOUR);
    await record('received-1-attempt-newer', -HOUR);
    await record('received-1-attempt-older', -3 * HOUR);
    await record('failed-3-attempts', -70 * HOUR);
    await record('failed-2-attempts', -20 * MINUTE);

    clock = T0 - 19 * MINUTE;
    await repo.markEvent('mercadopago', 'applied', { outcome: GatewayEventOutcome.APPLIED });
    await repo.markEvent('mercadopago', 'orphan', { outcome: GatewayEventOutcome.ORPHAN });
    for (let i = 0; i < 2; i += 1) {
      await repo.markEvent('mercadopago', 'failed-3-attempts', { outcome: GatewayEventOutcome.RECEIVED, countAttempt: true });
    }
    await repo.markEvent('mercadopago', 'failed-3-attempts', { outcome: GatewayEventOutcome.FAILED, error: 'again' });
    await repo.markEvent('mercadopago', 'failed-2-attempts', { outcome: GatewayEventOutcome.FAILED, countAttempt: true, error: 'once' });

    clock = T0;
    const all = await repo.listUnsettledEvents(10);
    expect(all.total).toBe(4);
    expect(all.items.map((e) => [e.eventId, e.attempts])).toEqual([
      ['received-1-attempt-older', 1],
      ['received-1-attempt-newer', 1],
      ['failed-2-attempts', 2],
      ['failed-3-attempts', 3],
    ]);

    const capped = await repo.listUnsettledEvents(1);
    expect(capped.total).toBe(4);
    expect(capped.items.map((e) => e.eventId)).toEqual(['received-1-attempt-older']);
  });

  // -------------------------------------------------------------------------
  // Exceptions
  // -------------------------------------------------------------------------

  it('listExceptions: orphan, mismatch, failed, stale received, mismatch and disputed checkouts, oldest first', async () => {
    const record = async (eventId: string, offsetMs: number, outcome?: Entities.Config.GatewayEventOutcome, checkoutId?: string) => {
      clock = T0 + offsetMs;
      await repo.recordEvent({ provider: 'mercadopago', eventId, type: 'payment' });
      if (outcome) await repo.markEvent('mercadopago', eventId, { outcome, checkoutId });
    };

    clock = T0 - 10 * HOUR;
    const mismatchCheckout = await openCheckoutNow();
    const disputedCheckout = await openCheckoutNow();
    const quietCheckout = await openCheckoutNow();
    const expiredCheckout = await openCheckoutNow();

    await record('orphan', -9 * HOUR, GatewayEventOutcome.ORPHAN);
    clock = T0 - 8 * HOUR;
    await repo.closeCheckout(mismatchCheckout.id, { status: CheckoutStatus.MISMATCH, failureDetail: 'currency USD, expected BRL' });
    await record('mismatch', -7 * HOUR, GatewayEventOutcome.MISMATCH, mismatchCheckout.id);
    await record('received-stale', -6 * HOUR);
    clock = T0 - 5 * HOUR;
    await repo.closeCheckout(disputedCheckout.id, { status: CheckoutStatus.PAID });
    await repo.updateCheckout(disputedCheckout.id, { failureDetail: `${GATEWAY_DISPUTE_DETAIL_PREFIX}opened` });
    await record('failed', -4 * HOUR, GatewayEventOutcome.FAILED);
    // Not exceptions.
    await record('received-fresh', -30 * MINUTE);
    await record('applied', -3 * HOUR, GatewayEventOutcome.APPLIED, quietCheckout.id);
    await record('duplicate', -3 * HOUR, GatewayEventOutcome.DUPLICATE);
    await record('ignored', -3 * HOUR, GatewayEventOutcome.IGNORED);
    clock = T0 - 2 * HOUR;
    await repo.closeCheckout(expiredCheckout.id, { status: CheckoutStatus.EXPIRED, failureDetail: 'expired unpaid' });

    clock = T0;
    const list = await repo.listExceptions();
    expect(
      list.map((row) => (row.kind === 'event' ? `event:${row.event.eventId}` : `checkout:${row.checkout.id}`)),
    ).toEqual([
      'event:orphan',
      `checkout:${mismatchCheckout.id}`,
      'event:mismatch',
      'event:received-stale',
      `checkout:${disputedCheckout.id}`,
      'event:failed',
    ]);
    expect(list.map((row) => row.occurredAt)).toEqual([
      at(-9 * HOUR),
      at(-8 * HOUR),
      at(-7 * HOUR),
      at(-6 * HOUR),
      at(-5 * HOUR),
      at(-4 * HOUR),
    ]);

    const mismatchEvent = list[2];
    expect(mismatchEvent.kind === 'event' && mismatchEvent.checkout?.id).toBe(mismatchCheckout.id);
    const orphanEvent = list[0];
    expect(orphanEvent.kind === 'event' && orphanEvent.checkout).toBeNull();
  });

  it('dismissException hides a row once, without changing a status or an outcome', async () => {
    clock = T0 - 3 * HOUR;
    const checkout = await openCheckoutNow();
    await repo.closeCheckout(checkout.id, { status: CheckoutStatus.MISMATCH, failureDetail: 'currency USD, expected BRL' });
    await repo.recordEvent({ provider: 'mercadopago', eventId: 'orphan-1', type: 'payment' });
    await repo.markEvent('mercadopago', 'orphan-1', { outcome: GatewayEventOutcome.ORPHAN });
    const before = await repo.getCheckout(checkout.id);

    clock = T0;
    expect(await repo.listExceptions()).toHaveLength(2);

    expect(
      await repo.dismissException({ kind: 'event', provider: 'mercadopago', eventId: 'orphan-1' }, { dismissedBy: world.adminId, note: 'test payment' }),
    ).toBe(true);
    expect(
      await repo.dismissException({ kind: 'checkout', checkoutId: checkout.id }, { dismissedBy: world.adminId, note: 'refunded at the provider' }),
    ).toBe(true);
    expect(await repo.listExceptions()).toEqual([]);

    // Already dismissed, or not there at all.
    expect(
      await repo.dismissException({ kind: 'event', provider: 'mercadopago', eventId: 'orphan-1' }, { dismissedBy: world.adminId, note: 'again' }),
    ).toBe(false);
    expect(
      await repo.dismissException({ kind: 'checkout', checkoutId: checkout.id }, { dismissedBy: world.adminId, note: 'again' }),
    ).toBe(false);
    expect(
      await repo.dismissException({ kind: 'event', provider: 'stripe', eventId: 'orphan-1' }, { dismissedBy: world.adminId, note: 'x' }),
    ).toBe(false);
    expect(
      await repo.dismissException({ kind: 'checkout', checkoutId: 'missing' }, { dismissedBy: world.adminId, note: 'x' }),
    ).toBe(false);

    expect(await repo.getCheckout(checkout.id)).toEqual({
      ...before,
      dismissedAt: at(0),
      dismissedBy: world.adminId,
      dismissNote: 'refunded at the provider',
    });
    const event = (await repo.recordEvent({ provider: 'mercadopago', eventId: 'orphan-1', type: 'payment' })).event;
    expect(event).toMatchObject({
      outcome: GatewayEventOutcome.ORPHAN,
      attempts: 1,
      dismissedAt: at(0),
      dismissedBy: world.adminId,
      dismissNote: 'test payment',
    });
  });

  it('updateCheckout with clearDismissal returns a dismissed checkout to the exceptions list', async () => {
    clock = T0 - 3 * HOUR;
    const checkout = await openCheckoutNow();
    await repo.closeCheckout(checkout.id, { status: CheckoutStatus.PAID });
    await repo.updateCheckout(checkout.id, { failureDetail: `${GATEWAY_DISPUTE_DETAIL_PREFIX}opened` });
    await repo.dismissException({ kind: 'checkout', checkoutId: checkout.id }, { dismissedBy: world.adminId, note: 'watching' });
    expect(await repo.listExceptions()).toEqual([]);

    clock = T0;
    const updated = await repo.updateCheckout(checkout.id, {
      failureDetail: `${GATEWAY_DISPUTE_DETAIL_PREFIX}lost`,
      clearDismissal: true,
    });
    expect(updated).toMatchObject({
      status: CheckoutStatus.PAID,
      failureDetail: 'dispute lost',
      dismissedAt: null,
      dismissedBy: null,
      dismissNote: null,
    });
    const list = await repo.listExceptions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'checkout', occurredAt: at(0) });
  });
});
