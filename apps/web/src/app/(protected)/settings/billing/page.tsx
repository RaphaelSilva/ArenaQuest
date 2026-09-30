'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@arenaquest/shared/domain/billing/format-money';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import type { MyBillingStatement } from '@web/lib/me-billing-api';
import type { BillingStatementCharge, Standing } from '@web/lib/admin-billing-api';

/**
 * `/settings/billing` — the student's own side of the ledger.
 *
 * A read-only statement of what the API returned: the contract terms, every
 * invoice with its due date and balance, the payments and adjustments against
 * them, and the outstanding total. There is no payment affordance here by
 * design — money arrives out of band and an admin records it.
 *
 * This is a sibling of `/settings`, so it follows that page's idiom: inline
 * style objects over the `--aq-*` custom properties, not the Tailwind utility
 * classes the admin console uses.
 *
 * Every amount goes through the shared `formatMoney` with the exponent and
 * symbol the response carried. `Intl.NumberFormat`'s currency style is never
 * used: it accepts a code like `BTC` and silently renders it to two decimals.
 */

const s = {
  page: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '40px 24px',
    fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
    color: 'var(--aq-text)',
  },
  h1: {
    fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif',
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: '-0.4px',
    marginBottom: 8,
  },
  subtitle: { fontSize: 13, color: 'var(--aq-text3)', marginBottom: 8 },
  backLink: {
    fontSize: 12,
    color: 'var(--aq-text3)',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    display: 'inline-block',
    marginBottom: 28,
  },
  card: {
    background: 'var(--aq-bg2)',
    border: '1px solid var(--aq-border)',
    borderRadius: 14,
    padding: '22px 22px',
    marginBottom: 18,
  },
  h2: {
    fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif',
    fontSize: 17,
    fontWeight: 700,
    marginBottom: 14,
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14,
  },
  summaryCell: {
    background: 'var(--aq-bg3)',
    border: '1px solid var(--aq-border2)',
    borderRadius: 10,
    padding: '12px 14px',
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--aq-text2)',
    letterSpacing: '0.3px',
    textTransform: 'uppercase' as const,
    marginBottom: 4,
  },
  value: { fontSize: 15, fontWeight: 600, color: 'var(--aq-text)' },
  outstanding: {
    fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif',
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--aq-text)',
  },
  row: {
    border: '1px solid var(--aq-border2)',
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 12,
  },
  rowHead: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  rowTitle: { fontSize: 14, fontWeight: 700 },
  meta: { fontSize: 12, color: 'var(--aq-text3)' },
  termGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10,
    marginTop: 10,
  },
  lineList: { listStyle: 'none', margin: '6px 0 0', padding: 0 },
  line: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 12,
    color: 'var(--aq-text2)',
    padding: '4px 0',
  },
  subHeading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.3px',
    textTransform: 'uppercase' as const,
    color: 'var(--aq-text3)',
    marginTop: 12,
  },
  empty: { fontSize: 13, color: 'var(--aq-text3)', lineHeight: 1.6 },
  note: { fontSize: 12, color: 'var(--aq-text3)', lineHeight: 1.6, marginTop: 4 },
  retry: {
    marginTop: 12,
    padding: '9px 18px',
    borderRadius: 10,
    border: '1px solid var(--aq-border2)',
    background: 'var(--aq-bg3)',
    color: 'var(--aq-text)',
    fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
};

/**
 * The badge tones for the extras standing. Presentation only: the standing is
 * the one the API resolved and sent, never recomputed here.
 */
const STANDING_TONE: Record<Standing, { color: string; background: string }> = {
  good: { color: 'var(--aq-text2)', background: 'var(--aq-bg3)' },
  due: { color: 'var(--aq-accent2)', background: 'var(--aq-bg3)' },
  delinquent: { color: 'var(--aq-error)', background: 'var(--aq-error-bg)' },
  exempt: { color: 'var(--aq-text2)', background: 'var(--aq-bg3)' },
};

