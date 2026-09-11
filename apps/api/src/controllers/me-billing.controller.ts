import type { ControllerResult } from '@api/core/result';
import type { BillingService } from '@api/core/billing/billing-service';
import type { AccountingService, StudentStatement } from '@api/core/billing/accounting-service';
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

export interface MyBillingStatement extends StudentStatement {
  /** Resolved on every read from the invoices, the hold and `asOf`. */
  standing: Entities.Config.BillingStanding;
  /** Due date of the oldest unpaid invoice already past due; null if none is. */
  oldestOverdueDate: string | null;
  /** The day the standing was resolved against — `YYYY-MM-DD`. */
  asOf: string;
}

export class MeBillingController {
  constructor(
    private readonly billing: BillingService,
    /** Read-only; the statement is the same one the admin sees for this student. */
    private readonly accounting: AccountingService,
  ) {}

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
