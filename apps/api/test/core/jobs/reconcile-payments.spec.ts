import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IJobRunRepository, StartJobRunParams, FinishJobRunParams } from '@arenaquest/shared/ports';
import type {
  GatewayCheckoutRecord,
  GatewayEventRecord,
  GatewayExceptionRecord,
  IGatewayRepository,
} from '@arenaquest/shared/ports/i-gateway-repository';
import type { ProviderEvent } from '@arenaquest/shared/ports/i-payment-gateway';
import { Entities } from '@arenaquest/shared/types/entities';
import {
  RECONCILE_CHECKOUT_SCAN,
  RECONCILE_MAX_CHECKOUTS,
  RECONCILE_MAX_EVENTS,
  RECONCILE_PROVIDER_TIMEOUT_MS,
  isPaymentsOff,
  reconcilePayments,
  reconcilePaymentsOutcome,
  runReconcilePayments,
  type ReconcilePaymentsDeps,
} from '@api/jobs/reconcile-payments';
import {
  GatewayService,
  formatExceptionRef,
  parseExceptionRef,
  type ConfirmCheckoutOutcome,
  type ConfirmCheckoutOptions,
  type GatewayContractLedger,
  type GatewayExtrasLedger,
  type GatewayHandleOutcome,
} from '@api/core/payments/gateway-service';
import { buildPaymentsWiring } from '@api/core/payments/gateway-registry';
import {
  StubGatewayAdapter,
  stubGatewayFactories,
  stubPaymentsEnv,
  stubSecretKey,
} from '../../adapters/payment/stub-gateway-adapter';
import { MercadoPagoGatewayAdapter } from '@api/adapters/payment/mercadopago-gateway-adapter';
import {
  MP_FIXTURE_ACCESS_TOKEN,
  MP_FIXTURE_WEBHOOK_SECRET,
  mpFakeProvider,
  mpReply,
} from '../../fixtures/mercadopago';

/**
 * The reconcile run's own rules, against doubles (RFC 0026 section 6; M30
 * Task 09): the caps, what is deferred, what fails a run, "off means silent"
 * and the one `job_runs` row. What a checkout or an event *becomes* is the
 * gateway service's business and is asserted on a real D1 in
 * `test/routes/admin-billing.router.spec.ts`, through the manual route.
 */

const { CheckoutStatus, GatewayEventOutcome, JobName, JobTrigger, JobRunStatus } = Entities.Config;

const NOW = new Date('2026-11-26T12:00:00.000Z');

function checkout(id: string, overrides: Partial<GatewayCheckoutRecord> = {}): GatewayCheckoutRecord {
  return {
    id,
    provider: 'mercadopago',
    receivableKind: 'invoice',
    receivableId: `invoice-${id}`,
    userId: 'student-1',
    createdBy: 'student-1',
    amountMinor: 15000,
    currency: 'BRL',
    status: CheckoutStatus.OPEN,
    providerSessionId: `session-${id}`,
    providerPaymentId: null,
    invoicePaymentId: null,
    chargePaymentId: null,
    paidMethod: null,
    paidMethodLabel: null,
    checkoutUrl: 'https://pay.invalid/x',
    expiresAt: '2026-11-27T00:00:00.000Z',
    createdAt: '2026-11-26T10:00:00.000Z',
    updatedAt: '2026-11-26T10:00:00.000Z',
    closedAt: null,
    lastCheckedAt: null,
    failureDetail: null,
    dismissedAt: null,
    dismissedBy: null,
    dismissNote: null,
    ...overrides,
  };
}

function eventRecord(eventId: string, overrides: Partial<GatewayEventRecord> = {}): GatewayEventRecord {
  return {
    provider: 'mercadopago',
    eventId,
    type: 'payment',
    providerPaymentId: `pay-${eventId}`,
    checkoutId: null,
    receivedAt: '2026-11-26T10:00:00.000Z',
    processedAt: null,
    outcome: GatewayEventOutcome.FAILED,
    attempts: 1,
    error: 'processing failed (Error)',
    dismissedAt: null,
    dismissedBy: null,
    dismissNote: null,
    ...overrides,
  };
}

