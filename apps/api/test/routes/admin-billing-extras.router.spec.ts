import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

/**
 * The extras rail over HTTP (RFC 0015 §7): the HTTP statuses of the whole
 * flow, the ADMIN-only guard on every new route, and the promise that no
 * route here touches an enrollment or an audience grant.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ADMIN_ID = 'extras-admin';
const BUYER_A = 'extras-buyer-a';
const BUYER_B = 'extras-buyer-b';
const PUBLISHED = 'extras-event-published';
const RESTRICTED = 'extras-event-restricted';
const DRAFT = 'extras-event-draft';

let adminToken: string;
let creatorToken: string;

interface Charge { id: string; userId: string; status: string; termsSource: string }
interface Payment { id: string }
interface IssueResult {
  created: Charge[];
  absorbed: { eventId: string; userId: string }[];
  outsideAudience: string[];
}

beforeAll(async () => {
  await applyMigrations(env.DB);
  await env.DB.exec('PRAGMA foreign_keys = ON');

  await env.DB.batch([
    ...[ADMIN_ID, BUYER_A, BUYER_B].map((id) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      ).bind(id, id, `${id}@extras.test`, 'hash'),
    ),
    ...[
      [PUBLISHED, 'published', 'members'],
      [RESTRICTED, 'published', 'restricted'],
      [DRAFT, 'draft', 'members'],
    ].map(([id, status, audience]) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO events (id, slug, title, starts_at, status, audience, created_by)
         VALUES (?, ?, 'Seminar', '2030-01-01 19:00:00', ?, ?, ?)`,
      ).bind(id, id, status, audience, ADMIN_ID),
    ),
    env.DB.prepare('INSERT OR IGNORE INTO event_audience_user (event_id, user_id) VALUES (?, ?)').bind(
      RESTRICTED,
      BUYER_A,
    ),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, creatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'admin@extras.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc', email: 'cc@extras.test', roles: ['content_creator'] }),
  ]);
});

async function billing(
  method: string,
  path: string,
  body?: unknown,
  token = adminToken,
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new IncomingRequest(`http://example.com${v1(`/admin/billing${path}`)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function jsonOf<T>(res: Response, expected: number): Promise<T> {
  if (res.status !== expected) {
    throw new Error(`expected ${expected}, got ${res.status}: ${await res.text()}`);
  }
  return res.json<T>();
}

async function accessRowCounts(): Promise<number[]> {
  const tables = ['enrollments_user', 'enrollments_user_group', 'event_audience_user', 'event_audience_group'];
  return Promise.all(
    tables.map(async (table) => {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      return row?.n ?? 0;
    }),
  );
}

describe('/v1/admin/billing extras rail', () => {
  it('runs the whole flow with the right statuses and writes no access row', async () => {
    const before = await accessRowCounts();

    // Price.
    expect((await billing('GET', `/event-prices/${PUBLISHED}`)).status).toBe(404);
    const price = await jsonOf<{ amountMinor: number; currency: string }>(
      await billing('PUT', `/event-prices/${PUBLISHED}`, { amountMinor: 8000, dueInDays: 7, graceDays: 5 }),
      200,
    );
    expect(price).toMatchObject({ amountMinor: 8000, currency: 'BRL' });
    expect((await billing('PUT', `/event-prices/${PUBLISHED}`, { amountMinor: 8000, currency: 'USD' })).status).toBe(400);
    expect((await billing('GET', `/event-prices/${PUBLISHED}`)).status).toBe(200);

    // Idempotent issue: 201 then 200 with every pair absorbed.
    const command = { eventId: PUBLISHED, userIds: [BUYER_A, BUYER_B] };
    const first = await jsonOf<IssueResult>(await billing('POST', '/charges', command), 201);
    expect(first.created).toHaveLength(2);
    expect(first.outsideAudience).toEqual([]);
    const second = await jsonOf<IssueResult>(await billing('POST', '/charges', command), 200);
    expect(second.created).toEqual([]);
    expect(second.absorbed).toHaveLength(2);

    // Draft → 409; negotiated without a note → 400.
    expect((await billing('POST', '/charges', { eventId: DRAFT, userIds: [BUYER_A] })).status).toBe(409);
    await billing('PUT', `/event-prices/${RESTRICTED}`, { amountMinor: 8000 });
    expect(
      (await billing('POST', '/charges', { eventId: RESTRICTED, userIds: [BUYER_B], amountMinor: 1 })).status,
    ).toBe(400);

    // Restricted: warned, not blocked.
    const check = await jsonOf<{ outsideAudience: string[] }>(
      await billing('GET', `/events/${RESTRICTED}/audience-check?userIds=${BUYER_A},${BUYER_B}`),
      200,
    );
    expect(check.outsideAudience).toEqual([BUYER_B]);
    const restricted = await jsonOf<IssueResult>(
      await billing('POST', '/charges', { eventId: RESTRICTED, userIds: [BUYER_A, BUYER_B] }),
      201,
    );
    expect(restricted.outsideAudience).toEqual([BUYER_B]);
    expect(restricted.created).toHaveLength(2);

    // Ledger: pay, reverse, reverse the reversal.
    const charge = first.created.find((c) => c.userId === BUYER_A)!;
    const payment = await jsonOf<Payment>(
      await billing('POST', `/charges/${charge.id}/payments`, { amountMinor: 8000, method: 'pix' }),
      201,
    );
    expect((await billing('POST', `/charges/${charge.id}/void`, { reason: 'Cancelled' })).status).toBe(409);
    const reversal = await jsonOf<Payment>(
      await billing('POST', `/charge-payments/${payment.id}/reverse`, { reason: 'Bounced' }),
      201,
    );
    expect((await billing('POST', `/charge-payments/${reversal.id}/reverse`, { reason: 'x' })).status).toBe(409);

    // Adjustment, detail, list, void.
    const other = first.created.find((c) => c.userId === BUYER_B)!;
    expect(
      (await billing('POST', `/charges/${other.id}/adjustments`, { kind: 'discount', amountMinor: -500, reason: 'Friend' })).status,
    ).toBe(201);
    const detail = await jsonOf<{ payments: Payment[]; balanceMinor: number }>(
      await billing('GET', `/charges/${charge.id}`),
      200,
    );
    expect(detail.payments.map((p) => p.id)).toEqual([payment.id, reversal.id]);
    expect(detail.balanceMinor).toBe(8000);
    expect((await billing('POST', `/charges/${charge.id}/void`, { reason: '' })).status).toBe(400);
    const voided = await jsonOf<Charge>(await billing('POST', `/charges/${charge.id}/void`, { reason: 'No show' }), 200);
    expect(voided.status).toBe('void');
    expect((await billing('POST', `/charges/${charge.id}/payments`, { amountMinor: 1, method: 'cash' })).status).toBe(409);

    const listed = await jsonOf<Charge[]>(await billing('GET', `/charges?eventId=${PUBLISHED}&status=open`), 200);
    expect(listed.map((c) => c.id)).toEqual([other.id]);

    // Summary.
    const summary = await jsonOf<{
      chargedMinor: number;
      adjustmentsMinor: number;
      receivedMinor: number;
      outstandingMinor: number;
      counts: Record<string, number>;
    }>(await billing('GET', `/events/${PUBLISHED}/summary`), 200);
    expect(summary).toMatchObject({
      chargedMinor: 8000,
      adjustmentsMinor: -500,
      receivedMinor: 0,
      outstandingMinor: 7500,
      counts: { open: 1, paid: 0, void: 1 },
    });

    // Clearing the price leaves charges alone.
    expect((await billing('DELETE', `/event-prices/${PUBLISHED}`)).status).toBe(204);
    expect((await billing('DELETE', `/event-prices/${PUBLISHED}`)).status).toBe(404);
    expect((await billing('GET', `/charges/${other.id}`)).status).toBe(200);

    expect(await accessRowCounts()).toEqual(before);
  });

  it('answers validation, not-found and conflict branches', async () => {
    expect((await billing('POST', '/charges', { eventId: PUBLISHED, userIds: [] })).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => `u-${i}`);
    expect((await billing('POST', '/charges', { eventId: PUBLISHED, userIds: many })).status).toBe(400);
    expect((await billing('POST', '/charges', { eventId: PUBLISHED, userIds: [BUYER_A, BUYER_A] })).status).toBe(400);
    expect((await billing('GET', '/charges?status=overdue')).status).toBe(400);
    expect((await billing('PUT', `/event-prices/${PUBLISHED}`, { amountMinor: -1 })).status).toBe(400);
    expect((await billing('GET', `/events/${PUBLISHED}/audience-check?userIds=`)).status).toBe(400);

    expect((await billing('POST', '/charges', { eventId: 'nope', userIds: [BUYER_A] })).status).toBe(404);
    expect((await billing('GET', '/event-prices/nope')).status).toBe(404);
    expect((await billing('GET', '/charges/nope')).status).toBe(404);
    expect((await billing('POST', '/charges/nope/payments', { amountMinor: 1, method: 'cash' })).status).toBe(404);
    expect((await billing('POST', '/charge-payments/nope/reverse', { reason: 'x' })).status).toBe(404);
    expect((await billing('GET', '/events/nope/summary')).status).toBe(404);
    expect((await billing('GET', `/events/nope/audience-check?userIds=${BUYER_A}`)).status).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const request = new IncomingRequest(`http://example.com${v1('/admin/billing/charges')}`);
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it.each([
    ['GET', `/event-prices/${PUBLISHED}`, undefined],
    ['PUT', `/event-prices/${PUBLISHED}`, { amountMinor: 1 }],
    ['DELETE', `/event-prices/${PUBLISHED}`, undefined],
    ['GET', '/charges', undefined],
    ['POST', '/charges', { eventId: PUBLISHED, userIds: [BUYER_A] }],
    ['GET', '/charges/any', undefined],
    ['POST', '/charges/any/void', { reason: 'x' }],
    ['POST', '/charges/any/adjustments', { kind: 'discount', amountMinor: -1, reason: 'x' }],
    ['POST', '/charges/any/payments', { amountMinor: 1, method: 'cash' }],
    ['POST', '/charge-payments/any/reverse', { reason: 'x' }],
    ['GET', `/events/${PUBLISHED}/summary`, undefined],
    ['GET', `/events/${PUBLISHED}/audience-check?userIds=${BUYER_A}`, undefined],
  ])('content_creator gets 403 on %s %s', async (method, path, body) => {
    expect((await billing(method, path, body, creatorToken)).status).toBe(403);
  });
});
