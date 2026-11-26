import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { dictPt } from '@web/i18n/dict-pt';
import { createMeBillingApi } from '@web/lib/me-billing-api';
import type { CheckoutErrorKind, PayOption, PendingCheckout } from '@web/lib/me-billing-api';
import {
  ONE_PROVIDER,
  TWO_PROVIDERS,
  checkoutSession,
  emptyStatement,
  makeBillingTransport,
  pendingCheckout,
} from './statement-fixture';

let client: { meBilling: ReturnType<typeof createMeBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import { PayAction, formatExpiry, isPayable } from '../pay-action';

const d = dictEn.settings.billing.pay;
const LOCALE = dictEn.settings.billing.locale;

type Handlers = Parameters<typeof makeBillingTransport>[0];

function fakeTab() {
  return { closed: false, opener: {} as unknown, close: vi.fn(), location: { replace: vi.fn() } };
}

let tab: ReturnType<typeof fakeTab> | null;
let openSpy: ReturnType<typeof vi.fn>;

function mount(
  props: { payOptions: PayOption[]; pendingCheckout?: PendingCheckout | null },
  createCheckout: Handlers['createCheckout'] = () => ({ status: 201, body: checkoutSession() }),
) {
  const http = makeBillingTransport({ statement: () => emptyStatement(), createCheckout });
  client = { meBilling: createMeBillingApi(http, { wait: async () => {} }) };
  const onChanged = vi.fn();
  const view = render(
    <DictProvider value={dictEn}>
      <PayAction
        kind="invoice"
        id="inv1"
        payOptions={props.payOptions}
        pendingCheckout={props.pendingCheckout ?? null}
        onChanged={onChanged}
      />
    </DictProvider>,
  );
  return { http, onChanged, view };
}

const posts = (http: ReturnType<typeof makeBillingTransport>) =>
  http.mock.calls
    .filter(([method]) => method === 'POST')
    .map(([, , options]) => JSON.parse(String(options?.body)) as Record<string, unknown>);

beforeEach(() => {
  tab = fakeTab();
  openSpy = vi.fn(() => tab as unknown as Window);
  vi.spyOn(window, 'open').mockImplementation(openSpy as unknown as typeof window.open);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PayAction — what is offered', () => {
  it('renders nothing when no provider offers a method', () => {
    const { view } = mount({ payOptions: [] });
    expect(view.container).toBeEmptyDOMElement();
  });

  it('renders nothing with no option even while a checkout is pending', () => {
    const { view } = mount({ payOptions: [], pendingCheckout: pendingCheckout() });
    expect(view.container).toBeEmptyDOMElement();
  });

  it('shows one Pay button with one provider', () => {
    mount({ payOptions: ONE_PROVIDER });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: d.action })).toBeEnabled();
  });

  it('labels a choice by its methods, in the API order, never by the provider name', () => {
    const { view } = mount({ payOptions: TWO_PROVIDERS });
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual([d.payWith(d.method.pix), d.payWith(d.method.card)]);
    expect(view.container.textContent).not.toMatch(/mercadopago|stripe/i);
  });

  it('joins the methods of a provider that offers several', () => {
    mount({
      payOptions: [
        { provider: 'mercadopago', methods: ['pix', 'card'] },
        { provider: 'asaas', methods: ['boleto'] },
      ],
    });
    expect(
      screen.getByRole('button', {
        name: d.payWith(`${d.method.pix}${d.methodSeparator}${d.method.card}`),
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.payWith(d.method.boleto) })).toBeInTheDocument();
  });

  it('gives every action a touch target of at least 44 px', () => {
    mount({ payOptions: TWO_PROVIDERS });
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveStyle({ minHeight: '44px' });
    }
  });

  it('reads the Portuguese dictionary too', () => {
    const http = makeBillingTransport({ statement: () => emptyStatement() });
    client = { meBilling: createMeBillingApi(http) };
    render(
      <DictProvider value={dictPt}>
        <PayAction kind="invoice" id="inv1" payOptions={TWO_PROVIDERS} pendingCheckout={null} />
      </DictProvider>,
    );
    const pt = dictPt.settings.billing.pay;
    expect(screen.getByRole('button', { name: pt.payWith(pt.method.card) })).toBeInTheDocument();
  });
});