/** A valid configuration with one stub bound — "on". */
function boundWiring() {
  const mp = new StubGatewayAdapter('mercadopago');
  return buildPaymentsWiring(stubPaymentsEnv('mercadopago:pix+card'), stubGatewayFactories(mp));
}

interface World {
  deps: ReconcilePaymentsDeps;
  /** Ids `confirmCheckout` was called with, with the `ask` it was given. */
  confirmed: Array<{ id: string; ask: boolean | undefined; timeoutMs: number | undefined }>;
  handled: Array<{ event: ProviderEvent; timeoutMs: number | undefined }>;
  repoCalls: string[];
}

function world(input: {
  checkouts?: GatewayCheckoutRecord[];
  checkoutTotal?: number;
  /** What asking about a checkout comes to; a no-call outcome is answered whatever `ask` says. */
  outcomeOf?: (row: GatewayCheckoutRecord) => ConfirmCheckoutOutcome;
  events?: GatewayEventRecord[];
  eventTotal?: number;
  eventOutcome?: (event: ProviderEvent) => GatewayHandleOutcome;
  exceptions?: GatewayExceptionRecord[];
  wiring?: ReturnType<typeof buildPaymentsWiring>;
}): World {
  const wiring = input.wiring ?? boundWiring();
  const confirmed: World['confirmed'] = [];
  const handled: World['handled'] = [];
  const repoCalls: string[] = [];
  const NO_CALL: ReadonlySet<ConfirmCheckoutOutcome> = new Set(['abandoned', 'unreachable']);

  const gatewayRepo: ReconcilePaymentsDeps['gatewayRepo'] = {
    listCheckoutsToConfirm: async (limit) => {
      repoCalls.push(`listCheckoutsToConfirm(${limit})`);
      const items = (input.checkouts ?? []).slice(0, limit);
      return { items, total: input.checkoutTotal ?? (input.checkouts ?? []).length };
    },
    listUnsettledEvents: async (limit) => {
      repoCalls.push(`listUnsettledEvents(${limit})`);
      const items = (input.events ?? []).slice(0, limit);
      return { items, total: input.eventTotal ?? (input.events ?? []).length };
    },
    listExceptions: async () => {
      repoCalls.push('listExceptions');
      return input.exceptions ?? [];
    },
  };

  const gatewayService: ReconcilePaymentsDeps['gatewayService'] = {
    confirmCheckout: async (row: GatewayCheckoutRecord, options: ConfirmCheckoutOptions = {}) => {
      confirmed.push({ id: row.id, ask: options.ask, timeoutMs: options.timeoutMs });
      const outcome = input.outcomeOf?.(row) ?? 'open';
      if (NO_CALL.has(outcome)) return { outcome, asked: false };
      if (options.ask === false) return { outcome: 'deferred', asked: false };
      return { outcome, asked: true };
    },
    handleEvent: async (provider, event, options = {}) => {
      handled.push({ event, timeoutMs: options.timeoutMs });
      return {
        outcome: input.eventOutcome?.(event) ?? 'applied',
        provider,
        eventId: event.eventId,
        checkoutId: null,
        providerPaymentId: event.kind === 'ignored' ? null : event.paymentId,
      };
    },
  };

  return {
    deps: { config: wiring.config, gateways: wiring.gateways, gatewayRepo, gatewayService, now: () => NOW },
    confirmed,
    handled,
    repoCalls,
  };
}

type FakeJobRuns = IJobRunRepository & {
  starts: StartJobRunParams[];
  finishes: Array<[string, FinishJobRunParams]>;
};

