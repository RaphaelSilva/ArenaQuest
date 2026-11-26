'use client';

import { useEffect, useRef, useState } from 'react';
import { MeBillingApiError } from '@web/lib/me-billing-api';
import type { CheckoutStatus } from '@web/lib/me-billing-api';

/**
 * Coming back from the provider's hosted page (RFC 0026 §3, §7).
 *
 * **The return URL is a hint, not a fact.** `?checkout=<id>&outcome=success|cancel`
 * only decides *whether and how long* to ask; what the page then says comes
 * from `GET /v1/me/billing/checkouts/{id}` and nothing else. *Paid* is never
 * derived from the query string.
 *
 * **The polling is bounded.** At most five reads, 2, 4, 8, 15 and 30 seconds
 * apart (about a minute in all), none while the tab is hidden, stopping at the
 * first settled answer. A `cancel` hint asks exactly once: the student said
 * they left, so there is nothing to wait for — but a payment that landed anyway
 * still reads as paid. Whatever the end, the owner is told once so it can
 * re-read the statement.
 */

/** The wait before each read, in order. Its length is the read budget. */
export const CHECKOUT_POLL_GAPS_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;

export type CheckoutReturnPhase =
  /** Still asking. */
  | 'confirming'
  /** The checkout reads `paid`: the money is on the ledger. */
  | 'paid'
  /** Cancelled, or the student came back without paying. */
  | 'cancelled'
  | 'expired'
  /** `failed` or `mismatch`. */
  | 'failed'
  /** Five reads, still `open`: it may yet land; leaving is safe. */
  | 'still_confirming';

type ReturnHint = { checkoutId: string; cancelled: boolean };

const CHECKOUT_ID = /^[A-Za-z0-9_-]{1,100}$/;

const SETTLED: Record<Exclude<CheckoutStatus['status'], 'open'>, CheckoutReturnPhase> = {
  paid: 'paid',
  cancelled: 'cancelled',
  expired: 'expired',
  failed: 'failed',
  mismatch: 'failed',
};

/** Reads the hint off the address bar and removes it, so a reload does not poll again. */
function takeReturnHint(): ReturnHint | null {
  const url = new URL(window.location.href);
  const checkoutId = url.searchParams.get('checkout');
  const outcome = url.searchParams.get('outcome');
  if (checkoutId === null && outcome === null) return null;

  url.searchParams.delete('checkout');
  url.searchParams.delete('outcome');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);

  if (checkoutId === null || !CHECKOUT_ID.test(checkoutId)) return null;
  return { checkoutId, cancelled: outcome === 'cancel' };
}

export function useCheckoutReturn(
  getCheckout: (checkoutId: string) => Promise<CheckoutStatus>,
  /** Called exactly once when the asking ends, whatever the answer. */
  onFinished: () => void,
): CheckoutReturnPhase | null {
  const [phase, setPhase] = useState<CheckoutReturnPhase | null>(null);

  const getCheckoutRef = useRef(getCheckout);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    getCheckoutRef.current = getCheckout;
    onFinishedRef.current = onFinished;
  });

  // Kept across a development double-mount: the first pass already removed the
  // hint from the URL, so the second must not conclude there was none.
  const hintRef = useRef<ReturnHint | null | undefined>(undefined);

  useEffect(() => {
    if (hintRef.current === undefined) hintRef.current = takeReturnHint();
    const hint = hintRef.current;
    if (hint === null) return;

    const gaps: readonly number[] = hint.cancelled ? [0] : CHECKOUT_POLL_GAPS_MS;
    let stopped = false;
    let reads = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dueWhileHidden = false;

    const finish = (next: CheckoutReturnPhase | null) => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      // Consumed: a later re-mount of this effect must not ask again.
      hintRef.current = null;
      setPhase(next);
      onFinishedRef.current();
    };

    const read = async () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden') {
        // Nothing goes out while hidden; the read happens on the way back.
        dueWhileHidden = true;
        return;
      }
      reads += 1;
      let status: CheckoutStatus['status'] | null = null;
      let gone = false;
      try {
        status = (await getCheckoutRef.current(hint.checkoutId)).status;
      } catch (err) {
        // Not the caller's, or no provider bound: there is nothing to report.
        gone = err instanceof MeBillingApiError && err.status === 404;
      }
      if (stopped) return;
      if (gone) return finish(null);
      if (status !== null && status !== 'open') return finish(SETTLED[status]);
      if (reads >= gaps.length) return finish(hint.cancelled ? 'cancelled' : 'still_confirming');
      timer = setTimeout(() => void read(), gaps[reads]);
    };

    function onVisibility() {
      if (document.visibilityState !== 'hidden' && dueWhileHidden) {
        dueWhileHidden = false;
        void read();
      }
    }

    document.addEventListener('visibilitychange', onVisibility);
    if (!hint.cancelled) {
      // Deferred a tick: the effect subscribes, it does not render.
      void Promise.resolve().then(() => {
        if (!stopped) setPhase('confirming');
      });
    }
    timer = setTimeout(() => void read(), gaps[0]);

    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return phase;
}
