import type { IJobRunRepository, FinishJobRunParams } from '@arenaquest/shared/ports';
import type { IGatewayRepository } from '@arenaquest/shared/ports/i-gateway-repository';
import type { ProviderEvent } from '@arenaquest/shared/ports/i-payment-gateway';
import { Entities } from '@arenaquest/shared/types/entities';
import {
  PAYMENTS_CONFIG_INVALID,
  type PaymentsConfigResult,
  type PaymentsKeyMode,
} from '@api/core/payments/config';
import type { GatewayRegistry } from '@api/core/payments/gateway-registry';
import { eventFromRecord, type GatewayService } from '@api/core/payments/gateway-service';
import { recordJobRun } from '@api/jobs/record-job-run';

/**
 * `reconcile-payments` — the recovery path of RFC 0026 §6.
 *
 * Hourly, on its own Cron Trigger, and on demand through
 * `POST /v1/admin/billing/payments/reconcile`: one routine, two callers. It
 * asks the provider about checkouts whose webhook may never have arrived,
 * retries unsettled events, counts stale exceptions and reports the key mode
 * the integrator declared. Every step is bounded and what does not fit is
 * counted and left for the next run.
 *
 * It lands nothing itself: a checkout goes through
 * `GatewayService.confirmCheckout` and an event through
 * `GatewayService.handleEvent` — the webhook's own landing.
 */

// The caps are constants, not configuration (milestone 30, decision 17): 35
// provider calls at worst — one search by reference per checkout, one read per
// event — one at a time, which fits Workers Free's 50 subrequests per
// invocation. A tenant that outgrows them shows it in
// `checkoutsDeferred` / `eventsDeferred`; raising one is a one-line change
// made with the platform limits in view.

/** Checkouts asked about per run — one provider search each. */
export const RECONCILE_MAX_CHECKOUTS = 25;
/** Unsettled events retried per run — one provider read each. */
export const RECONCILE_MAX_EVENTS = 10;
/** Upper bound of one provider call. */
export const RECONCILE_PROVIDER_TIMEOUT_MS = 10_000;
/**
 * How many due checkouts one run looks at. The two cases that cost no provider
 * call (no session, provider unbound) do not count toward the cap, so the run
 * reads further than the cap to reach them; the rest is `checkoutsDeferred`.
 */
export const RECONCILE_CHECKOUT_SCAN = 100;
/** An `orphan` or `mismatch` nobody resolved or dismissed is counted as stale after this many days. */
export const RECONCILE_STALE_EXCEPTION_DAYS = 7;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Cron dispatch (RFC 0026 §6)
// ---------------------------------------------------------------------------

/**
 * The two Cron Trigger expressions of `wrangler.jsonc` (`triggers.crons`), as
 * `controller.cron` reports them — character for character. A spec reads the
 * file and fails when either drifts from these constants.
 *
 * They live here and not in `src/index.ts` because the Workers runtime refuses
 * a Worker whose entry module exports anything but handlers: a string constant
 * exported from the entry point fails at startup ("Incorrect type for map
 * entry"), which the Vitest pool does not catch.
 */
export const DAILY_CRON = '0 6 * * *';
export const RECONCILE_PAYMENTS_CRON = '17 * * * *';

/**
 * Which jobs one firing runs (RFC 0026 §6). Each expression has its own
 * invocation: the daily one runs billing, the submission sweep and the mission
 * reconcile exactly as before; the hourly one runs the payment reconcile and
 * nothing else. `null` is an expression this Worker does not know.
 *
 * **Single-trigger fallback (milestone 30, decision 18).** If the account
 * cannot carry a second Cron Trigger, the whole switch is local to this
 * function and `wrangler.jsonc`: drop `DAILY_CRON` from `triggers.crons`, and
 * make the hourly branch answer
 * `{ daily: new Date(scheduledTime).getUTCHours() === 6, reconcilePayments: true }`
 * — the daily jobs then ride the 06:17 UTC firing. Nothing else changes.
 */