function fakeJobRuns(): FakeJobRuns {
  const starts: StartJobRunParams[] = [];
  const finishes: Array<[string, FinishJobRunParams]> = [];
  return {
    starts,
    finishes,
    start: async (params) => {
      starts.push(params);
      return {
        id: 'run-1',
        job: params.job,
        trigger: params.trigger,
        status: JobRunStatus.RUNNING,
        actorId: params.actorId ?? null,
        startedAt: NOW.toISOString(),
        finishedAt: null,
        durationMs: null,
        summary: null,
        error: null,
      };
    },
    finish: async (id, params) => {
      finishes.push([id, params]);
    },
    list: async () => [],
    latestPerJob: async () => [],
    pruneOlderThan: async () => 0,
    databaseProbe: async () => ({ latestMigration: null }),
  };
}

async function ran(deps: ReconcilePaymentsDeps) {
  const report = await reconcilePayments(deps);
  if (!report.ran) throw new Error('the run was expected to run');
  return report;
}

afterEach(() => vi.restoreAllMocks());

describe('reconcilePayments — the caps are constants', () => {
  it('25 checkouts, 10 events, 10 seconds: 35 provider calls at worst', () => {
    expect(RECONCILE_MAX_CHECKOUTS).toBe(25);
    expect(RECONCILE_MAX_EVENTS).toBe(10);
    expect(RECONCILE_PROVIDER_TIMEOUT_MS).toBe(10_000);
    expect(RECONCILE_MAX_CHECKOUTS + RECONCILE_MAX_EVENTS).toBe(35);
    expect(RECONCILE_CHECKOUT_SCAN).toBeGreaterThan(RECONCILE_MAX_CHECKOUTS);
  });
});

describe('reconcilePayments — off means silent', () => {
  it('returns before its first query when no provider is bound, and records no job run', async () => {
    const off = buildPaymentsWiring({ PAYMENTS_PROVIDERS: 'none' }, {});
    const w = world({ wiring: off, checkouts: [checkout('c1')] });
    const jobRuns = fakeJobRuns();

    expect(isPaymentsOff(w.deps)).toBe(true);
    expect(await reconcilePayments(w.deps)).toEqual({ ran: false });
    expect(await runReconcilePayments({ ...w.deps, jobRuns }, { trigger: JobTrigger.CRON })).toEqual({ ran: false });

    expect(w.repoCalls).toEqual([]);
    expect(w.confirmed).toEqual([]);
    expect(jobRuns.starts).toEqual([]);
    expect(jobRuns.finishes).toEqual([]);
  });

  it('treats an absent PAYMENTS_PROVIDERS exactly like none', async () => {
    const w = world({ wiring: buildPaymentsWiring({}, {}) });
    expect(await reconcilePayments(w.deps)).toEqual({ ran: false });
    expect(w.repoCalls).toEqual([]);
  });
});

