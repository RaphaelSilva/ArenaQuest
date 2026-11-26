import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BillingService, PAYMENT_REFERENCE_EXISTS } from '@api/core/billing/billing-service';
import { SYSTEM_PAYMENT_ACTOR_ID } from '@api/adapters/db/d1-gateway-repository';
import { FakeBillingRepository } from '../../helpers/fake-billing-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import type { PaymentRecord, RecordPaymentInput } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

/**
 * The contract rail's gateway entry points (RFC 0026 §5), against the
 * in-memory repository. The partial unique index the real table carries is
 * played by `RacingRepository`, which lets a twin row win the insert.
 */

const { BillingCycle, BillingStanding, ContractTermsSource, InvoiceStatus, PaymentMethod } =
  Entities.Config;

const ADMIN = 'admin-1';
const STUDENT = 'student-1';
const PAID_AT = '2026-01-12T14:03:00.000Z';

function ok<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
  return result.data;
}

/** The fake, plus the index: a twin can be slipped in between the read and the write. */
class RacingRepository extends FakeBillingRepository {
  /** Written just before the next insert, which then fails as the index would. */
  twin: RecordPaymentInput | null = null;
  /** Makes the next insert fail on the one-reversal index, with nothing written. */
  failOneReversal = false;
  inserts = 0;

  override async recordPayment(input: RecordPaymentInput): Promise<PaymentRecord> {
    if (this.twin) {
      const twin = this.twin;
      this.twin = null;
      await super.recordPayment(twin);
      throw new Error('D1_ERROR: UNIQUE constraint failed: payments.external_reference');
    }
    if (this.failOneReversal) {
      this.failOneReversal = false;
      throw new Error('D1_ERROR: UNIQUE constraint failed: payments.reverses_id');
    }
    this.inserts += 1;
    return super.recordPayment(input);
  }
}

