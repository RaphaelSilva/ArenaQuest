'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@web/components/design-system';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { AdminEvent } from '@web/lib/admin-events-api';
import type {
  BillingEventChargeDetail,
  BillingEventChargePayment,
  BillingEventChargeSummary,
  BillingEventChargeWithBalance,
  BillingEventPrice,
  BillingReportCurrency,
} from '@web/lib/admin-billing-api';
import { Money, useMoneyFormatter } from './money';
import { explain } from './explain-error';
import { fromMinorUnits, toMinorUnits } from './minor-units';
import { PaymentForm } from './payment-form';
import { AdjustmentForm } from './adjustment-form';
import { VoidInvoiceForm } from './void-invoice-form';
import { ReversePaymentForm } from './reverse-payment-form';
import { ChargeDialog, type ChargeablePerson } from './charge-dialog';

/** Events are listed a page at a time; one page covers a dojo's calendar. */
const EVENT_PAGE = 100;

const WHOLE_DAYS = /^\d+$/;

type WriteDraft = {
  action: 'payment' | 'adjustment' | 'void';
  charge: BillingEventChargeWithBalance;
};

function shortRef(id: string): string {
  return id.slice(0, 8);
}

/**
 * `/admin/billing` → Extras — sell and collect an event extra (RFC 0015 §8).
 *
 * Everything here stays on the extras rail: the price, the summary and the
 * charge list read the event-charge endpoints only, and nothing on this tab is
 * added to a contract figure. The ledger actions are the invoice forms,
 * parametrised with `kind="charge"`, so the two rails share one set of rules
 * on screen as they do on the server.
 *
 * Only **published** events are offered. The list is requested with
 * `status=published` and filtered again here, so a draft or an archived event
 * can never reach the selector even if the server answered more than asked.
 */