describe('reconcilePayments — step 1, checkouts', () => {
  it('asks about at most 25 and counts the rest as deferred, in the order the store gave', async () => {
    const due = Array.from({ length: 30 }, (_, i) => checkout(`c${i + 1}`));
    const w = world({ checkouts: due });

    const report = await ran(w.deps);

    expect(w.repoCalls[0]).toBe(`listCheckoutsToConfirm(${RECONCILE_CHECKOUT_SCAN})`);
    expect(w.confirmed.filter((c) => c.ask).map((c) => c.id)).toEqual(due.slice(0, 25).map((c) => c.id));
    expect(w.confirmed.filter((c) => c.ask === false).map((c) => c.id)).toEqual(due.slice(25).map((c) => c.id));
    expect(w.confirmed.every((c) => c.timeoutMs === RECONCILE_PROVIDER_TIMEOUT_MS)).toBe(true);
    expect(report.summary).toMatchObject({
      checkoutsDue: 30,
      checkoutsAsked: 25,
      stillOpen: 25,
      checkoutsDeferred: 5,
    });
    expect(report.status).toBe('ok');
  });

  it('counts rows beyond the scan window as deferred too', async () => {
    const w = world({ checkouts: [checkout('c1')], checkoutTotal: 140 });
    const report = await ran(w.deps);
    expect(report.summary).toMatchObject({ checkoutsDue: 140, checkoutsAsked: 1, checkoutsDeferred: 139 });
  });

  it('handles the two no-call cases without spending the cap, even after it is spent', async () => {
    const askable = Array.from({ length: 26 }, (_, i) => checkout(`c${i + 1}`));
    const sessionless = checkout('lost', { providerSessionId: null });
    const due = [...askable, sessionless];
    const w = world({ checkouts: due, outcomeOf: (row) => (row.id === 'lost' ? 'abandoned' : 'open') });

    const report = await ran(w.deps);

    expect(report.summary).toMatchObject({
      checkoutsDue: 27,
      checkoutsAsked: 25,
      abandoned: 1,
      checkoutsDeferred: 1,
    });
    expect(report.status).toBe('ok');
  });

  it('sorts every outcome into its own count', async () => {
    const outcomes: Record<string, ConfirmCheckoutOutcome> = {
      a: 'landed',
      b: 'expired',
      c: 'open',
      d: 'mismatch',
      e: 'error',
      f: 'closed',
      g: 'landed',
    };
    const w = world({
      checkouts: Object.keys(outcomes).map((id) => checkout(id)),
      outcomeOf: (row) => outcomes[row.id],
    });

    const report = await ran(w.deps);

    expect(report.summary).toMatchObject({
      checkoutsDue: 7,
      checkoutsAsked: 7,
      landed: 2,
      expired: 1,
      stillOpen: 1,
      mismatched: 1,
      checkoutErrors: 1,
      checkoutsDeferred: 0,
    });
    expect(report).toMatchObject({ status: 'ok', error: null });
  });

  it('a checkout on an unbound provider fails the run, and the rest of the run still happens', async () => {
    const w = world({
      checkouts: [checkout('gone', { provider: 'stripe' }), checkout('c1')],
      outcomeOf: (row) => (row.id === 'gone' ? 'unreachable' : 'landed'),
      events: [eventRecord('evt-1')],
    });

    const report = await ran(w.deps);

    expect(report.status).toBe('failed');
    expect(report.configInvalid).toBe(false);
    expect(report.error).toMatch(/^1 checkout\(s\) on a provider that is no longer bound/);
    expect(report.summary).toMatchObject({ unreachable: 1, landed: 1, checkoutsAsked: 1, eventsRetried: 1 });
  });
});

describe('reconcilePayments — step 2, events', () => {
  it('retries at most 10 through handleEvent and defers the rest', async () => {
    const events = Array.from({ length: 10 }, (_, i) => eventRecord(`evt-${i + 1}`));
    const w = world({
      events,
      eventTotal: 14,
      eventOutcome: (event) => (event.eventId === 'evt-3' ? 'failed' : 'applied'),
    });

    const report = await ran(w.deps);

    expect(w.repoCalls).toContain(`listUnsettledEvents(${RECONCILE_MAX_EVENTS})`);
    expect(w.handled.map((h) => h.event.eventId)).toEqual(events.map((e) => e.eventId));
    expect(w.handled.every((h) => h.timeoutMs === RECONCILE_PROVIDER_TIMEOUT_MS)).toBe(true);
    expect(report.summary).toMatchObject({
      eventsDue: 14,
      eventsRetried: 10,
      eventsSettled: 9,
      eventsFailed: 1,
      eventsDeferred: 4,
    });
  });

  it('replays a stored row as the event it stood for, and settles one that names no payment as ignored', async () => {
    const w = world({
      events: [
        eventRecord('evt-pay'),
        eventRecord('evt-dispute', { type: 'dispute.lost' }),
        eventRecord('evt-odd', { type: 'merchant_order', providerPaymentId: null, outcome: GatewayEventOutcome.RECEIVED }),
      ],
    });

    await ran(w.deps);

    expect(w.handled.map((h) => h.event)).toEqual([
      { kind: 'payment', eventId: 'evt-pay', paymentId: 'pay-evt-pay', occurredAt: '2026-11-26T10:00:00.000Z' },
      {
        kind: 'dispute',
        outcome: 'lost',
        eventId: 'evt-dispute',
        paymentId: 'pay-evt-dispute',
        occurredAt: '2026-11-26T10:00:00.000Z',
      },
      { kind: 'ignored', eventId: 'evt-odd', type: 'merchant_order' },
    ]);
  });

  it('a whole run never asks for more than 35 provider calls', async () => {
    const w = world({
      checkouts: Array.from({ length: 80 }, (_, i) => checkout(`c${i + 1}`)),
      checkoutTotal: 300,
      events: Array.from({ length: 40 }, (_, i) => eventRecord(`evt-${i + 1}`)),
    });

    const report = await ran(w.deps);

    const calls = w.confirmed.filter((c) => c.ask).length + w.handled.length;
    expect(calls).toBe(35);
    expect(report.summary).toMatchObject({ checkoutsAsked: 25, checkoutsDeferred: 275, eventsRetried: 10, eventsDeferred: 30 });
  });
});

