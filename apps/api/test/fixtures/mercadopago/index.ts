/**
 * Loader for the Mercado Pago fixtures of this directory (see `README.md`).
 *
 * Every body is handed out as **raw text**, exactly as the provider wrote it:
 * the adapter reads amounts from the characters of the response, so a fixture
 * that went through `JSON.parse` + `JSON.stringify` would test nothing. A file
 * whose name starts with `derived-` was never observed — the README says what
 * each one was built from.
 */
import type { ProviderPayment } from '@arenaquest/shared/ports/i-payment-gateway';

const RAW = import.meta.glob('./*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The raw text of one fixture file, by its name without `.json`. */
export function mpFixture(name: string): string {
  const text = RAW[`./${name}.json`];
  if (text === undefined) throw new Error(`no Mercado Pago fixture named '${name}'`);
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** The secret every `derived-webhook-*` delivery is signed with. Made up for the fixtures; not a credential. */
export const MP_FIXTURE_WEBHOOK_SECRET = 'fixture-only-webhook-secret';

/** The access token the specs hand the adapter. Made up; deliberately shaped like no real key. */
export const MP_FIXTURE_ACCESS_TOKEN = 'fixture-only-access-token';

/** The instant the derived deliveries are stamped with (`ts` of their `x-signature`). */
export const MP_FIXTURE_WEBHOOK_AT = new Date('2026-11-27T13:33:21.000Z');

export interface MpDelivery {
  query: Record<string, string>;
  headers: Record<string, string>;
  /** The request body, byte for byte. */
  body: string;
}

/** One `derived-webhook-*` delivery: query, lower-cased headers and raw body. */
export function mpDelivery(name: string): MpDelivery {
  const { query, headers, body } = JSON.parse(mpFixture(name)) as MpDelivery;
  return { query: { ...query }, headers: { ...headers }, body };
}

/**
 * Signs a delivery the way the provider documents it — HMAC-SHA256 over
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — for the cases a static
 * file cannot hold (another secret, another instant, a second notification).
 */
export async function signMpDelivery(input: {
  dataId: string;
  requestId: string;
  ts: string;
  secret?: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(input.secret ?? MP_FIXTURE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${input.ts};`;
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(manifest)));
  return `ts=${input.ts},v1=${[...mac].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

/** What the adapter must make of each payment fixture — recorded and derived alike. */
export const MP_EXPECTED_PAYMENTS: Readonly<Record<string, ProviderPayment>> = {
  'payment-approved-account-money': {
    id: '191919776844',
    status: 'paid',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'other',
    methodLabel: 'account_money',
    paidAt: '2026-11-27T12:54:38.000Z',
    checkoutId: 'aqrec-1795783752-A-approved-keep',
    refunds: [],
  },
  'payment-partially-refunded': {
    id: '191919776844',
    status: 'paid',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'other',
    methodLabel: 'account_money',
    paidAt: '2026-11-27T12:54:38.000Z',
    checkoutId: 'aqrec-1795783752-A-approved-keep',
    refunds: [{ id: '3546618035', amountMinor: 234, createdAt: '2026-11-27T13:12:38.000Z' }],
  },
  'payment-refunded': {
    id: '191919776844',
    status: 'refunded',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'other',
    methodLabel: 'account_money',
    paidAt: '2026-11-27T12:54:38.000Z',
    checkoutId: 'aqrec-1795783752-A-approved-keep',
    refunds: [
      { id: '3546618035', amountMinor: 234, createdAt: '2026-11-27T13:12:38.000Z' },
      { id: '3611872278', amountMinor: 1000, createdAt: '2026-11-27T13:13:03.000Z' },
    ],
  },
  'derived-payment-refunded-single-refund': {
    id: '191919776844',
    status: 'refunded',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'other',
    methodLabel: 'account_money',
    paidAt: '2026-11-27T12:54:38.000Z',
    checkoutId: 'aqrec-1795783752-A-approved-keep',
    refunds: [{ id: '3611872278', amountMinor: 1234, createdAt: '2026-11-27T13:13:03.000Z' }],
  },
  'payment-approved-card': {
    id: '191926322032',
    status: 'paid',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'card',
    methodLabel: 'credit_card/visa',
    paidAt: '2026-11-27T13:33:20.000Z',
    checkoutId: 'aqrec-1795785192-E-card-approved',
    refunds: [],
  },
  'payment-pending-boleto': {
    id: '191927173452',
    status: 'pending',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'boleto',
    methodLabel: 'ticket/bolbradesco',
    paidAt: null,
    checkoutId: 'aqrec-1795785652-G-boleto-pending',
    refunds: [],
  },
  'payment-approved-foreign-reference': {
    id: '190809194863',
    status: 'paid',
    amountMinor: 100000,
    currency: 'BRL',
    method: 'other',
    methodLabel: 'account_money',
    paidAt: '2026-11-27T13:02:16.000Z',
    checkoutId: 'dsb_payment_1bfb615b-110b-4194-a451-eeebe858d147',
    refunds: [],
  },
  // Recorded 2026-11-27 (M30 Task 17): a card refused by the issuer, a card left
  // `in_process`, and the approved payment made on that same second reference.
  'payment-rejected-card': {
    id: '190826471009',
    status: 'failed',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'card',
    methodLabel: 'credit_card/master',
    paidAt: null,
    checkoutId: 'aqrec-1795786713-H-card-rejected',
    refunds: [],
  },
  'payment-in-process-card': {
    id: '190829854493',
    status: 'pending',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'card',
    methodLabel: 'credit_card/master',
    paidAt: null,
    checkoutId: 'aqrec-1795786714-I-card-pending',
    refunds: [],
  },
  'payment-approved-card-same-reference': {
    id: '191937009326',
    status: 'paid',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'card',
    methodLabel: 'credit_card/visa',
    paidAt: '2026-11-27T14:24:19.000Z',
    checkoutId: 'aqrec-1795786714-I-card-pending',
    refunds: [],
  },
  // A payment in another currency is read, not refused: the service settles it as a mismatch.
  'derived-payment-usd': {
    id: '191926322032',
    status: 'paid',
    amountMinor: 1234,
    currency: 'USD',
    method: 'card',
    methodLabel: 'credit_card/visa',
    paidAt: '2026-11-27T13:33:20.000Z',
    checkoutId: 'aqrec-1795785192-E-card-approved',
    refunds: [],
  },
  'derived-payment-charged-back': {
    id: '191926322032',
    status: 'disputed',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'card',
    methodLabel: 'credit_card/visa',
    paidAt: '2026-11-27T13:33:20.000Z',
    checkoutId: 'aqrec-1795785192-E-card-approved',
    refunds: [],
  },
  'derived-payment-approved-pix': {
    id: '191919776901',
    status: 'paid',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'pix',
    methodLabel: 'bank_transfer/pix',
    paidAt: '2026-11-27T12:54:38.000Z',
    checkoutId: 'aqrec-derived-P-pix',
    refunds: [],
  },
  'derived-payment-pending-pix': {
    id: '191919776901',
    status: 'pending',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'pix',
    methodLabel: 'bank_transfer/pix',
    paidAt: null,
    checkoutId: 'aqrec-derived-P-pix',
    refunds: [],
  },
  'derived-payment-cancelled-expired': {
    id: '191927173452',
    status: 'expired',
    amountMinor: 1234,
    currency: 'BRL',
    method: 'boleto',
    methodLabel: 'ticket/bolbradesco',
    paidAt: null,
    checkoutId: 'aqrec-1795785652-G-boleto-pending',
    refunds: [],
  },
};

// ---------------------------------------------------------------------------
// A scripted `fetch` — the provider, played back from the fixtures
// ---------------------------------------------------------------------------

export interface MpCall {
  method: string;
  /** Path and query, without the API origin. */
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface MpReply {
  status: number;
  /** Raw response text — usually `mpFixture(name)`. */
  body: string;
}

export type MpRoute = MpReply | Error | ((call: MpCall) => MpReply | Error | Promise<MpReply | Error>);

export interface MpFakeProvider {
  fetch: typeof fetch;
  calls: MpCall[];
  /** Answers `METHOD /path` (query included, matched exactly) from now on. */
  on(method: 'GET' | 'POST', path: string, route: MpRoute): MpFakeProvider;
}

const API_ORIGIN = 'https://api.mercadopago.com';

/**
 * A `fetch` that answers only what it was told to: a call to any other URL —
 * or to another origin — fails the test loudly instead of reaching a network.
 */
export function mpFakeProvider(): MpFakeProvider {
  const routes = new Map<string, MpRoute>();
  const calls: MpCall[] = [];
  const provider: MpFakeProvider = {
    calls,
    on(method, path, route) {
      routes.set(`${method} ${path}`, route);
      return provider;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith(`${API_ORIGIN}/`)) throw new Error(`unexpected origin in a provider call: ${url}`);
      const call: MpCall = {
        method: init?.method ?? 'GET',
        path: url.slice(API_ORIGIN.length),
        headers: { ...(init?.headers as Record<string, string> | undefined) },
        body: typeof init?.body === 'string' ? init.body : null,
      };
      calls.push(call);
      const route = routes.get(`${call.method} ${call.path}`);
      if (route === undefined) throw new Error(`no fixture route for ${call.method} ${call.path}`);
      const reply = typeof route === 'function' ? await route(call) : route;
      if (reply instanceof Error) throw reply;
      return new Response(reply.body, { status: reply.status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
  };
  return provider;
}

/** A reply built from a fixture file. */
export function mpReply(status: number, fixtureName: string): MpReply {
  return { status, body: mpFixture(fixtureName) };
}