export function ExtrasTab({
  currency,
  nameOf,
  students,
}: {
  currency: BillingReportCurrency | null;
  nameOf: (userId: string) => string;
  students: readonly ChargeablePerson[];
}) {
  const dict = useDict();
  const d = dict.admin.billing.extras;
  const ledger = dict.admin.billing.ledger;
  const planValidation = dict.admin.billing.plans.validation;
  const client = useApiClient();
  const formatMoneyValue = useMoneyFormatter(currency);

  const eventSelectId = useId();

  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventId, setEventId] = useState('');

  const [price, setPrice] = useState<BillingEventPrice | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceAmount, setPriceAmount] = useState('');
  const [priceDueIn, setPriceDueIn] = useState('0');
  const [priceGrace, setPriceGrace] = useState('5');
  const [priceFieldErrors, setPriceFieldErrors] = useState<{
    amount?: string;
    dueIn?: string;
    grace?: string;
  }>({});
  const [priceBusy, setPriceBusy] = useState(false);

  const [summary, setSummary] = useState<BillingEventChargeSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [charges, setCharges] = useState<BillingEventChargeWithBalance[]>([]);
  const [chargesLoading, setChargesLoading] = useState(false);
  const [chargesError, setChargesError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<BillingEventChargeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [writeDraft, setWriteDraft] = useState<WriteDraft | null>(null);
  const [reverseDraft, setReverseDraft] = useState<{ paymentId: string; chargeId: string } | null>(
    null,
  );
  const [chargeOpen, setChargeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** Bumped after every write: the list and the summary are re-read, never patched. */
  const [refreshToken, setRefreshToken] = useState(0);

  const event = useMemo(() => events.find((row) => row.id === eventId) ?? null, [events, eventId]);
  const exponent = currency?.exponent ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await client.adminEvents.list({ status: 'published', limit: EVENT_PAGE });
        if (!cancelled) setEvents(page.data.filter((row) => row.status === 'published'));
      } catch {
        if (!cancelled) setEventsError(d.eventsError);
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, d.eventsError]);

  const fillPriceForm = useCallback(
    (next: BillingEventPrice | null) => {
      setPrice(next);
      setPriceFieldErrors({});
      setPriceAmount(next && exponent !== null ? fromMinorUnits(next.amountMinor, exponent) : '');
      setPriceDueIn(String(next?.dueInDays ?? 0));
      setPriceGrace(String(next?.graceDays ?? 5));
    },
    [exponent],
  );

  // The price is read once per chosen event.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setPriceError(null);
    void (async () => {
      try {
        const loaded = await client.adminBilling.extras.getPrice(eventId);
        if (!cancelled) fillPriceForm(loaded);
      } catch {
        if (!cancelled) {
          fillPriceForm(null);
          setPriceError(d.price.loadError);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, eventId, fillPriceForm, d.price.loadError]);

  // The summary and the list are re-read on every write.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setChargesLoading(true);
    setChargesError(null);
    setSummaryError(null);
    void (async () => {
      const [summaryResult, chargesResult] = await Promise.allSettled([
        client.adminBilling.extras.summary(eventId),
        client.adminBilling.extras.listCharges({ eventId }),
      ]);
      if (cancelled) return;
      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value);
      } else {
        setSummary(null);
        setSummaryError(explain(summaryResult.reason, d.summary.loadError));
      }
      if (chargesResult.status === 'fulfilled') {
        setCharges(chargesResult.value);
      } else {
        setCharges([]);
        setChargesError(d.charges.loadError);
      }
      setChargesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, eventId, refreshToken, d.summary.loadError, d.charges.loadError]);

  const loadDetail = useCallback(
    async (chargeId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        setDetail(await client.adminBilling.extras.getCharge(chargeId));
      } catch {
        setDetail(null);
        setDetailError(d.charges.detailsError);
      } finally {
        setDetailLoading(false);
      }
    },
    [client, d.charges.detailsError],
  );

  const chooseEvent = (next: string) => {
    setEventId(next);
    setNotice(null);
    setExpanded(null);
    setDetail(null);
    setSummary(null);
    setCharges([]);
    if (!next) fillPriceForm(null);
  };

  const toggle = (charge: BillingEventChargeWithBalance) => {
    if (expanded === charge.id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(charge.id);
    setDetail(null);
    void loadDetail(charge.id);
  };

  const afterWrite = useCallback(
    (chargeId: string | null, message: string) => {
      setNotice(message);
      setWriteDraft(null);
      setReverseDraft(null);
      setRefreshToken((token) => token + 1);
      if (chargeId && expanded === chargeId) void loadDetail(chargeId);
    },
    [expanded, loadDetail],
  );

  const savePrice = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!eventId) return;
    const errors: { amount?: string; dueIn?: string; grace?: string } = {};
    let amountMinor = 0;
    if (exponent === null) {
      errors.amount = dict.admin.billing.money.resolveError;
    } else {
      const converted = toMinorUnits(priceAmount, exponent);
      if (!converted.ok) {
        const messages: Record<typeof converted.reason, string> = {
          empty: planValidation.amountEmpty,
          'not-a-number': planValidation.amountNotANumber,
          negative: planValidation.amountNegative,
          'too-precise': planValidation.amountTooPrecise(exponent),
        };
        errors.amount = messages[converted.reason];
      } else {
        amountMinor = converted.amountMinor;
      }
    }
    if (!WHOLE_DAYS.test(priceDueIn.trim())) errors.dueIn = d.price.daysInvalid;
    if (!WHOLE_DAYS.test(priceGrace.trim())) errors.grace = d.price.daysInvalid;
    setPriceFieldErrors(errors);
    setPriceError(null);
    if (Object.keys(errors).length > 0) return;

    setPriceBusy(true);
    try {
      const saved = await client.adminBilling.extras.setPrice(eventId, {
        amountMinor,
        dueInDays: Number(priceDueIn.trim()),
        graceDays: Number(priceGrace.trim()),
      });
      fillPriceForm(saved);
      setNotice(d.price.saved);
    } catch (thrown) {
      setPriceError(explain(thrown, d.price.saveError));
    } finally {
      setPriceBusy(false);
    }
  };

  const clearPrice = async () => {
    if (!eventId) return;
    setPriceBusy(true);
    setPriceError(null);
    try {
      await client.adminBilling.extras.clearPrice(eventId);
      fillPriceForm(null);
      setNotice(d.price.cleared);
    } catch (thrown) {
      setPriceError(explain(thrown, d.price.clearError));
    } finally {
      setPriceBusy(false);
    }
  };

  // Originals first, each with the reversal that mirrors it.
  const paymentGroups = useMemo(() => {
    const payments = detail?.payments ?? [];
    const reversalOf = new Map<string, BillingEventChargePayment>();
    for (const payment of payments) {
      if (payment.reversesId) reversalOf.set(payment.reversesId, payment);
    }
    return payments
      .filter((payment) => payment.reversesId === null)
      .map((payment) => ({ payment, reversal: reversalOf.get(payment.id) ?? null }));
  }, [detail]);

  const renderDetail = (charge: BillingEventChargeWithBalance) => {
    const reference = shortRef(charge.id);
    if (detailLoading) return <p className="text-sm text-zinc-500">{d.charges.detailsLoading}</p>;
    if (detailError) {
      return (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {detailError}
        </p>
      );
    }
    return (
      <div className="space-y-5">
        {charge.termsNote && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {d.charges.termsNoteLine(charge.termsNote)}
          </p>
        )}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {ledger.actionsHeading}
          </h3>
          {charge.status === 'void' ? (
            <p className="text-sm text-zinc-500">{d.charges.voidedNote}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  setNotice(null);
                  setWriteDraft({ action: 'payment', charge });
                }}
                aria-label={d.paymentButtonAriaLabel(reference)}
              >
                {ledger.payment.button}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setNotice(null);
                  setWriteDraft({ action: 'adjustment', charge });
                }}
                aria-label={d.adjustmentButtonAriaLabel(reference)}
              >
                {ledger.adjustment.button}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  setNotice(null);
                  setWriteDraft({ action: 'void', charge });
                }}
                aria-label={d.voidCharge.buttonAriaLabel(reference)}
              >
                {d.voidCharge.button}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {ledger.adjustmentsHeading}
            </h3>
            {(detail?.adjustments.length ?? 0) === 0 ? (
              <p className="text-sm text-zinc-500">{d.charges.adjustmentsEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {detail?.adjustments.map((adjustment) => (
                  <li
                    key={adjustment.id}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                  >
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {`${ledger.adjustmentKind[adjustment.kind]} · ${formatMoneyValue(
                        adjustment.amountMinor,
                        charge.currency,
                      )}`}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {`${adjustment.appliedAt} · ${ledger.recordedBy(adjustment.appliedBy)}`}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {ledger.reasonLine(adjustment.reason)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {ledger.paymentsHeading}
            </h3>
            {paymentGroups.length === 0 ? (
              <p className="text-sm text-zinc-500">{d.charges.paymentsEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {paymentGroups.map(({ payment, reversal }) => (
                  <li
                    key={payment.id}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {`${ledger.method[payment.method]} · ${formatMoneyValue(
                          payment.amountMinor,
                          payment.currency,
                        )}`}
                      </span>
                      {reversal ? (
                        <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                          {ledger.alreadyReversed}
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setNotice(null);
                            setReverseDraft({ paymentId: payment.id, chargeId: charge.id });
                          }}
                          aria-label={ledger.reverseAriaLabel(shortRef(payment.id))}
                        >
                          {ledger.reverseButton}
                        </Button>
                      )}
                    </div>
                    <span className="block text-xs text-zinc-500">
                      {`${payment.paidAt} · ${ledger.recordedBy(payment.recordedBy)}`}
                    </span>
                    {reversal && (
                      <div className="mt-2 border-l-2 border-amber-400 pl-3">
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {`${ledger.reversalOf(shortRef(payment.id))} · ${formatMoneyValue(
                            reversal.amountMinor,
                            reversal.currency,
                          )}`}
                        </span>
                        <span className="block text-xs text-zinc-500">
                          {ledger.reasonLine(reversal.note)}
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.heading}</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.railNote}</p>
      </div>

      {/* ---------------------------------------------------------------
          Event selector — published events only.
          --------------------------------------------------------------- */}
      {eventsLoading ? (
        <p className="text-sm text-zinc-500">{d.eventsLoading}</p>
      ) : eventsError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {eventsError}
        </p>
      ) : events.length === 0 ? (
        <p className="text-sm text-zinc-500">{d.eventsEmpty}</p>
      ) : (
        <div className="flex max-w-xl flex-col gap-1">
          <label
            htmlFor={eventSelectId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.eventLabel}
          </label>
          <select
            id={eventSelectId}
            value={eventId}
            onChange={(changeEvent) => chooseEvent(changeEvent.target.value)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">{d.eventPlaceholder}</option>
            {events.map((row) => (
              <option key={row.id} value={row.id}>
                {d.eventOption(row.title, row.startsAt.slice(0, 10))}
              </option>
            ))}
          </select>
          {event && (
            <p className="text-xs text-zinc-500">
              {d.audienceLine(d.audience[event.audience])}
            </p>
          )}
        </div>
      )}

      {notice && (
        <p
          role="status"
          className="rounded-md bg-emerald-100 px-4 py-2 text-sm text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
        >
          {notice}
        </p>
      )}

      {!event ? (
        !eventsLoading && events.length > 0 && (
          <p className="text-sm text-zinc-500">{d.chooseEventHint}</p>
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* ---------------------------------------------------------
                Price editor.
                --------------------------------------------------------- */}
            <form
              onSubmit={savePrice}
              className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              aria-label={d.price.heading}
            >
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {d.price.heading}
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {price
                  ? d.price.current(
                      formatMoneyValue(price.amountMinor, price.currency),
                      price.dueInDays,
                      price.graceDays,
                    )
                  : d.price.notForSale}
              </p>
              <Input
                label={d.price.amountLabel(price?.currency ?? currency?.code ?? '')}
                value={priceAmount}
                inputMode="decimal"
                onChange={(changeEvent) => setPriceAmount(changeEvent.target.value)}
                error={priceFieldErrors.amount}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label={d.price.dueInDaysLabel}
                  value={priceDueIn}
                  inputMode="numeric"
                  onChange={(changeEvent) => setPriceDueIn(changeEvent.target.value)}
                  error={priceFieldErrors.dueIn}
                />
                <Input
                  label={d.price.graceDaysLabel}
                  value={priceGrace}
                  inputMode="numeric"
                  onChange={(changeEvent) => setPriceGrace(changeEvent.target.value)}
                  error={priceFieldErrors.grace}
                />
              </div>
              {priceError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {priceError}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                {price && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={priceBusy}
                    onClick={() => void clearPrice()}
                  >
                    {d.price.clear}
                  </Button>
                )}
                <Button type="submit" variant="primary" size="sm" disabled={priceBusy}>
                  {d.price.save}
                </Button>
              </div>
            </form>

            {/* ---------------------------------------------------------
                Summary — this event's charges only.
                --------------------------------------------------------- */}
            <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {d.summary.heading}
              </h3>
              {summaryError ? (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {summaryError}
                </p>
              ) : summary ? (
                <>
                  <dl className="grid grid-cols-2 gap-3">
                    {(
                      [
                        ['charged', summary.chargedMinor],
                        ['adjustments', summary.adjustmentsMinor],
                        ['received', summary.receivedMinor],
                        ['outstanding', summary.outstandingMinor],
                      ] as const
                    ).map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          {d.summary[key]}
                        </dt>
                        <dd
                          data-testid={`extras-summary-${key}`}
                          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
                        >
                          <Money amountMinor={value} currency={currency} code={summary.currency} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-zinc-500">
                    {d.summary.counts(summary.counts.open, summary.counts.paid, summary.counts.void)}
                  </p>
                </>
              ) : (
                <Spinner className="h-5 w-5 text-zinc-400" />
              )}
            </section>
          </div>

          {/* ---------------------------------------------------------------
              Charge list with the ledger actions.
              --------------------------------------------------------------- */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {d.charges.heading}
                </h3>
                <p className="text-xs text-zinc-500">{d.charges.count(charges.length)}</p>
              </div>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => {
                  setNotice(null);
                  setChargeOpen(true);
                }}
              >
                {d.chargeButton}
              </Button>
            </div>

            {chargesLoading ? (
              <div className="flex justify-center py-8">
                <Spinner className="h-6 w-6 text-zinc-400" />
              </div>
            ) : chargesError ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {chargesError}
              </p>
            ) : charges.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">{d.charges.empty}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow isHoverable={false}>
                      <TableCell isHeader>{d.charges.columns.charge}</TableCell>
                      <TableCell isHeader>{d.charges.columns.student}</TableCell>
                      <TableCell isHeader>{d.charges.columns.due}</TableCell>
                      <TableCell isHeader>{d.charges.columns.status}</TableCell>
                      <TableCell isHeader>{d.charges.columns.amount}</TableCell>
                      <TableCell isHeader>{d.charges.columns.balance}</TableCell>
                      <TableCell isHeader>{d.charges.columns.terms}</TableCell>
                      <TableCell isHeader>{d.charges.columns.details}</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {charges.map((charge) => {
                      const isOpen = expanded === charge.id;
                      const reference = shortRef(charge.id);
                      return [
                        <TableRow key={charge.id}>
                          <TableCell className="font-mono text-xs">{reference}</TableCell>
                          <TableCell>{nameOf(charge.userId)}</TableCell>
                          <TableCell>{charge.dueDate}</TableCell>
                          <TableCell>{d.charges.status[charge.status]}</TableCell>
                          <TableCell>
                            <Money
                              amountMinor={charge.amountMinor}
                              currency={currency}
                              code={charge.currency}
                            />
                          </TableCell>
                          <TableCell>
                            <Money
                              amountMinor={charge.balanceMinor}
                              currency={currency}
                              code={charge.currency}
                            />
                          </TableCell>
                          <TableCell>
                            {charge.termsSource === 'negotiated'
                              ? d.charges.negotiated
                              : d.charges.standard}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => toggle(charge)}
                              aria-expanded={isOpen}
                              aria-label={
                                isOpen
                                  ? d.charges.collapseAriaLabel(reference)
                                  : d.charges.expandAriaLabel(reference)
                              }
                            >
                              {ledger.expandButton}
                            </Button>
                          </TableCell>
                        </TableRow>,
                        isOpen ? (
                          <TableRow key={`${charge.id}-entries`} isHoverable={false}>
                            <td
                              className="bg-zinc-50 px-4 py-3 text-left dark:bg-zinc-900/60"
                              colSpan={8}
                            >
                              {renderDetail(charge)}
                            </td>
                          </TableRow>
                        ) : null,
                      ];
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}

      {writeDraft?.action === 'payment' && (
        <PaymentForm
          invoice={writeDraft.charge}
          kind="charge"
          currency={currency}
          onClose={() => setWriteDraft(null)}
          onRecorded={() => afterWrite(writeDraft.charge.id, d.paymentSuccess)}
        />
      )}

      {writeDraft?.action === 'adjustment' && (
        <AdjustmentForm
          invoice={writeDraft.charge}
          kind="charge"
          currency={currency}
          onClose={() => setWriteDraft(null)}
          onApplied={() => afterWrite(writeDraft.charge.id, d.adjustmentSuccess)}
        />
      )}

      {writeDraft?.action === 'void' && (
        <VoidInvoiceForm
          invoice={writeDraft.charge}
          kind="charge"
          onClose={() => setWriteDraft(null)}
          onVoided={() => afterWrite(writeDraft.charge.id, d.voidCharge.success)}
        />
      )}

      {reverseDraft && (
        <ReversePaymentForm
          paymentId={reverseDraft.paymentId}
          kind="charge"
          onClose={() => setReverseDraft(null)}
          onReversed={() => afterWrite(reverseDraft.chargeId, d.reverseSuccess)}
        />
      )}

      {chargeOpen && event && (
        <ChargeDialog
          event={event}
          price={price}
          currency={currency}
          people={students}
          onClose={() => setChargeOpen(false)}
          onCharged={() => setRefreshToken((token) => token + 1)}
        />
      )}
    </section>
  );
}