describe('reconcilePayments — step 3, stale exceptions', () => {
  const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

  it('counts orphan and mismatch rows older than 7 days, a webhook mismatch once', async () => {
    const mismatched = checkout('mm', { status: CheckoutStatus.MISMATCH });
    const lonelyMismatch = checkout('mm-2', { status: CheckoutStatus.MISMATCH });
    const disputed = checkout('disp', { status: CheckoutStatus.PAID, failureDetail: 'dispute opened' });
    const w = world({
      exceptions: [
        { kind: 'event', event: eventRecord('o-old', { outcome: GatewayEventOutcome.ORPHAN }), checkout: null, occurredAt: days(8) },
        { kind: 'event', event: eventRecord('o-new', { outcome: GatewayEventOutcome.ORPHAN }), checkout: null, occurredAt: days(6) },
        { kind: 'event', event: eventRecord('m-old', { outcome: GatewayEventOutcome.MISMATCH }), checkout: mismatched, occurredAt: days(9) },
        { kind: 'checkout', checkout: mismatched, occurredAt: days(9) },
        { kind: 'checkout', checkout: lonelyMismatch, occurredAt: days(10) },
        { kind: 'checkout', checkout: disputed, occurredAt: days(30) },
        { kind: 'event', event: eventRecord('f-old', { outcome: GatewayEventOutcome.FAILED }), checkout: null, occurredAt: days(30) },
      ],
    });

    const report = await ran(w.deps);

    expect(report.summary).toMatchObject({ staleOrphans: 1, staleMismatches: 2 });
    // A report, not a failure: stale rows never fail the run.
    expect(report.status).toBe('ok');
  });
});