describe('PayAction — paying', () => {
  it('opens a blank tab inside the click, then sends it to the hosted page', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { http, onChanged } = mount({ payOptions: ONE_PROVIDER }, async () => {
      await gate;
      return { status: 201, body: checkoutSession() };
    });

    fireEvent.click(screen.getByRole('button', { name: d.action }));

    // Synchronously — before the API has answered — so it is a user gesture.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(tab?.location.replace).not.toHaveBeenCalled();
    expect(screen.getByText(d.opening)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.action })).toBeDisabled();

    await act(async () => {
      release?.();
      await gate;
    });

    await waitFor(() =>
      expect(tab?.location.replace).toHaveBeenCalledWith('https://pay.example.test/checkout/co1'),
    );
    expect(tab?.opener).toBeNull();
    // One provider: none is named in the request.
    expect(posts(http)).toEqual([{ kind: 'invoice', id: 'inv1' }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('turns into "payment in progress" from the answer, without waiting for the statement', async () => {
    mount({ payOptions: ONE_PROVIDER });
    fireEvent.click(screen.getByRole('button', { name: d.action }));
    expect(
      await screen.findByText(d.inProgress(formatExpiry('2099-01-01T12:00:00.000Z', LOCALE))),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.openAgain })).toBeEnabled();
    expect(screen.queryByRole('button', { name: d.action })).not.toBeInTheDocument();
  });

  it('sends the chosen provider when there are several', async () => {
    const { http } = mount({ payOptions: TWO_PROVIDERS }, () => ({
      status: 201,
      body: checkoutSession({ provider: 'stripe' }),
    }));
    fireEvent.click(screen.getByRole('button', { name: d.payWith(d.method.card) }));
    await waitFor(() => expect(tab?.location.replace).toHaveBeenCalled());
    expect(posts(http)).toEqual([{ kind: 'invoice', id: 'inv1', provider: 'stripe' }]);
  });

  it('shows the link to follow when the browser blocked the tab', async () => {
    tab = null;
    mount({ payOptions: ONE_PROVIDER });
    fireEvent.click(screen.getByRole('button', { name: d.action }));

    const link = await screen.findByRole('link', { name: d.blockedLink });
    expect(link).toHaveAttribute('href', 'https://pay.example.test/checkout/co1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(d.blocked, { exact: false })).toBeInTheDocument();
  });

  it('refuses a hosted URL that is not http(s)', async () => {
    const { onChanged } = mount({ payOptions: ONE_PROVIDER }, () => ({
      status: 201,
      body: checkoutSession({ url: 'javascript:alert(1)' }),
    }));
    fireEvent.click(screen.getByRole('button', { name: d.action }));
    expect(await screen.findByRole('alert')).toHaveTextContent(d.errors.unknown);
    expect(tab?.location.replace).not.toHaveBeenCalled();
    expect(tab?.close).toHaveBeenCalled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('PayAction — a checkout already in progress', () => {
  it('shows the expiry and reopens the same checkout through its provider', async () => {
    const pending = pendingCheckout({ expiresAt: '2099-03-04T15:30:00.000Z' });
    const { http } = mount({ payOptions: ONE_PROVIDER, pendingCheckout: pending }, () => ({
      status: 200,
      body: checkoutSession({ expiresAt: pending.expiresAt }),
    }));

    expect(
      screen.getByText(d.inProgress(formatExpiry(pending.expiresAt, LOCALE))),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.action })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: d.openAgain }));
    await waitFor(() =>
      expect(tab?.location.replace).toHaveBeenCalledWith('https://pay.example.test/checkout/co1'),
    );
    expect(posts(http)).toEqual([{ kind: 'invoice', id: 'inv1', provider: 'mercadopago' }]);
  });

  it('keeps the other provider on offer, labelled by method', () => {
    mount({ payOptions: TWO_PROVIDERS, pendingCheckout: pendingCheckout() });
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual([d.openAgain, d.payWith(d.method.card)]);
  });

  it('offers Pay again once the checkout expired', () => {
    mount({
      payOptions: ONE_PROVIDER,
      pendingCheckout: pendingCheckout({ expiresAt: '2020-01-01T00:00:00.000Z' }),
    });
    expect(screen.getByRole('button', { name: d.action })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.openAgain })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('turns back into Pay at the expiry, without a reload', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    mount({
      payOptions: ONE_PROVIDER,
      pendingCheckout: pendingCheckout({ expiresAt: '2026-09-01T12:10:00.000Z' }),
    });
    expect(screen.getByRole('button', { name: d.openAgain })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000 + 50);
    });

    expect(screen.getByRole('button', { name: d.action })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.openAgain })).not.toBeInTheDocument();
  });

  it('does not offer Open again through a provider that no longer offers a method', () => {
    mount({
      payOptions: [{ provider: 'stripe', methods: ['card'] }],
      pendingCheckout: pendingCheckout({ provider: 'mercadopago' }),
    });
    expect(screen.queryByRole('button', { name: d.openAgain })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.payWith(d.method.card) })).toBeInTheDocument();
  });
});

