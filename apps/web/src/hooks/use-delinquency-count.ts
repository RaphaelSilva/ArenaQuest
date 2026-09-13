'use client';

import { useEffect, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';

/**
 * Broadcast when the billing roster changes — a hold set or cleared — so the
 * nav badge re-reads its count without the console and the sidebar sharing a
 * store. A window event keeps the coupling to a single string.
 */
const ROSTER_CHANGED = 'arenaquest:billing-roster-changed';

export function notifyBillingRosterChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ROSTER_CHANGED));
}

/**
 * The delinquency count for the admin nav badge.
 *
 * The number is whatever `standing=delinquent` returns — no threshold and no
 * due-date arithmetic happens here; a held student is `exempt` on the server
 * and simply drops out of this list.
 *
 * **Failure is silent by design.** The sidebar renders on every admin screen,
 * so a badge that cannot load stays `null` and renders as no badge at all,
 * never as an error that breaks navigation for the rest of the backoffice.
 */
export function useDelinquencyCount(enabled: boolean): number | null {
  const client = useApiClient();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const refresh = () => {
      void (async () => {
        try {
          const roster = await client.adminBilling.students.roster({ standing: 'delinquent' });
          if (!cancelled) setCount(roster.length);
        } catch {
          if (!cancelled) setCount(null);
        }
      })();
    };

    refresh();
    window.addEventListener(ROSTER_CHANGED, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(ROSTER_CHANGED, refresh);
    };
  }, [enabled, client]);

  // Reported rather than stored when disabled, so the effect never writes state
  // it would only have to clear again.
  return enabled ? count : null;
}