// M30 Task 17 — milestone decision 19 as rewritten: the key mode is declared by
// the integrator and reported by the run. Nothing compares it with a key.
describe('reconcilePayments — step 4, the key mode is reported, not asserted', () => {
  it.each(['test', 'live'] as const)('reports the declared mode %s and runs, whatever the key looks like', async (mode) => {
    const mp = new StubGatewayAdapter('mercadopago');
    for (const key of ['APP_USR-fixture-key', 'TEST-fixture-key', 'opaque']) {
      const wiring = buildPaymentsWiring(
        { ...stubPaymentsEnv('mercadopago:pix', mode), PAYMENTS_MERCADOPAGO_SECRET_KEY: key },
        stubGatewayFactories(mp),
      );
      const w = world({ wiring, checkouts: [checkout('c1')] });

      const report = await ran(w.deps);

      expect(report).toMatchObject({ status: 'ok', configInvalid: false, keyMode: mode });
      expect(w.confirmed.map((c) => c.id)).toEqual(['c1']);
      expect(JSON.stringify(report)).not.toContain(key);
    }
  });

  it('an invalid PAYMENTS_KEY_MODE value fails the run with PAYMENTS_CONFIG_INVALID and touches nothing', async () => {
    const mp = new StubGatewayAdapter('mercadopago');
    const wiring = buildPaymentsWiring(
      { ...stubPaymentsEnv('mercadopago:pix'), PAYMENTS_KEY_MODE: 'banana' },
      stubGatewayFactories(mp),
    );
    const w = world({ wiring, checkouts: [checkout('c1')], events: [eventRecord('evt-1')] });

    expect(isPaymentsOff(w.deps)).toBe(false);
    const report = await ran(w.deps);

    expect(report.status).toBe('failed');
    expect(report.configInvalid).toBe(true);
    expect(report.keyMode).toBeNull();
    expect(report.error).toMatch(/^PAYMENTS_CONFIG_INVALID: invalid_key_mode/);
    expect(report.error).not.toContain(stubSecretKey('mercadopago'));
    // No step ran: an empty registry would otherwise expire every open checkout as unreachable.
    expect(w.repoCalls).toEqual([]);
    expect(w.confirmed).toEqual([]);
    expect(w.handled).toEqual([]);
  });
});