describe('PayAction — refusals', () => {
  const cases: Array<[number, string, CheckoutErrorKind, boolean]> = [
    [409, 'RECEIVABLE_NOT_PAYABLE', 'not_payable', true],
    [409, 'PAYMENTS_UNSUPPORTED_CURRENCY', 'not_payable', true],
    [502, 'PAYMENTS_PROVIDER_ERROR', 'provider_unavailable', false],
    [429, 'TooManyRequests', 'too_many_attempts', false],
    [500, 'PAYMENTS_CONFIG_INVALID', 'configuration', false],
    [409, 'CHECKOUT_IN_PROGRESS', 'in_progress', true],
    [400, 'PAYMENT_PROVIDER_REQUIRED', 'provider_required', true],
    [404, 'NotFound', 'not_found', true],
    [500, 'SOMETHING_ELSE', 'unknown', false],
  ];

  it.each(cases)(
    'explains %i %s and closes the blank tab',
    async (status, code, kind, refreshes) => {
      const { onChanged } = mount({ payOptions: ONE_PROVIDER }, () => ({
        status,
        body: { error: code },
      }));
      fireEvent.click(screen.getByRole('button', { name: d.action }));

      expect(await screen.findByRole('alert')).toHaveTextContent(d.errors[kind]);
      expect(tab?.close).toHaveBeenCalled();
      expect(tab?.location.replace).not.toHaveBeenCalled();
      // The statement is read again exactly when the receivable changed underneath.
      expect(onChanged).toHaveBeenCalledTimes(refreshes ? 1 : 0);
      // And the action is usable again.
      expect(screen.getByRole('button', { name: d.action })).toBeEnabled();
    },
  );

  it('explains a request that never reached the API', async () => {
    const { onChanged } = mount({ payOptions: ONE_PROVIDER }, () => {
      throw new TypeError('network down');
    });
    fireEvent.click(screen.getByRole('button', { name: d.action }));
    expect(await screen.findByRole('alert')).toHaveTextContent(d.errors.unknown);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('has a distinct message for every refusal, in both languages', () => {
    for (const dict of [dictEn, dictPt]) {
      const messages = Object.values(dict.settings.billing.pay.errors);
      expect(new Set(messages).size).toBe(messages.length);
    }
  });
});

describe('isPayable', () => {
  it('is true only for an open receivable with a balance', () => {
    expect(isPayable({ status: 'open', balanceMinor: 1 })).toBe(true);
    expect(isPayable({ status: 'open', balanceMinor: 0 })).toBe(false);
    expect(isPayable({ status: 'paid', balanceMinor: 0 })).toBe(false);
    expect(isPayable({ status: 'void', balanceMinor: 100 })).toBe(false);
  });
});
