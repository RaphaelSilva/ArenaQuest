import { AdminBillingApiError } from '@web/lib/admin-billing-api';

/**
 * The server's own explanation when it sent one — never a generic failure.
 *
 * `apps/api/src/routes/_shared/envelope.ts` spreads its `meta` into the error
 * body, so a refusal arrives as `{ error, message }` and `detailMessage` reads
 * the sentence out of it. That sentence is the only authority worth showing:
 * "the student already has an active contract" is the database's call, backed
 * by `idx_subscriptions_one_active`, and no client-side guess may replace it.
 *
 * Shared by every write surface on this console so the behaviour is one
 * implementation rather than a copy per screen.
 */
export function explain(thrown: unknown, fallback: string): string {
  return thrown instanceof AdminBillingApiError ? (thrown.detailMessage ?? fallback) : fallback;
}