export function scheduledPlan(
  cron: string,
  _scheduledTime: number,
): { daily: boolean; reconcilePayments: boolean } | null {
  if (cron === DAILY_CRON) return { daily: true, reconcilePayments: false };
  if (cron === RECONCILE_PAYMENTS_CRON) return { daily: false, reconcilePayments: true };
  return null;
}

export interface ReconcilePaymentsDeps {
  /** The checked provider list and the declared key mode. */
  config: PaymentsConfigResult;
  gateways: Pick<GatewayRegistry, 'isEmpty'>;
  gatewayRepo: Pick<IGatewayRepository, 'listCheckoutsToConfirm' | 'listUnsettledEvents' | 'listExceptions'>;
  gatewayService: Pick<GatewayService, 'confirmCheckout' | 'handleEvent'>;
  now?: () => Date;
  /** Overridable in tests only; production uses `RECONCILE_PROVIDER_TIMEOUT_MS`. */
  providerTimeoutMs?: number;
}

/** Counts only — never an id, a name or an amount. This is the `job_runs.summary`. */
export interface ReconcilePaymentsSummary {
  /** Checkouts due when the run started. */
  checkoutsDue: number;
  /** Provider searches made (≤ 25). */
  checkoutsAsked: number;
  /** Payments the provider held whose checkout is now `paid`. */
  landed: number;
  /** Checkouts closed `expired` after the provider reported nothing paid. */
  expired: number;
  /** Asked, nothing paid yet, not yet expired. */
  stillOpen: number;
  /** `open` with no provider session for over 30 minutes: closed `failed`, no call. */
  abandoned: number;
  /** On a provider that is no longer bound: expired without a call. Non-zero fails the run. */
  unreachable: number;
  /** A payment was found that does not fit its checkout; it is on the exceptions list. */
  mismatched: number;
  /** The provider (or the landing) failed; asked again next run. */
  checkoutErrors: number;
  /** Due and not handled by this run. */
  checkoutsDeferred: number;
  /** Unsettled events due when the run started. */
  eventsDue: number;
  /** Events processed again (≤ 10). */
  eventsRetried: number;
  /** Of those, how many reached a final outcome. */
  eventsSettled: number;
  /** Of those, how many failed again. */
  eventsFailed: number;
  /** Due and not retried by this run. */
  eventsDeferred: number;
  /** `orphan` events older than 7 days, not dismissed. */
  staleOrphans: number;
  /** `mismatch` events and checkouts older than 7 days, not dismissed. */
  staleMismatches: number;
}

export type ReconcilePaymentsReport =
  /** No provider is bound (`PAYMENTS_PROVIDERS = none`): nothing was read, nothing is recorded. */
  | { ran: false }
  | {
      ran: true;
      status: 'ok' | 'failed';
      /** `null` on `ok`. Starts with `PAYMENTS_CONFIG_INVALID` when the configuration is why. */
      error: string | null;
      /** `true` when the provider list, a secret or the `PAYMENTS_KEY_MODE` value is invalid — no step ran. */
      configInvalid: boolean;
      /**
       * What `PAYMENTS_KEY_MODE` declares for this environment; `null` when the
       * configuration is invalid. A reminder for whoever reads the run — the
       * run verifies nothing about a key (milestone 30 decision 19).
       */
      keyMode: PaymentsKeyMode | null;
      summary: ReconcilePaymentsSummary;
    };

const emptySummary = (): ReconcilePaymentsSummary => ({
  checkoutsDue: 0,
  checkoutsAsked: 0,
  landed: 0,
  expired: 0,
  stillOpen: 0,
  abandoned: 0,
  unreachable: 0,
  mismatched: 0,
  checkoutErrors: 0,
  checkoutsDeferred: 0,
  eventsDue: 0,
  eventsRetried: 0,
  eventsSettled: 0,
  eventsFailed: 0,
  eventsDeferred: 0,
  staleOrphans: 0,
  staleMismatches: 0,
});

