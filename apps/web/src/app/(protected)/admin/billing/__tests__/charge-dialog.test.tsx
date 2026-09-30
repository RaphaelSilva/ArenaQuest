import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingEventPrice,
  BillingReportCurrency,
  IssueEventChargesResult,
} from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport, type TransportHandler } from './test-transport';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let http: ReturnType<typeof makeTransport>;
let client: {
  adminBilling: ReturnType<typeof createAdminBillingApi>;
  adminGroups: {
    list: ReturnType<typeof vi.fn>;
    listMembers: ReturnType<typeof vi.fn>;
  };
  adminUsers: { create: ReturnType<typeof vi.fn> };
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import { ChargeDialog, type ChargeableEvent } from '../charge-dialog';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };

const PRICE: BillingEventPrice = {
  eventId: 'ev-1',
  amountMinor: 15000,
  currency: 'BRL',
  dueInDays: 7,
  graceDays: 5,
  updatedBy: 'admin',
  updatedAt: '2026-09-01T00:00:00Z',
};

const PEOPLE = [
  { id: 'u1', name: 'Alice Doe', email: 'alice@dojo.test' },
  { id: 'u2', name: 'Bruno Lima', email: 'bruno@dojo.test' },
  { id: 'u3', name: 'Carla Reis', email: 'carla@dojo.test' },
];

const d = dictEn.admin.billing.extras.dialog;

const onCharged = vi.fn();
const onClose = vi.fn();

function issueResult(): IssueEventChargesResult {
  return {
    created: [
      {
        id: 'ch-1',
        eventId: 'ev-1',
        userId: 'u1',
        description: 'Winter seminar',
        amountMinor: 15000,
        currency: 'BRL',
        termsSource: 'standard',
        termsNote: '',
        dueDate: '2026-09-08',
        graceDays: 5,
        status: 'open',
        issuedBy: 'admin',
        issuedAt: '2026-09-01T00:00:00Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
    absorbed: [{ eventId: 'ev-1', userId: 'u2' }],
    outsideAudience: ['u3'],
  };
}

function setup(handler: TransportHandler) {
  http = makeTransport(handler);
  client = {
    adminBilling: createAdminBillingApi(http as unknown as HttpTransport),
    adminGroups: {
      list: vi.fn(async () => [
        { id: 'g1', name: 'Kids', description: '', memberCount: 2, createdAt: '' },
      ]),
      listMembers: vi.fn(async () => [
        { userId: 'u2', name: 'Bruno Lima', email: 'bruno@dojo.test' },
        { userId: 'u9', name: 'Gabi Nunes', email: 'gabi@dojo.test' },
      ]),
    },
    adminUsers: {
      create: vi.fn(async (input: { name: string; email: string }) => ({
        id: 'u-new',
        name: input.name,
        email: input.email,
      })),
    },
  };
}

function renderDialog(
  event: ChargeableEvent = { id: 'ev-1', title: 'Winter seminar', audience: 'public' },
  price: BillingEventPrice | null = PRICE,
) {
  return render(
    <DictProvider value={dictEn}>
      <ChargeDialog
        event={event}
        price={price}
        currency={BRL}
        people={PEOPLE}
        onClose={onClose}
        onCharged={onCharged}
      />
    </DictProvider>,
  );
}

function check(name: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(name) }));
}

const postsTo = (path: string) =>
  http.mock.calls.filter(([method, url]) => method === 'POST' && url === path);

