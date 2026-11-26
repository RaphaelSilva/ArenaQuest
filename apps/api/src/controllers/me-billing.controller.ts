import type { ControllerResult } from '@api/core/result';
import type { BillingService } from '@api/core/billing/billing-service';
import type { AccountingService, StudentStatement } from '@api/core/billing/accounting-service';
import type {
  CheckoutSession,
  CheckoutStatusView,
  CreateCheckoutInput,
  GatewayService,
} from '@api/core/payments/gateway-service';
import type { Entities } from '@arenaquest/shared/types/entities';

/**
 * MeBillingController — a student's own billing statement (RFC 0013 §2, §3).
 *
 * Three properties define this file, and each of them is a way it could go
 * wrong:
 *
 * 1. **Self-only by construction, not by check.** The only input is the caller
 *    id the router reads from the verified access token. There is no path, no
 *    query, no header and no body field naming a user — so there is no
 *    parameter to forget to validate, and no comparison of "requested id" with
 *    "my id" that could be written the wrong way round. The admin reads another
 *    student through `GET /v1/admin/billing/students/{userId}/statement`, which
 *    sits behind `requireRole(ADMIN)`; the two never share a handler.
 * 2. **A student with no contract is not an error.** They get an empty
 *    statement with standing `good` and a `200`. A `404` here would tell a
 *    perfectly ordinary member that they do not exist.
 * 3. **It gates nothing.** Reading this endpoint changes no permission, and a
 *    `delinquent` standing in its response is a label on a banner. No caller of
 *    this controller is a guard, and nothing in the billing context reads or
 *    writes an enrollment grant.
 *
 * The hold's `reason` and `setBy` are deliberately **not** reported here. A
 * hold is an internal note between admins about whom to stop chasing; the
 * student sees its effect — standing `exempt` — and not the note.
 */

/**
 * `standing`, `oldestOverdueDate` and the inherited `outstandingMinor` are the
 * **contract rail only** (RFC 0015 §7). The extras rail arrives in the
 * inherited `extras` object with its own standing, and is never folded in.
 */
export interface MyBillingStatement extends StudentStatement {
  /** Contract standing, resolved on every read from the invoices, the hold and `asOf`. */
  standing: Entities.Config.BillingStanding;
  /** Due date of the oldest unpaid invoice already past due; null if none is. */
  oldestOverdueDate: string | null;
  /** The day the standing was resolved against — `YYYY-MM-DD`. */
  asOf: string;
}

/** The receivable a caller wants to pay: a kind, an id, and optionally how. Never a user. */
export type MyCheckoutRequest = CreateCheckoutInput;

/** A hosted session, and whether this call opened it (`201`) or it was already open (`200`). */
export interface MyCheckoutAnswer {
  checkout: CheckoutSession;
  created: boolean;
}

/** The slice of the gateway a student reaches: their own checkouts, nothing else. */
export type MyCheckouts = Pick<GatewayService, 'checkoutGate' | 'createCheckout' | 'getCheckoutStatus'>;

const NOT_FOUND: ControllerResult<never> = { ok: false, status: 404, error: 'NotFound' };

export class MeBillingController {
  constructor(
    private readonly billing: BillingService,
    /** Read-only; the statement is the same one the admin sees for this student. */
    private readonly accounting: AccountingService,
    /** Absent on a wiring without a gateway: the checkout routes then answer `404`. */
    private readonly checkouts?: MyCheckouts,
  ) {}

  /**
   * Whether the checkout routes exist on this label: `null` when they do,
   * otherwise the `404` (no provider) or `500 PAYMENTS_CONFIG_INVALID` every
   * request to them gets — before its body is even looked at.
   */
  checkoutGate(): ControllerResult<never> | null {
    return this.checkouts ? this.checkouts.checkoutGate() : NOT_FOUND;
  }

  /**
   * Opens — or hands back — the caller's one live hosted checkout for a
   * receivable **of their own** (RFC 0026 §3).
   *
   * `callerId` is the token's `sub` and is both the owner the receivable must
   * have and the creator recorded on the row. The request names a receivable,
   * never a user, so there is nothing to compare a "requested user" against:
   * a receivable owed by anyone else is `404`, as a missing one is.
   */
  async createMyCheckout(
    callerId: string,
    request: MyCheckoutRequest,
  ): Promise<ControllerResult<MyCheckoutAnswer>> {
    if (!this.checkouts) return NOT_FOUND;
    const result = await this.checkouts.createCheckout(request, { userId: callerId, createdBy: callerId });
    if (!result.ok) return result;
    return { ok: true, data: { checkout: result.data.checkout, created: !result.data.reused } };
  }

  /** One checkout of the caller's own, as its row stands; the provider is never asked. */
  async getMyCheckout(callerId: string, checkoutId: string): Promise<ControllerResult<CheckoutStatusView>> {
    if (!this.checkouts) return NOT_FOUND;
    return this.checkouts.getCheckoutStatus(checkoutId, callerId);
  }

  /**
   * The caller's own statement.
   *
   * The single parameter is the token's `sub`. Its arity is part of the
   * contract — a second parameter would be the beginning of the bug this
   * endpoint is shaped to make impossible.
   */
  async getMyStatement(callerId: string): Promise<ControllerResult<MyBillingStatement>> {
    const statement = await this.accounting.getStudentStatement(callerId);
    if (!statement.ok) return statement;

    const standing = await this.billing.getStanding(callerId);
    if (!standing.ok) return standing;

    return {
      ok: true,
      data: {
        ...statement.data,
        standing: standing.data.standing,
        oldestOverdueDate: standing.data.oldestOverdueDate,
        asOf: standing.data.asOf,
      },
    };
  }
}