/**
 * "Off means silent": a valid configuration that binds no provider. An
 * *invalid* one also leaves the registry empty, and is the opposite of off —
 * it is a failed run.
 */
export function isPaymentsOff(deps: Pick<ReconcilePaymentsDeps, 'config' | 'gateways'>): boolean {
  return deps.config.ok && deps.gateways.isEmpty;
}

/** Step 1 — confirm checkouts, at most `RECONCILE_MAX_CHECKOUTS` provider searches. */
async function confirmCheckouts(deps: ReconcilePaymentsDeps, summary: ReconcilePaymentsSummary): Promise<void> {
  const timeoutMs = deps.providerTimeoutMs ?? RECONCILE_PROVIDER_TIMEOUT_MS;
  const due = await deps.gatewayRepo.listCheckoutsToConfirm(RECONCILE_CHECKOUT_SCAN);
  summary.checkoutsDue = due.total;

  let handled = 0;
  for (const checkout of due.items) {
    const result = await deps.gatewayService.confirmCheckout(checkout, {
      ask: summary.checkoutsAsked < RECONCILE_MAX_CHECKOUTS,
      timeoutMs,
    });
    if (result.asked) summary.checkoutsAsked++;
    if (result.outcome === 'deferred') continue;
    handled++;
    switch (result.outcome) {
      case 'landed':
        summary.landed++;
        break;
      case 'expired':
        summary.expired++;
        break;
      case 'open':
        summary.stillOpen++;
        break;
      case 'abandoned':
        summary.abandoned++;
        break;
      case 'unreachable':
        summary.unreachable++;
        break;
      case 'mismatch':
        summary.mismatched++;
        break;
      case 'error':
        summary.checkoutErrors++;
        break;
      case 'closed':
        break;
    }
  }
  summary.checkoutsDeferred = Math.max(0, due.total - handled);
}

/** Step 2 — retry unsettled events through the webhook's own `handleEvent`, fewest attempts first. */
async function retryEvents(deps: ReconcilePaymentsDeps, summary: ReconcilePaymentsSummary): Promise<void> {
  const timeoutMs = deps.providerTimeoutMs ?? RECONCILE_PROVIDER_TIMEOUT_MS;
  const due = await deps.gatewayRepo.listUnsettledEvents(RECONCILE_MAX_EVENTS);
  summary.eventsDue = due.total;

  for (const record of due.items.slice(0, RECONCILE_MAX_EVENTS)) {
    // A row that names no payment can only ever be settled as ignored — which
    // costs no provider call and takes it off the retry list for good.
    const event: ProviderEvent =
      eventFromRecord(record) ?? { kind: 'ignored', eventId: record.eventId, type: record.type };
    const handled = await deps.gatewayService.handleEvent(record.provider, event, { timeoutMs });
    summary.eventsRetried++;
    if (handled.outcome === 'failed') summary.eventsFailed++;
    else summary.eventsSettled++;
  }
  summary.eventsDeferred = Math.max(0, due.total - summary.eventsRetried);
}

/** Step 3 — count what has sat on the exceptions list for over a week. A report, not a clean-up. */
async function countStaleExceptions(
  deps: ReconcilePaymentsDeps,
  summary: ReconcilePaymentsSummary,
  now: Date,
): Promise<void> {
  const { GatewayEventOutcome, CheckoutStatus } = Entities.Config;
  const cutoff = now.getTime() - RECONCILE_STALE_EXCEPTION_DAYS * DAY_MS;
  const stale = (await deps.gatewayRepo.listExceptions()).filter((row) => Date.parse(row.occurredAt) < cutoff);

  // A mismatch found by a webhook is two rows (its event and its checkout): count it once.
  const countedCheckouts = new Set<string>();
  for (const row of stale) {
    if (row.kind !== 'event') continue;
    if (row.event.outcome === GatewayEventOutcome.ORPHAN) summary.staleOrphans++;
    if (row.event.outcome === GatewayEventOutcome.MISMATCH) {
      summary.staleMismatches++;
      if (row.checkout) countedCheckouts.add(row.checkout.id);
    }
  }
  for (const row of stale) {
    if (row.kind !== 'checkout' || row.checkout.status !== CheckoutStatus.MISMATCH) continue;
    if (!countedCheckouts.has(row.checkout.id)) summary.staleMismatches++;
  }
}