// M30 Task 17 — decision 17's "35 calls worst case" holds for the real adapter:
// one search by reference per checkout, never a preference read before it.
describe('reconcilePayments — one provider call per checkout with the Mercado Pago adapter', () => {
  function mercadoPagoWorld(count: number) {
    const rows = Array.from({ length: count }, (_, i) =>
      checkout(`0f6b1c2e-5a4d-4e8b-9c1a-${String(i).padStart(12, '0')}`, {
        providerSessionId: `1000000001-00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      }),
    );
    const provider = mpFakeProvider();
    for (const row of rows) {
      provider.on('GET', `/v1/payments/search?external_reference=${row.id}`, mpReply(200, 'search-empty'));
    }
    const adapter = new MercadoPagoGatewayAdapter({
      secretKey: MP_FIXTURE_ACCESS_TOKEN,
      webhookSecret: MP_FIXTURE_WEBHOOK_SECRET,
      fetch: provider.fetch,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const repo = {
      getCheckout: vi.fn(async (id: string) => byId.get(id) ?? null),
      closeCheckout: vi.fn(async () => null),
      markChecked: vi.fn(async () => {}),
    };
    const gatewayService = new GatewayService({
      gateways: { get: (name) => (name === 'mercadopago' ? adapter : null) },
      gatewayRepo: repo as unknown as IGatewayRepository,
      billing: {} as GatewayContractLedger,
      charges: {} as GatewayExtrasLedger,
      now: () => NOW,
    });
    const w = world({ checkouts: rows });
    return { provider, rows, deps: { ...w.deps, gatewayService } satisfies ReconcilePaymentsDeps };
  }

  it('25 due checkouts are 25 provider calls, each a search on the checkout id', async () => {
    const { provider, rows, deps } = mercadoPagoWorld(25);

    const report = await ran(deps);

    expect(report.summary).toMatchObject({ checkoutsDue: 25, checkoutsAsked: 25, stillOpen: 25, checkoutsDeferred: 0 });
    expect(provider.calls).toHaveLength(25);
    expect(provider.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
      rows.map((row) => `GET /v1/payments/search?external_reference=${row.id}`),
    );
    expect(provider.calls.some((c) => c.path.startsWith('/checkout/preferences'))).toBe(false);
  });

  it('30 due checkouts are still 25 calls: the cap counts provider calls one for one', async () => {
    const { provider, deps } = mercadoPagoWorld(30);

    const report = await ran(deps);

    expect(report.summary).toMatchObject({ checkoutsDue: 30, checkoutsAsked: 25, checkoutsDeferred: 5 });
    expect(provider.calls).toHaveLength(RECONCILE_MAX_CHECKOUTS);
  });
});

describe('runReconcilePayments — one job_runs row per run', () => {
  it('records an ok run with counts only', async () => {
    const w = world({ checkouts: [checkout('c1')], outcomeOf: () => 'landed', events: [eventRecord('evt-1')] });
    const jobRuns = fakeJobRuns();

    const report = await runReconcilePayments({ ...w.deps, jobRuns }, { trigger: JobTrigger.MANUAL, actorId: 'admin-1' });

    expect(report).toMatchObject({ ran: true, status: 'ok' });
    expect(jobRuns.starts).toEqual([{ job: JobName.RECONCILE_PAYMENTS, trigger: JobTrigger.MANUAL, actorId: 'admin-1' }]);
    expect(jobRuns.finishes).toHaveLength(1);
    const [, finish] = jobRuns.finishes[0];
    expect(finish.status).toBe(JobRunStatus.OK);
    expect(finish.summary).toMatchObject({ checkoutsAsked: 1, landed: 1, eventsRetried: 1, eventsSettled: 1 });
    // The declared key mode rides the counts as a flag: 0 = test, 1 = live.
    expect(finish.summary).toMatchObject({ keyModeLive: 0 });
    for (const value of Object.values(finish.summary ?? {})) expect(Number.isInteger(value)).toBe(true);
    expect(finish.error ?? null).toBeNull();
  });

  it('records a failed run with its counts and its error', async () => {
    const w = world({ checkouts: [checkout('gone')], outcomeOf: () => 'unreachable' });
    const jobRuns = fakeJobRuns();

    await runReconcilePayments({ ...w.deps, jobRuns }, { trigger: JobTrigger.CRON });

    expect(jobRuns.starts).toEqual([{ job: JobName.RECONCILE_PAYMENTS, trigger: JobTrigger.CRON, actorId: null }]);
    const [, finish] = jobRuns.finishes[0];
    expect(finish.status).toBe(JobRunStatus.FAILED);
    expect(finish.summary).toMatchObject({ unreachable: 1 });
    expect(finish.error).toMatch(/no longer bound/);
  });

  it('a store that throws is a failed row and is rethrown', async () => {
    const w = world({});
    w.deps.gatewayRepo.listCheckoutsToConfirm = async () => {
      throw new Error('D1_ERROR: unavailable');
    };
    const jobRuns = fakeJobRuns();

    await expect(runReconcilePayments({ ...w.deps, jobRuns }, { trigger: JobTrigger.CRON })).rejects.toThrow('D1_ERROR');
    expect(jobRuns.finishes[0][1]).toMatchObject({ status: JobRunStatus.FAILED, error: 'D1_ERROR: unavailable' });
  });

  it('the outcome mapper never puts anything but numbers in the summary', () => {
    const outcome = reconcilePaymentsOutcome({
      ran: true,
      status: 'failed',
      error: 'PAYMENTS_CONFIG_INVALID: invalid_key_mode (x)',
      configInvalid: true,
      keyMode: null,
      summary: {
        checkoutsDue: 0, checkoutsAsked: 0, landed: 0, expired: 0, stillOpen: 0, abandoned: 0, unreachable: 0,
        mismatched: 0, checkoutErrors: 0, checkoutsDeferred: 0, eventsDue: 0, eventsRetried: 0, eventsSettled: 0,
        eventsFailed: 0, eventsDeferred: 0, staleOrphans: 0, staleMismatches: 0,
      },
    });
    expect(outcome.status).toBe(JobRunStatus.FAILED);
    expect(Object.keys(outcome.summary ?? {})).toHaveLength(17);
  });
});

describe('GatewayService.confirmCheckout — the provider call is bounded', () => {
  function service(gateway: StubGatewayAdapter | null) {
    const repo = {
      getCheckout: vi.fn(async () => null),
      closeCheckout: vi.fn(async () => null),
      markChecked: vi.fn(async () => {}),
    };
    const gatewayService = new GatewayService({
      gateways: { get: () => gateway },
      gatewayRepo: repo as unknown as IGatewayRepository,
      billing: {} as GatewayContractLedger,
      charges: {} as GatewayExtrasLedger,
      now: () => NOW,
    });
    return { repo, gatewayService };
  }

  it('a provider that never answers is an error after the timeout, and an open checkout rotates', async () => {
    const mp = new StubGatewayAdapter('mercadopago');
    mp.findPaymentsForCheckout = () => new Promise(() => {});
    const { repo, gatewayService } = service(mp);

    const result = await gatewayService.confirmCheckout(checkout('c1'), { timeoutMs: 20 });

    expect(result).toEqual({ outcome: 'error', asked: true });
    expect(repo.markChecked).toHaveBeenCalledWith('c1');
    expect(repo.closeCheckout).not.toHaveBeenCalled();
  });

  it('a closed checkout whose final ask failed keeps its claim to it', async () => {
    const mp = new StubGatewayAdapter('mercadopago').failLookups(new Error('provider 503'));
    const { repo, gatewayService } = service(mp);

    const result = await gatewayService.confirmCheckout(
      checkout('c1', { status: CheckoutStatus.EXPIRED, closedAt: '2026-11-26T11:00:00.000Z' }),
    );

    expect(result).toEqual({ outcome: 'error', asked: true });
    expect(repo.markChecked).not.toHaveBeenCalled();
  });

  it('answers deferred, untouched, when the caller cannot afford the call', async () => {
    const mp = new StubGatewayAdapter('mercadopago');
    const { repo, gatewayService } = service(mp);

    expect(await gatewayService.confirmCheckout(checkout('c1'), { ask: false })).toEqual({ outcome: 'deferred', asked: false });
    expect(mp.calls).toEqual([]);
    expect(repo.markChecked).not.toHaveBeenCalled();
  });

  it('a young session-less checkout is left alone; an old one is closed failed with no call', async () => {
    const mp = new StubGatewayAdapter('mercadopago');
    const { repo, gatewayService } = service(mp);

    const young = checkout('young', { providerSessionId: null, createdAt: '2026-11-26T11:45:00.000Z' });
    expect(await gatewayService.confirmCheckout(young)).toEqual({ outcome: 'open', asked: false });
    expect(repo.closeCheckout).not.toHaveBeenCalled();

    const old = checkout('old', { providerSessionId: null, createdAt: '2026-11-26T11:00:00.000Z' });
    expect(await gatewayService.confirmCheckout(old)).toEqual({ outcome: 'abandoned', asked: false });
    expect(repo.closeCheckout).toHaveBeenCalledWith('old', expect.objectContaining({ status: CheckoutStatus.FAILED }));
    expect(mp.calls).toEqual([]);
  });
});

describe('exception refs', () => {
  it('round-trips both kinds, including an event id that contains a colon', () => {
    const event = { kind: 'event', provider: 'mercadopago', eventId: 'payment.updated:123:456' } as const;
    const ck = { kind: 'checkout', checkoutId: '0b0e4a5e-1111-4222-8333-444455556666' } as const;

    expect(formatExceptionRef(event)).toBe('event:mercadopago:payment.updated:123:456');
    expect(formatExceptionRef(ck)).toBe('checkout:0b0e4a5e-1111-4222-8333-444455556666');
    expect(parseExceptionRef(formatExceptionRef(event))).toEqual(event);
    expect(parseExceptionRef(formatExceptionRef(ck))).toEqual(ck);
  });

  it('refuses anything it would not have produced', () => {
    for (const ref of ['', 'checkout:', 'event:', 'event:mercadopago', 'event:mercadopago:', 'event:paypal:1', 'invoice:1', 'x']) {
      expect(parseExceptionRef(ref)).toBeNull();
    }
  });
});
