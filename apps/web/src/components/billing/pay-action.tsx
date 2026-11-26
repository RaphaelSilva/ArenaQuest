'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { MeBillingApiError } from '@web/lib/me-billing-api';
import type {
  CheckoutErrorKind,
  CheckoutSession,
  PayOption,
  PendingCheckout,
  ReceivableKind,
} from '@web/lib/me-billing-api';

/**
 * The *Pay* action of one receivable (RFC 0026 §7) — shared by the student
 * statement and the dashboard's *payment due* card.
 *
 * **It only adds a way to pay.** It renders nothing when the label offers no
 * method, and it never hides, disables or gates anything outside itself.
 *
 * **The provider's page opens in a new tab, never in a frame.** The tab is
 * opened synchronously inside the click handler — blank, before the request —
 * so a popup blocker sees a user gesture; once the API answers, that tab is
 * sent to the hosted page. When the browser blocked it anyway, the link to
 * follow is shown instead.
 *
 * **What it shows is the API's.** *In progress* comes from the statement's
 * `pendingCheckout` (or from the session this very click created); the only
 * thing computed here is "is its expiry still ahead of this device's clock",
 * so an expired attempt turns back into *Pay* without a reload.
 */

export type PayActionProps = {
  kind: ReceivableKind;
  /** The invoice or event-charge id. */
  id: string;
  /** `statement.payOptions`, in the order the API gave. Empty → renders nothing. */
  payOptions: readonly PayOption[];
  /** The receivable's `pendingCheckout` from the statement. */
  pendingCheckout: PendingCheckout | null;
  /**
   * Called when the statement no longer describes this receivable: a checkout
   * was created or reopened, or the API refused because the receivable changed.
   * The owner should re-read the statement **without unmounting** this action.
   */
  onChanged?: () => void;
};

/** A receivable *Pay* applies to: still open, with something left to pay. */
export function isPayable(receivable: { status: string; balanceMinor: number }): boolean {
  return receivable.status === 'open' && receivable.balanceMinor > 0;
}

/** An instant in the build language's format and the viewer's own time zone. */
export function formatExpiry(iso: string, locale: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(at);
}

/** Only an http(s) URL is ever handed to a tab or an anchor. */
function hostedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The longest delay `setTimeout` honours; a later expiry is re-armed. */
const MAX_TIMEOUT_MS = 2_147_483_647;

const s = {
  wrap: { marginTop: 12, display: 'flex', flexDirection: 'column' as const, gap: 8 },
  actions: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  status: { fontSize: 12, color: 'var(--aq-text2)', lineHeight: 1.5, margin: 0 },
  button: {
    minHeight: 44,
    minWidth: 44,
    padding: '10px 18px',
    borderRadius: 10,
    border: '1px solid var(--aq-accent)',
    background: 'var(--aq-accent-glow)',
    color: 'var(--aq-text)',
    fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondary: {
    border: '1px solid var(--aq-border2)',
    background: 'var(--aq-bg3)',
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    color: 'var(--aq-text)',
    fontWeight: 700,
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    overflowWrap: 'anywhere' as const,
  },
  error: { fontSize: 12, color: 'var(--aq-error)', lineHeight: 1.5, margin: 0 },
};

export function PayAction({ kind, id, payOptions, pendingCheckout, onChanged }: PayActionProps) {
  const dict = useDict();
  const d = dict.settings.billing.pay;
  const locale = dict.settings.billing.locale;
  const client = useApiClient();

  /** The session this component created — the only place a hosted URL lives. */
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<CheckoutErrorKind | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The statement's word first; the click's own session until the statement
  // has been read again.
  const attempt: { provider: string; expiresAt: string } | null = pendingCheckout ?? session;
  const expiresAtMs = attempt === null ? null : new Date(attempt.expiresAt).getTime();
  const live = attempt !== null && expiresAtMs !== null && expiresAtMs > now ? attempt : null;

  // Turn an attempt back into *Pay* the moment it expires, without a reload.
  useEffect(() => {
    if (expiresAtMs === null || Number.isNaN(expiresAtMs)) return;
    const remaining = expiresAtMs - Date.now();
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.min(remaining, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [expiresAtMs, now]);

  const start = useCallback(
    async (provider: string | undefined, key: string) => {
      if (busy !== null) return;
      setBusy(key);
      setError(null);
      setBlockedUrl(null);

      // Opened here, synchronously, while the click is still a user gesture.
      let tab: Window | null = null;
      try {
        tab = window.open('', '_blank');
      } catch {
        tab = null;
      }

      try {
        const created = await client.meBilling.createCheckout({ kind, id, provider });
        const url = hostedUrl(created.url);
        if (url === null) {
          tab?.close();
          if (mounted.current) setError('unknown');
          return;
        }
        let opened = false;
        if (tab !== null && !tab.closed) {
          try {
            // The hosted page must not reach back into this window.
            tab.opener = null;
            tab.location.replace(url);
            opened = true;
          } catch {
            opened = false;
          }
        }
        if (mounted.current) {
          setSession(created);
          setNow(Date.now());
          if (!opened) setBlockedUrl(url);
        }
        onChanged?.();
      } catch (err) {
        tab?.close();
        const refusal = err instanceof MeBillingApiError ? err : null;
        if (mounted.current) setError(refusal?.checkoutKind ?? 'unknown');
        if (refusal?.statementIsStale) onChanged?.();
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [busy, client, id, kind, onChanged],
  );

  if (payOptions.length === 0) return null;

  const methodsLabel = (option: PayOption): string =>
    option.methods.map((method) => d.method[method]).join(d.methodSeparator);

  const isBusy = busy !== null;
  const canReopen = live !== null && payOptions.some((o) => o.provider === live.provider);
  // While an attempt is live the other providers stay offered, labelled by
  // method: choosing one replaces the attempt (the API cancels the first).
  const choices =
    live === null
      ? payOptions.length === 1
        ? []
        : payOptions
      : payOptions.filter((o) => o.provider !== live.provider);

  return (
    <div style={s.wrap}>
      {live !== null && (
        <p role="status" style={s.status}>
          {d.inProgress(formatExpiry(live.expiresAt, locale))}
        </p>
      )}

      <div style={s.actions} role="group" aria-label={d.groupLabel}>
        {live !== null && canReopen && (
          <button
            type="button"
            style={s.button}
            disabled={isBusy}
            aria-busy={busy === 'reopen'}
            onClick={() => void start(live.provider, 'reopen')}
          >
            {d.openAgain}
          </button>
        )}
        {live === null && payOptions.length === 1 && (
          <button
            type="button"
            style={s.button}
            disabled={isBusy}
            aria-busy={busy === 'single'}
            // One offering provider: the API picks it, so none is named.
            onClick={() => void start(undefined, 'single')}
          >
            {d.action}
          </button>
        )}
        {choices.map((option) => (
          <button
            key={option.provider}
            type="button"
            style={live === null ? s.button : { ...s.button, ...s.secondary }}
            disabled={isBusy}
            aria-busy={busy === option.provider}
            onClick={() => void start(option.provider, option.provider)}
          >
            {d.payWith(methodsLabel(option))}
          </button>
        ))}
      </div>

      {isBusy && (
        <p role="status" style={s.status}>
          {d.opening}
        </p>
      )}

      {blockedUrl !== null && (
        <p style={s.status}>
          {d.blocked}{' '}
          <a href={blockedUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
            {d.blockedLink}
          </a>
        </p>
      )}

      {error !== null && (
        <p role="alert" style={s.error}>
          {d.errors[error]}
        </p>
      )}
    </div>
  );
}
