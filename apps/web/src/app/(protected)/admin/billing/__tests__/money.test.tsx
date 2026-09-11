import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { BillingReportCurrency } from '@web/lib/admin-billing-api';
import { Money } from '../money';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };
const JPY: BillingReportCurrency = { code: 'JPY', exponent: 0, symbol: '¥' };
const BTC: BillingReportCurrency = { code: 'BTC', exponent: 8, symbol: '₿' };

function renderMoney(amountMinor: number, currency: BillingReportCurrency | null, code?: string) {
  return render(
    <DictProvider value={dictEn}>
      <Money amountMinor={amountMinor} currency={currency} code={code} />
    </DictProvider>,
  );
}

describe('Money', () => {
  it('renders an exponent-2 currency at two decimals', () => {
    renderMoney(150000, BRL);
    expect(screen.getByText('R$ 1,500.00')).toBeInTheDocument();
  });

  it('renders an exponent-0 currency with no decimal separator', () => {
    renderMoney(100000, JPY);
    expect(screen.getByText('¥ 100,000')).toBeInTheDocument();
  });

  // The reason this console never uses `Intl.NumberFormat`'s currency style:
  // it accepts `BTC` and renders this amount as two decimals.
  it('renders an exponent-8 currency at eight decimals', () => {
    renderMoney(100000, BTC);
    expect(screen.getByText('₿ 0.00100000')).toBeInTheDocument();
  });

  it('puts the sign before the symbol on a reversal', () => {
    renderMoney(-5000, BRL);
    expect(screen.getByText('-R$ 50.00')).toBeInTheDocument();
  });

  it('withholds an amount whose currency is not the resolved one, rather than guessing its scale', () => {
    renderMoney(100000, BRL, 'JPY');
    expect(screen.getByText(dictEn.admin.billing.money.unavailable('JPY'))).toBeInTheDocument();
  });

  it('withholds every amount when no currency could be resolved', () => {
    renderMoney(150000, null, 'BRL');
    expect(screen.getByText(dictEn.admin.billing.money.unavailable('BRL'))).toBeInTheDocument();
  });
});