/**
 * One run. Returns `{ ran: false }` before its first query when no provider is
 * bound. An infrastructure failure (the database) is thrown; everything the
 * run can anticipate is in the report.
 *
 * The configuration is read **first**: an invalid one binds no adapter, and
 * running step 1 over an empty registry would expire every open checkout as
 * "unreachable". An invalid provider list, a missing secret or an invalid
 * `PAYMENTS_KEY_MODE` value therefore fails the run with
 * `PAYMENTS_CONFIG_INVALID` and touches nothing.
 *
 * Step 4 of RFC §6 (the key mode) is a **report**, not an assertion: the run
 * says which mode the integrator declared and inspects no key (decision 19).
 */
export async function reconcilePayments(deps: ReconcilePaymentsDeps): Promise<ReconcilePaymentsReport> {
  if (isPaymentsOff(deps)) return { ran: false };

  const now = deps.now?.() ?? new Date();
  const summary = emptySummary();

  const config = deps.config;
  if (!config.ok) {
    return {
      ran: true,
      status: 'failed',
      // Reason and detail are key-free by construction (`core/payments/config.ts`).
      error: `${PAYMENTS_CONFIG_INVALID}: ${config.reason} (${config.detail})`,
      configInvalid: true,
      keyMode: null,
      summary,
    };
  }

  await confirmCheckouts(deps, summary);
  await retryEvents(deps, summary);
  await countStaleExceptions(deps, summary, now);

  const error =
    summary.unreachable > 0
      ? `${summary.unreachable} checkout(s) on a provider that is no longer bound were expired without being asked about`
      : null;
  return {
    ran: true,
    status: error ? 'failed' : 'ok',
    error,
    configInvalid: false,
    keyMode: config.config.keyMode,
    summary,
  };
}

/**
 * The `job_runs` outcome of a run that ran: counts only, and the error when it
 * failed. `job_runs.summary` holds integers, so the declared key mode is
 * written there as the flag `keyModeLive` (`1` = `live`, `0` = `test`; absent
 * when the configuration is invalid).
 */
export function reconcilePaymentsOutcome(report: ReconcilePaymentsReport): FinishJobRunParams {
  const { JobRunStatus } = Entities.Config;
  if (!report.ran) return { status: JobRunStatus.OK, summary: null };
  const summary: Record<string, number> = { ...report.summary };
  if (report.keyMode !== null) summary.keyModeLive = report.keyMode === 'live' ? 1 : 0;
  if (report.status === 'ok') return { status: JobRunStatus.OK, summary };
  return { status: JobRunStatus.FAILED, summary, error: report.error };
}

export interface ReconcilePaymentsRunDeps extends ReconcilePaymentsDeps {
  jobRuns: IJobRunRepository;
}

/**
 * The run plus its `job_runs` row (`reconcile_payments`) — what both callers
 * use. With no provider bound it returns before anything is read **or
 * written**: an hourly trigger on a label that takes no online payment leaves
 * no trace.
 */
export async function runReconcilePayments(
  deps: ReconcilePaymentsRunDeps,
  run: { trigger: Entities.Config.JobTrigger; actorId?: string | null },
): Promise<ReconcilePaymentsReport> {
  if (isPaymentsOff(deps)) return { ran: false };
  return recordJobRun(
    deps.jobRuns,
    { job: Entities.Config.JobName.RECONCILE_PAYMENTS, trigger: run.trigger, actorId: run.actorId ?? null },
    () => reconcilePayments(deps),
    reconcilePaymentsOutcome,
  );
}
