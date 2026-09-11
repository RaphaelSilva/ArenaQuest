'use client';

import { useCallback } from 'react';
import { formatMoney } from '@arenaquest/shared/domain/billing/format-money';
import { useDict } from '@web/context/dict-context';
import type { BillingReportCurrency } from '@web/lib/admin-billing-api';

/**
 * The single money renderer for the billing console.
 *
 * Every amount the API returns is an integer count of the currency's minor
 * unit, and the exponent that turns it back into a number travels on
 * `BillingReportCurrency`. `Intl.NumberFormat`'s currency style is never used:
 * it accepts `BTC` and silently renders it to two decimals, which is a wrong
 * number on an accounting screen with no error anywhere. The shared
 * `formatMoney` pins the fraction digits to the exponent the API reported.
 *
 * A row whose currency code is not the one the console resolved is *not*
 * guessed at — its exponent is unknown here, so the amount is withheld rather
 * than rendered at the wrong scale. The API takes the same line: it refuses a
 * report that would span two currencies instead of converting between them.
 */
export function useMoneyFormatter(currency: BillingReportCurrency | null) {
  const dict = useDict();
  const money = dict.admin.billing.money;

  return useCallback(
    (amountMinor: number, code?: string): string => {
      if (!currency) return money.unavailable(code ?? '');
      if (code !== undefined && code !== currency.code) return money.unavailable(code);
      return formatMoney(amountMinor, {
        exponent: currency.exponent,
        symbol: currency.symbol,
        locale: money.locale,
      });
    },
    [currency, money],
  );
}

export function Money({
  amountMinor,
  currency,
  code,
  className,
}: {
  amountMinor: number;
  currency: BillingReportCurrency | null;
  /** The row's own currency code, when it carries one. */
  code?: string;
  className?: string;
}) {
  const format = useMoneyFormatter(currency);
  return <span className={className}>{format(amountMinor, code)}</span>;
}