describe('ChargeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup((method, path) => {
      if (method === 'POST' && path === '/admin/billing/charges') return issueResult();
      if (path.includes('/audience-check')) {
        return { eventId: 'ev-1', audience: 'restricted', outsideAudience: ['u3'] };
      }
      return {};
    });
  });

  it('charges three users in one request and groups the result', async () => {
    renderDialog();
    check('Alice Doe');
    check('Bruno Lima');
    check('Carla Reis');
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() => expect(postsTo('/admin/billing/charges')).toHaveLength(1));
    const [, , options] = postsTo('/admin/billing/charges')[0];
    expect(JSON.parse(options!.body!)).toEqual({ eventId: 'ev-1', userIds: ['u1', 'u2', 'u3'] });

    const created = await screen.findByRole('heading', { name: d.result.created(1) });
    expect(within(created.parentElement!).getByText('Alice Doe')).toBeInTheDocument();
    const absorbed = screen.getByRole('heading', { name: d.result.absorbed(1) });
    expect(within(absorbed.parentElement!).getByText('Bruno Lima')).toBeInTheDocument();
    const outside = screen.getByRole('heading', { name: d.result.outsideAudience(1) });
    expect(within(outside.parentElement!).getByText('Carla Reis')).toBeInTheDocument();
    expect(onCharged).toHaveBeenCalledTimes(1);
  });

  it('flags a selected user outside a restricted audience and keeps submit enabled', async () => {
    renderDialog({ id: 'ev-1', title: 'Winter seminar', audience: 'restricted' });
    check('Alice Doe');
    check('Carla Reis');

    const flagged = await screen.findByTestId('selected-u3');
    await waitFor(() => expect(within(flagged).getByText(d.audienceWarning)).toBeInTheDocument());
    expect(within(flagged).getByRole('link', { name: d.audienceLink })).toHaveAttribute(
      'href',
      '/admin/events/ev-1',
    );
    expect(within(screen.getByTestId('selected-u1')).queryByText(d.audienceWarning)).toBeNull();
    expect(screen.getByText(d.audienceSummary(1))).toBeInTheDocument();

    const lastCheck = http.mock.calls.filter(([, url]) => url.includes('/audience-check')).at(-1)!;
    expect(lastCheck[1]).toBe('/admin/billing/events/ev-1/audience-check?userIds=u1%2Cu3');

    const submit = screen.getByRole('button', { name: d.submit });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(postsTo('/admin/billing/charges')).toHaveLength(1));
  });

  it('never checks the audience of a public event', async () => {
    renderDialog();
    check('Alice Doe');
    await screen.findByTestId('selected-u1');
    expect(http.mock.calls.some(([, url]) => url.includes('/audience-check'))).toBe(false);
  });

  it('blocks a negotiated amount without a note, then sends it with one', async () => {
    renderDialog();
    check('Alice Doe');
    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '120.00' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(d.validation.noteRequired)).toBeInTheDocument();
    expect(postsTo('/admin/billing/charges')).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText(d.notePlaceholder), {
      target: { value: 'Sibling discount' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));
    await waitFor(() => expect(postsTo('/admin/billing/charges')).toHaveLength(1));
    expect(JSON.parse(postsTo('/admin/billing/charges')[0][2]!.body!)).toEqual({
      eventId: 'ev-1',
      userIds: ['u1'],
      amountMinor: 12000,
      termsNote: 'Sibling discount',
    });
  });

  it('accepts the price typed explicitly without a note', async () => {
    renderDialog();
    check('Alice Doe');
    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));
    await waitFor(() => expect(postsTo('/admin/billing/charges')).toHaveLength(1));
  });

  it('demands an amount when the event has no price', async () => {
    renderDialog(undefined, null);
    check('Alice Doe');
    fireEvent.click(screen.getByRole('button', { name: d.submit }));
    expect(await screen.findByText(d.validation.amountRequired)).toBeInTheDocument();
    expect(postsTo('/admin/billing/charges')).toHaveLength(0);
  });

  it('refuses to submit an empty selection', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: d.submit }));
    expect(await screen.findByText(d.validation.noSelection)).toBeInTheDocument();
    expect(postsTo('/admin/billing/charges')).toHaveLength(0);
  });

  it('expands a group into its members, client-side', async () => {
    renderDialog();
    await screen.findByRole('option', { name: 'Kids' });
    fireEvent.change(screen.getByLabelText(d.groupLabel), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: d.groupAdd }));

    expect(await screen.findByText(d.groupAdded(2, 'Kids'))).toBeInTheDocument();
    expect(screen.getByTestId('selected-u2')).toBeInTheDocument();
    expect(screen.getByTestId('selected-u9')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: d.submit }));
    await waitFor(() => expect(postsTo('/admin/billing/charges')).toHaveLength(1));
    expect(JSON.parse(postsTo('/admin/billing/charges')[0][2]!.body!).userIds).toEqual([
      'u2',
      'u9',
    ]);
  });

  it('creates a user for a lead and selects them', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: d.createUser.toggle }));
    fireEvent.change(screen.getByLabelText(d.createUser.nameLabel), {
      target: { value: 'New Lead' },
    });
    fireEvent.change(screen.getByLabelText(d.createUser.emailLabel), {
      target: { value: 'lead@dojo.test' },
    });
    fireEvent.change(screen.getByLabelText(d.createUser.passwordLabel), {
      target: { value: 'Temp1234!' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.createUser.submit }));

    expect(await screen.findByText(d.createUser.created('New Lead'))).toBeInTheDocument();
    expect(client.adminUsers.create).toHaveBeenCalledWith({
      name: 'New Lead',
      email: 'lead@dojo.test',
      password: 'Temp1234!',
    });
    expect(screen.getByTestId('selected-u-new')).toBeInTheDocument();
  });
});