describe('BillingService — gateway ledger entry points', () => {
  let repo: RacingRepository;
  let service: BillingService;
  let audit: ReturnType<typeof vi.spyOn>;
  let invoiceId: string;

  function events(name: string): Array<Record<string, unknown>> {
    return audit.mock.calls
      .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
      .filter((event) => event.event === name);
  }

  async function payments(): Promise<PaymentRecord[]> {
    const ledger = await repo.listLedger({ invoiceId });
    return ledger.flatMap((entry) => (entry.entry === 'payment' ? [entry.payment] : []));
  }

  async function standing(asOf = '2026-02-01') {
    return ok(await service.getStanding(STUDENT, asOf)).standing;
  }

  function land(reference = 'mercadopago:pay-1', amountMinor = 15000, currency = 'BRL') {
    return service.recordGatewayPayment(invoiceId, {
      amountMinor,
      currency,
      paidAt: PAID_AT,
      externalReference: reference,
    });
  }

  beforeEach(async () => {
    repo = new RacingRepository();
    service = new BillingService(repo);
    audit = vi.spyOn(console, 'info').mockImplementation(() => {});

    const plan = ok(
      await service.createPlan(
        { name: 'Monthly', amountMinor: 15000, currency: 'BRL', cycle: BillingCycle.MONTHLY, graceDays: 5 },
        ADMIN,
      ),
    );
    const contract = ok(
      await service.signContract(
        {
          userId: STUDENT,
          planId: plan.id,
          dueDay: 10,
          startDate: '2026-01-01',
          termsSource: ContractTermsSource.STANDARD,
        },
        ADMIN,
      ),
    );
    invoiceId = ok(
      await service.issueAdHocInvoice({ subscriptionId: contract.id, referenceDate: '2026-01-15' }, ADMIN),
    ).id;
    repo.inserts = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordGatewayPayment', () => {
    it('lands an ordinary payment row: gateway method, system recorder, the reference, the UTC day', async () => {
      const { payment, created } = ok(await land());

      expect(created).toBe(true);
      expect(payment).toMatchObject({
        invoiceId,
        amountMinor: 15000,
        currency: 'BRL',
        method: PaymentMethod.GATEWAY,
        paidAt: '2026-01-12',
        externalReference: 'mercadopago:pay-1',
        reversesId: null,
        recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
      });
      expect(ok(await service.getInvoice(invoiceId))).toMatchObject({
        status: InvoiceStatus.PAID,
        balanceMinor: 0,
      });
    });

    it('differs from an admin payment of the same amount only in method, recorder and reference', async () => {
      const landed = ok(await land()).payment;

      const twinRepo = new RacingRepository();
      const twinService = new BillingService(twinRepo);
      const plan = ok(
        await twinService.createPlan(
          { name: 'Monthly', amountMinor: 15000, currency: 'BRL', cycle: BillingCycle.MONTHLY, graceDays: 5 },
          ADMIN,
        ),
      );
      const contract = ok(
        await twinService.signContract(
          { userId: STUDENT, planId: plan.id, dueDay: 10, startDate: '2026-01-01', termsSource: ContractTermsSource.STANDARD },
          ADMIN,
        ),
      );
      const twinInvoice = ok(
        await twinService.issueAdHocInvoice({ subscriptionId: contract.id, referenceDate: '2026-01-15' }, ADMIN),
      );
      const typed = ok(
        await twinService.recordPayment(
          twinInvoice.id,
          { amountMinor: 15000, method: PaymentMethod.PIX, paidAt: '2026-01-12' },
          ADMIN,
        ),
      );

      const strip = ({ id: _id, invoiceId: _inv, method: _m, recordedBy: _r, externalReference: _e, ...rest }: PaymentRecord) => rest;
      expect(strip(landed)).toEqual(strip(typed));
      expect(ok(await service.getInvoice(invoiceId)).balanceMinor).toBe(
        ok(await twinService.getInvoice(twinInvoice.id)).balanceMinor,
      );
      expect(ok(await service.getStanding(STUDENT, '2026-02-01')).standing).toBe(
        ok(await twinService.getStanding(STUDENT, '2026-02-01')).standing,
      );
    });

    it('audits payments.gateway_landed by the system actor, with ids only', async () => {
      const { payment } = ok(await land());
      const [line] = events('payments.gateway_landed');
      expect(line).toMatchObject({
        actor: SYSTEM_PAYMENT_ACTOR_ID,
        rail: 'contract',
        userId: STUDENT,
        invoiceId,
        paymentId: payment.id,
      });
      expect(line).not.toHaveProperty('amountMinor');
      expect(line).not.toHaveProperty('externalReference');
      expect(events('billing.record_payment')).toEqual([]);
    });

    it('is idempotent: a second call returns the stored row and writes nothing', async () => {
      const first = ok(await land());
      const second = ok(await land('mercadopago:pay-1', 999));

      expect(second.created).toBe(false);
      expect(second.payment.id).toBe(first.payment.id);
      expect(second.payment.amountMinor).toBe(15000);
      expect(repo.inserts).toBe(1);
      expect(await payments()).toHaveLength(1);
      expect(events('payments.gateway_landed')).toHaveLength(1);
    });

    it('returns the row that won when the unique index refuses a concurrent twin', async () => {
      repo.twin = {
        invoiceId,
        amountMinor: 15000,
        currency: 'BRL',
        method: PaymentMethod.GATEWAY,
        paidAt: '2026-01-12',
        externalReference: 'mercadopago:pay-1',
        note: '',
        reversesId: null,
        recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
      };

      const result = ok(await land());

      expect(result.created).toBe(false);
      expect(await payments()).toEqual([result.payment]);
      expect(events('payments.gateway_landed')).toEqual([]);
    });

    it('refuses a currency other than the invoice currency, writing nothing', async () => {
      expect(await land('mercadopago:pay-1', 15000, 'USD')).toMatchObject({ ok: false, status: 400 });
      expect(await payments()).toEqual([]);
      expect(repo.inserts).toBe(0);
    });

    it('keeps the admin guards: malformed reference, bad date, non-positive amount, unknown and void invoice', async () => {
      for (const reference of ['pay-1', 'paypal:1', 'mercadopago:', '']) {
        expect(await land(reference)).toMatchObject({ ok: false, status: 400 });
      }
      expect(
        await service.recordGatewayPayment(invoiceId, {
          amountMinor: 15000,
          currency: 'BRL',
          paidAt: 'yesterday',
          externalReference: 'mercadopago:pay-1',
        }),
      ).toMatchObject({ ok: false, status: 400 });
      expect(await land('mercadopago:pay-1', 0)).toMatchObject({ ok: false, status: 400 });
      expect(
        await service.recordGatewayPayment('nope', {
          amountMinor: 1,
          currency: 'BRL',
          paidAt: PAID_AT,
          externalReference: 'mercadopago:pay-1',
        }),
      ).toMatchObject({ ok: false, status: 404 });

      ok(await service.voidInvoice(invoiceId, 'Reissued.', ADMIN));
      expect(await land()).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
      expect(await payments()).toEqual([]);
    });

    it('an overpayment lands whole and leaves a credit', async () => {
      const { payment } = ok(await land('mercadopago:pay-1', 20000));
      expect(payment.amountMinor).toBe(20000);
      expect(ok(await service.getInvoice(invoiceId))).toMatchObject({
        status: InvoiceStatus.PAID,
        balanceMinor: -5000,
      });
    });

    it('recomputes standing after a landed payment and after its reversal', async () => {
      expect(await standing()).toBe(BillingStanding.DELINQUENT);

      const { payment } = ok(await land());
      expect(await standing()).toBe(BillingStanding.GOOD);

      ok(
        await service.reverseGatewayPayment(payment.id, {
          externalReference: 'mercadopago:refund-1',
          paidAt: '2026-01-20',
        }),
      );
      expect(await standing()).toBe(BillingStanding.DELINQUENT);
      expect(ok(await service.getInvoice(invoiceId))).toMatchObject({
        status: InvoiceStatus.OPEN,
        balanceMinor: 15000,
      });
    });
  });

  describe('reverseGatewayPayment', () => {
    it('writes the mirror row keyed on the refund id, never on the original reference', async () => {
      const original = ok(await land()).payment;

      const { payment: reversal, created } = ok(
        await service.reverseGatewayPayment(original.id, {
          externalReference: 'mercadopago:refund-1',
          paidAt: '2026-01-20T09:00:00Z',
        }),
      );

      expect(created).toBe(true);
      expect(reversal).toMatchObject({
        invoiceId,
        amountMinor: -15000,
        method: PaymentMethod.GATEWAY,
        paidAt: '2026-01-20',
        externalReference: 'mercadopago:refund-1',
        reversesId: original.id,
        recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
        note: 'provider refund refund-1',
      });
      expect(reversal.externalReference).not.toBe(original.externalReference);
      expect(events('payments.gateway_reversed')[0]).toMatchObject({
        actor: SYSTEM_PAYMENT_ACTOR_ID,
        paymentId: reversal.id,
        reversesId: original.id,
      });
    });

    it('records the admin and the note the refund route passes', async () => {
      const original = ok(await land()).payment;
      const { payment } = ok(
        await service.reverseGatewayPayment(original.id, {
          externalReference: 'mercadopago:refund-1',
          paidAt: '2026-01-20',
          note: ' Duplicate enrolment. ',
          recordedBy: ADMIN,
        }),
      );
      expect(payment).toMatchObject({ recordedBy: ADMIN, note: 'Duplicate enrolment.' });
      expect(events('payments.gateway_reversed')[0]).toMatchObject({ actor: ADMIN });
    });

    it('is idempotent on the refund id, including a refund the notification landed first', async () => {
      const original = ok(await land()).payment;
      const command = { externalReference: 'mercadopago:refund-1', paidAt: '2026-01-20' };

      const first = ok(await service.reverseGatewayPayment(original.id, command));
      const second = ok(await service.reverseGatewayPayment(original.id, command));
      expect(second).toEqual({ payment: first.payment, created: false });
      expect(await payments()).toHaveLength(2);

      // The notification's unlinked row for another refund id wins the race.
      const other = ok(await land('mercadopago:pay-2', 100)).payment;
      repo.twin = {
        invoiceId,
        amountMinor: -100,
        currency: 'BRL',
        method: PaymentMethod.GATEWAY,
        paidAt: '2026-01-21',
        externalReference: 'mercadopago:refund-2',
        note: 'provider refund refund-2',
        reversesId: null,
        recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
      };
      const raced = ok(
        await service.reverseGatewayPayment(other.id, {
          externalReference: 'mercadopago:refund-2',
          paidAt: '2026-01-21',
        }),
      );
      expect(raced.created).toBe(false);
      expect(raced.payment.reversesId).toBeNull();
    });

    it('refuses what is not a full reversal of a known gateway payment', async () => {
      const original = ok(await land()).payment;
      const at = { paidAt: '2026-01-20' };

      // The original's own reference, a malformed one, another provider's.
      expect(
        await service.reverseGatewayPayment(original.id, { externalReference: 'mercadopago:pay-1', ...at }),
      ).toMatchObject({ ok: false, status: 400 });
      expect(
        await service.reverseGatewayPayment(original.id, { externalReference: 'refund-1', ...at }),
      ).toMatchObject({ ok: false, status: 400 });
      expect(
        await service.reverseGatewayPayment(original.id, { externalReference: 'stripe:re_1', ...at }),
      ).toMatchObject({ ok: false, status: 400 });
      expect(
        await service.reverseGatewayPayment('nope', { externalReference: 'mercadopago:refund-1', ...at }),
      ).toMatchObject({ ok: false, status: 404 });

      // An admin-typed payment is not reversed through the gateway.
      const typed = ok(
        await service.recordPayment(invoiceId, { amountMinor: 10, method: PaymentMethod.CASH }, ADMIN),
      );
      expect(
        await service.reverseGatewayPayment(typed.id, { externalReference: 'mercadopago:refund-1', ...at }),
      ).toMatchObject({ ok: false, status: 409 });

      // Once reversed: a second refund id is a conflict, and a reversal is never reversed.
      const reversal = ok(
        await service.reverseGatewayPayment(original.id, { externalReference: 'mercadopago:refund-1', ...at }),
      ).payment;
      expect(
        await service.reverseGatewayPayment(original.id, { externalReference: 'mercadopago:refund-9', ...at }),
      ).toMatchObject({ ok: false, status: 409 });
      expect(
        await service.reverseGatewayPayment(reversal.id, { externalReference: 'mercadopago:refund-9', ...at }),
      ).toMatchObject({ ok: false, status: 409 });
      expect(await payments()).toHaveLength(3);
    });

    it('answers 409 when the one-reversal index refuses a concurrent second refund', async () => {
      const original = ok(await land()).payment;
      repo.failOneReversal = true;
      expect(
        await service.reverseGatewayPayment(original.id, {
          externalReference: 'mercadopago:refund-1',
          paidAt: '2026-01-20',
        }),
      ).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
    });
  });

  describe('recordGatewayRefund', () => {
    it('books a provider-side refund as a negative gateway row with no reversesId', async () => {
      ok(await land());

      const { payment, created } = ok(
        await service.recordGatewayRefund(invoiceId, {
          amountMinor: 4000,
          currency: 'BRL',
          paidAt: '2026-01-25T23:30:00-03:00',
          externalReference: 'mercadopago:refund-7',
        }),
      );

      expect(created).toBe(true);
      expect(payment).toMatchObject({
        amountMinor: -4000,
        method: PaymentMethod.GATEWAY,
        paidAt: '2026-01-26',
        externalReference: 'mercadopago:refund-7',
        reversesId: null,
        recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
        note: 'provider refund refund-7',
      });
      expect(ok(await service.getInvoice(invoiceId))).toMatchObject({
        status: InvoiceStatus.OPEN,
        balanceMinor: 4000,
      });
      expect(events('payments.gateway_refund_landed')[0]).toMatchObject({
        actor: SYSTEM_PAYMENT_ACTOR_ID,
        kind: 'refund',
        invoiceId,
        paymentId: payment.id,
      });
    });

    it('names a lost dispute in the note', async () => {
      ok(await land());
      const { payment } = ok(
        await service.recordGatewayRefund(invoiceId, {
          amountMinor: 15000,
          currency: 'BRL',
          paidAt: '2026-01-25',
          externalReference: 'mercadopago:dispute-3',
          kind: 'dispute',
        }),
      );
      expect(payment).toMatchObject({ amountMinor: -15000, reversesId: null, note: 'provider dispute dispute-3' });
    });

    it('is idempotent, also when a twin wins the insert', async () => {
      ok(await land());
      const command = {
        amountMinor: 4000,
        currency: 'BRL',
        paidAt: '2026-01-25',
        externalReference: 'mercadopago:refund-7',
      };
      const first = ok(await service.recordGatewayRefund(invoiceId, command));
      const second = ok(await service.recordGatewayRefund(invoiceId, command));
      expect(second).toEqual({ payment: first.payment, created: false });

      repo.twin = {
        invoiceId,
        amountMinor: -100,
        currency: 'BRL',
        method: PaymentMethod.GATEWAY,
        paidAt: '2026-01-26',
        externalReference: 'mercadopago:refund-8',
        note: 'provider refund refund-8',
        reversesId: null,
        recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
      };
      const raced = ok(
        await service.recordGatewayRefund(invoiceId, { ...command, amountMinor: 100, externalReference: 'mercadopago:refund-8' }),
      );
      expect(raced.created).toBe(false);
      expect(await payments()).toHaveLength(3);
    });

    it('refuses a foreign currency, a non-positive amount, a malformed reference and an unknown invoice', async () => {
      const base = { amountMinor: 100, currency: 'BRL', paidAt: '2026-01-25', externalReference: 'mercadopago:refund-7' };
      expect(await service.recordGatewayRefund(invoiceId, { ...base, currency: 'USD' })).toMatchObject({ ok: false, status: 400 });
      expect(await service.recordGatewayRefund(invoiceId, { ...base, amountMinor: -100 })).toMatchObject({ ok: false, status: 400 });
      expect(await service.recordGatewayRefund(invoiceId, { ...base, externalReference: 'refund-7' })).toMatchObject({ ok: false, status: 400 });
      expect(await service.recordGatewayRefund('nope', base)).toMatchObject({ ok: false, status: 404 });
      expect(await payments()).toEqual([]);
    });
  });

  describe('the admin payment form with method = gateway', () => {
    it('400s a reference that is not <known provider>:<id>', async () => {
      for (const externalReference of [undefined, null, 'receipt 12', 'paypal:1', 'stripe:']) {
        expect(
          await service.recordPayment(
            invoiceId,
            { amountMinor: 100, method: PaymentMethod.GATEWAY, externalReference },
            ADMIN,
          ),
        ).toMatchObject({ ok: false, status: 400, error: 'ValidationError' });
      }
      expect(await payments()).toEqual([]);
    });

    it('records a well-formed one under the admin, and 409s its duplicate with the existing id', async () => {
      const command = { amountMinor: 100, method: PaymentMethod.GATEWAY, externalReference: 'stripe:pi_1' };
      const first = ok(await service.recordPayment(invoiceId, command, ADMIN));
      expect(first).toMatchObject({ method: PaymentMethod.GATEWAY, recordedBy: ADMIN });
      expect(events('billing.record_payment')).toHaveLength(1);

      expect(await service.recordPayment(invoiceId, command, ADMIN)).toEqual({
        ok: false,
        status: 409,
        error: PAYMENT_REFERENCE_EXISTS,
        meta: expect.objectContaining({ paymentId: first.id }),
      });
      // A reference the gateway already landed is a duplicate too.
      const landed = ok(await land('mercadopago:pay-1', 100)).payment;
      expect(
        await service.recordPayment(invoiceId, { ...command, externalReference: 'mercadopago:pay-1' }, ADMIN),
      ).toMatchObject({ status: 409, error: PAYMENT_REFERENCE_EXISTS, meta: { paymentId: landed.id } });
      expect(await payments()).toHaveLength(2);
    });

    it('409s when the unique index refuses a concurrent twin', async () => {
      repo.twin = {
        invoiceId,
        amountMinor: 100,
        currency: 'BRL',
        method: PaymentMethod.GATEWAY,
        paidAt: '2026-01-12',
        externalReference: 'stripe:pi_1',
        note: '',
        reversesId: null,
        recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
      };
      const result = await service.recordPayment(
        invoiceId,
        { amountMinor: 100, method: PaymentMethod.GATEWAY, externalReference: 'stripe:pi_1' },
        ADMIN,
      );
      expect(result).toMatchObject({ ok: false, status: 409, error: PAYMENT_REFERENCE_EXISTS });
      expect((await payments())[0].id).toBe((result as { meta: { paymentId: string } }).meta.paymentId);
    });

    it('leaves a free-form reference on any other method alone, repeats included', async () => {
      const command = { amountMinor: 100, method: PaymentMethod.PIX, externalReference: 'receipt 12' };
      ok(await service.recordPayment(invoiceId, command, ADMIN));
      ok(await service.recordPayment(invoiceId, command, ADMIN));
      expect(await payments()).toHaveLength(2);
    });
  });
});