const badge = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.3px',
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid var(--aq-border2)',
};

type ChargeLabel = 'open' | 'overdue' | 'paid' | 'void';

/**
 * The label a charge row reads as. The statement carries no per-charge flag,
 * so "overdue" is the server's own `overdueCharges` predicate from
 * `resolveExtrasRail` — not void, a positive balance, and `asOf` on or past the
 * due date — evaluated against the `asOf` the API sent. The rail standing is
 * never derived here: the section badge renders `extras.standing` as sent.
 */
function chargeLabel(charge: BillingStatementCharge, asOf: string): ChargeLabel {
  if (charge.status === 'void') return 'void';
  if (charge.balanceMinor <= 0) return 'paid';
  return asOf >= charge.dueDate ? 'overdue' : 'open';
}

export default function StudentBillingPage() {
  const dict = useDict();
  const d = dict.settings.billing;
  const client = useApiClient();

  const [statement, setStatement] = useState<MyBillingStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        // No argument: the endpoint takes none — the subject is the caller.
        const data = await client.meBilling.getMyStatement();
        if (!cancelled) setStatement(data);
      } catch {
        if (!cancelled) {
          setStatement(null);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  const currency = statement?.currency ?? null;
  const money = useCallback(
    (amountMinor: number): string =>
      currency === null
        ? d.none
        : formatMoney(amountMinor, {
            exponent: currency.exponent,
            symbol: currency.symbol,
            locale: d.locale,
          }),
    [currency, d.locale, d.none],
  );

  // "Nothing on your account" only when both rails are empty: an extras-only
  // buyer sees the contract sections' own empty states instead.
  const isEmptyStatement =
    statement !== null &&
    statement.contractGroups.length === 0 &&
    statement.invoices.length === 0 &&
    statement.extras.charges.length === 0;

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={s.page}>
        <h1 style={s.h1}>{d.title}</h1>
        <p style={s.subtitle}>{d.subtitle}</p>
        <Link href="/settings" style={s.backLink}>
          {d.backLink}
        </Link>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        ) : failed || statement === null ? (
          <div style={s.card}>
            <p role="alert" style={{ fontSize: 13, color: 'var(--aq-error)' }}>
              {d.loadError}
            </p>
            <button type="button" style={s.retry} onClick={() => setAttempt((n) => n + 1)}>
              {d.retry}
            </button>
          </div>
        ) : (
          <>
            <div style={s.card}>
              <div style={s.summaryGrid}>
                <div style={s.summaryCell}>
                  <div style={s.label}>{d.outstandingLabel}</div>
                  <div style={s.outstanding}>{money(statement.outstandingMinor)}</div>
                </div>
                <div style={s.summaryCell}>
                  <div style={s.label}>{d.studentSinceLabel}</div>
                  <div style={s.value}>{statement.studentSince ?? d.none}</div>
                </div>
                <div style={s.summaryCell}>
                  <div style={s.label}>{d.membershipSinceLabel}</div>
                  <div style={s.value}>{statement.currentMembershipSince ?? d.none}</div>
                </div>
              </div>
              <p style={s.note}>{d.asOf(statement.asOf)}</p>
              <p style={s.note}>{d.paymentNote}</p>
            </div>

            {/* A member with no contract is a normal state, not an error: the
                API answers with an empty statement rather than a 404, and this
                reads as an empty statement rather than a failure. */}
            {isEmptyStatement ? (
              <div style={s.card}>
                <p style={s.empty}>{d.emptyStatement}</p>
              </div>
            ) : (
              <>
                <section style={s.card}>
                  <h2 style={s.h2}>{d.contracts.heading}</h2>
                  {statement.contractGroups.length === 0 ? (
                    <p style={s.empty}>{d.contracts.empty}</p>
                  ) : (
                    statement.contractGroups.map((group) => (
                      <div key={group.contractGroupId} style={s.row}>
                        <div style={s.rowHead}>
                          <span style={s.rowTitle}>
                            {group.endDate === null
                              ? d.contracts.openEnded(group.startDate)
                              : d.contracts.period(group.startDate, group.endDate)}
                          </span>
                          <span style={s.meta}>{d.contractStatus[group.status]}</span>
                        </div>
                        <div style={s.meta}>{d.contracts.versions(group.versions.length)}</div>
                        {group.versions.map((version) => (
                          <div key={version.id}>
                            <div style={s.termGrid}>
                              <div>
                                <div style={s.label}>{d.contracts.amountLabel}</div>
                                <div style={s.value}>{money(version.amountMinor)}</div>
                              </div>
                              <div>
                                <div style={s.label}>{d.contracts.cycleLabel}</div>
                                <div style={s.value}>{d.cycle[version.cycle]}</div>
                              </div>
                              <div>
                                <div style={s.label}>{d.contracts.dueDayLabel}</div>
                                <div style={s.value}>{version.dueDay}</div>
                              </div>
                              <div>
                                <div style={s.label}>{d.contracts.graceDaysLabel}</div>
                                <div style={s.value}>
                                  {d.contracts.graceDaysValue(version.graceDays)}
                                </div>
                              </div>
                            </div>
                            {version.termsSource === 'negotiated' && (
                              <p style={s.note}>{d.contracts.negotiated}</p>
                            )}
                            {version.termsNote !== '' && (
                              <p style={s.note}>
                                {`${d.contracts.termsNoteLabel}: ${version.termsNote}`}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </section>

                <section style={s.card}>
                  <h2 style={s.h2}>{d.invoices.heading}</h2>
                  {statement.invoices.length === 0 ? (
                    <p style={s.empty}>{d.invoices.empty}</p>
                  ) : (
                    statement.invoices.map((invoice) => (
                      <div key={invoice.id} style={s.row}>
                        <div style={s.rowHead}>
                          <span style={s.rowTitle}>
                            {d.invoices.periodValue(invoice.periodStart, invoice.periodEnd)}
                          </span>
                          <span style={s.meta}>{d.invoiceStatus[invoice.status]}</span>
                        </div>
                        <div style={s.termGrid}>
                          <div>
                            <div style={s.label}>{d.invoices.dueLabel}</div>
                            <div style={s.value}>{invoice.dueDate}</div>
                          </div>
                          <div>
                            <div style={s.label}>{d.invoices.amountLabel}</div>
                            <div style={s.value}>{money(invoice.amountMinor)}</div>
                          </div>
                          <div>
                            <div style={s.label}>{d.invoices.balanceLabel}</div>
                            <div style={s.value}>{money(invoice.balanceMinor)}</div>
                          </div>
                        </div>

                        <div style={s.subHeading}>{d.invoices.adjustmentsHeading}</div>
                        {invoice.adjustments.length === 0 ? (
                          <p style={s.meta}>{d.invoices.noAdjustments}</p>
                        ) : (
                          <ul style={s.lineList}>
                            {invoice.adjustments.map((adjustment) => (
                              <li key={adjustment.id} style={s.line}>
                                <span>
                                  {`${d.adjustmentKind[adjustment.kind]} · ${adjustment.appliedAt}`}
                                </span>
                                <span>{money(adjustment.amountMinor)}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        <div style={s.subHeading}>{d.invoices.paymentsHeading}</div>
                        {invoice.payments.length === 0 ? (
                          <p style={s.meta}>{d.invoices.noPayments}</p>
                        ) : (
                          <ul style={s.lineList}>
                            {invoice.payments.map((payment) => (
                              <li key={payment.id} style={s.line}>
                                <span>
                                  {`${d.paymentMethod[payment.method]} · ${payment.paidAt}`}
                                  {payment.reversesId === null ? '' : ` · ${d.invoices.reversal}`}
                                </span>
                                <span>{money(payment.amountMinor)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))
                  )}
                </section>
              </>
            )}

            {/* The extras rail: its own badge and its own outstanding, beside —
                never summed into — the contract figures above. */}
            <section style={s.card} aria-labelledby="billing-extras-heading">
              <div style={s.rowHead}>
                <h2 id="billing-extras-heading" style={{ ...s.h2, marginBottom: 0 }}>
                  {d.extras.heading}
                </h2>
                <span style={{ ...badge, ...STANDING_TONE[statement.extras.standing] }}>
                  {d.extras.standing[statement.extras.standing]}
                </span>
              </div>
              <p style={{ ...s.note, marginTop: 0, marginBottom: 12 }}>{d.extras.intro}</p>

              {statement.extras.charges.length === 0 ? (
                <p style={s.empty}>{d.extras.empty}</p>
              ) : (
                <>
                  <div style={{ ...s.summaryGrid, marginBottom: 14 }}>
                    <div style={s.summaryCell}>
                      <div style={s.label}>{d.extras.outstandingLabel}</div>
                      <div style={s.outstanding}>{money(statement.extras.outstandingMinor)}</div>
                    </div>
                    <div style={s.summaryCell}>
                      <div style={s.label}>{d.extras.oldestOverdueLabel}</div>
                      <div style={s.value}>{statement.extras.oldestOverdueDate ?? d.none}</div>
                    </div>
                  </div>

                  {statement.extras.charges.map((charge) => {
                    const label = chargeLabel(charge, statement.asOf);
                    return (
                      <div key={charge.id} style={s.row}>
                        <div style={s.rowHead}>
                          <span style={s.rowTitle}>{charge.eventTitle}</span>
                          <span
                            style={
                              label === 'overdue'
                                ? { ...s.meta, color: 'var(--aq-error)', fontWeight: 700 }
                                : s.meta
                            }
                          >
                            {d.extras.status[label]}
                          </span>
                        </div>
                        <div style={s.termGrid}>
                          <div>
                            <div style={s.label}>{d.extras.eventDateLabel}</div>
                            <div style={s.value}>
                              {charge.eventStartsAt === null
                                ? d.none
                                : charge.eventStartsAt.slice(0, 10)}
                            </div>
                          </div>
                          <div>
                            <div style={s.label}>{d.extras.dueLabel}</div>
                            <div style={s.value}>{charge.dueDate}</div>
                          </div>
                          <div>
                            <div style={s.label}>{d.extras.amountLabel}</div>
                            <div style={s.value}>{money(charge.amountMinor)}</div>
                          </div>
                          <div>
                            <div style={s.label}>{d.extras.balanceLabel}</div>
                            <div style={s.value}>{money(charge.balanceMinor)}</div>
                          </div>
                        </div>

                        {charge.adjustments.length > 0 && (
                          <>
                            <div style={s.subHeading}>{d.invoices.adjustmentsHeading}</div>
                            <ul style={s.lineList}>
                              {charge.adjustments.map((adjustment) => (
                                <li key={adjustment.id} style={s.line}>
                                  <span>
                                    {`${d.adjustmentKind[adjustment.kind]} · ${adjustment.appliedAt}`}
                                  </span>
                                  <span>{money(adjustment.amountMinor)}</span>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}

                        {charge.payments.length > 0 && (
                          <>
                            <div style={s.subHeading}>{d.invoices.paymentsHeading}</div>
                            <ul style={s.lineList}>
                              {charge.payments.map((payment) => (
                                <li key={payment.id} style={s.line}>
                                  <span>
                                    {`${d.paymentMethod[payment.method]} · ${payment.paidAt}`}
                                    {payment.reversesId === null ? '' : ` · ${d.invoices.reversal}`}
                                  </span>
                                  <span>{money(payment.amountMinor)}</span>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
