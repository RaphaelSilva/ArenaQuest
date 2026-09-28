import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

/**
 * The two-rail roster over HTTP (RFC 0015 §4): `GET /v1/admin/billing/students`
 * against real D1, with every row written through the public endpoints.
 *
 * - `PAID_UP` pays the monthly fee and owes an overdue extra.
 * - `LATE` owes the monthly fee and has paid every extra.
 * - `BUYER` never signed a contract and owes an overdue extra.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ADMIN_ID = 'roster-admin';
const PAID_UP = 'roster-paid-up';
const LATE = 'roster-late';
const BUYER = 'roster-buyer';
const EVENT = 'roster-event';

let adminToken: string;

/** `YYYY-MM-DD`, `days` before today. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function billing(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${adminToken}` };
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

interface Rail {
  standing: string;
  oldestOverdueDate: string | null;
  outstandingMinor: number;
}
interface RosterEntry {
  userId: string;
  asOf: string;
  currency: string;
  contract: (Rail & { id: string; groupId: string; status: string }) | null;
  extras: (Rail & { openCharges: number; overdueCharges: number }) | null;
  hold: { reason: string } | null;
}

const roster = async (query = ''): Promise<RosterEntry[]> =>
  jsonOf<RosterEntry[]>(await billing('GET', `/students${query}`), 200);

const ids = async (query: string): Promise<string[]> =>
  (await roster(query)).map((entry) => entry.userId).sort();

const entryOf = async (userId: string, query = ''): Promise<RosterEntry> =>
  (await roster(query)).find((entry) => entry.userId === userId)!;

/** Filters that must answer the same with or without the charge tables populated. */
const CONTRACT_FILTERS = [
  '?contractStanding=delinquent',
  '?standing=delinquent',
  '?contractStanding=good',
  '?standing=good',
  '?contractStanding=exempt',
];
let withoutCharges: string[][];

beforeAll(async () => {
  await applyMigrations(env.DB);

  await env.DB.batch([
    ...[ADMIN_ID, PAID_UP, LATE, BUYER].map((id) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      ).bind(id, id, `${id}@roster.test`, 'hash'),
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO events (id, slug, title, starts_at, status, audience, created_by)
       VALUES (?, ?, 'Seminar', '2030-01-01 19:00:00', 'published', 'members', ?)`,
    ).bind(EVENT, EVENT, ADMIN_ID),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  adminToken = await adapter.signAccessToken({
    sub: ADMIN_ID,
    email: 'admin@roster.test',
    roles: ['admin'],
  });

  // Contracts: both students owe one invoice, due 60 days ago; PAID_UP pays it.
  const plan = await jsonOf<{ id: string }>(
    await billing('POST', '/plans', {
      name: 'Roster plan',
      amountMinor: 15000,
      currency: 'BRL',
      cycle: 'monthly',
      graceDays: 5,
    }),
    201,
  );
  for (const userId of [PAID_UP, LATE]) {
    const contract = await jsonOf<{ id: string }>(
      await billing('POST', '/subscriptions', {
        userId,
        planId: plan.id,
        dueDay: 10,
        startDate: '2026-01-01',
      }),
      201,
    );
    const invoice = await jsonOf<{ id: string }>(
      await billing('POST', '/invoices', {
        subscriptionId: contract.id,
        dueDate: daysAgo(60),
        referenceDate: '2026-01-01',
      }),
      201,
    );
    if (userId === PAID_UP) {
      await jsonOf(
        await billing('POST', `/invoices/${invoice.id}/payments`, {
          amountMinor: 15000,
          method: 'pix',
        }),
        201,
      );
    }
  }

  // The contract-rail answer before a single charge exists.
  withoutCharges = await Promise.all(CONTRACT_FILTERS.map(ids));

  // Extras: every user charged, due 30 days ago; LATE pays theirs.
  await jsonOf(await billing('PUT', `/event-prices/${EVENT}`, { amountMinor: 8000, graceDays: 5 }), 200);
  const issued = await jsonOf<{ created: { id: string; userId: string }[] }>(
    await billing('POST', '/charges', {
      eventId: EVENT,
      userIds: [PAID_UP, LATE, BUYER],
      dueDate: daysAgo(30),
    }),
    201,
  );
  const lateCharge = issued.created.find((charge) => charge.userId === LATE)!;
  await jsonOf(
    await billing('POST', `/charges/${lateCharge.id}/payments`, { amountMinor: 8000, method: 'cash' }),
    201,
  );
});

describe('GET /v1/admin/billing/students — two rails', () => {
  it('contract paid-up with an overdue charge: contract good, extras delinquent', async () => {
    const entry = await entryOf(PAID_UP);
    expect(entry.contract).toMatchObject({ standing: 'good', outstandingMinor: 0 });
    expect(entry.extras).toEqual({
      standing: 'delinquent',
      oldestOverdueDate: daysAgo(30),
      outstandingMinor: 8000,
      openCharges: 1,
      overdueCharges: 1,
    });
  });

  it('late invoice with every charge paid: contract delinquent, extras good', async () => {
    const entry = await entryOf(LATE);
    expect(entry.contract).toMatchObject({
      standing: 'delinquent',
      outstandingMinor: 15000,
      oldestOverdueDate: daysAgo(60),
    });
    expect(entry.extras).toMatchObject({ standing: 'good', outstandingMinor: 0, openCharges: 0 });
  });

  it('lists a buyer with no contract', async () => {
    expect(await entryOf(BUYER)).toMatchObject({
      currency: 'BRL',
      contract: null,
      extras: { standing: 'delinquent', outstandingMinor: 8000 },
      hold: null,
    });
  });

  it('carries no top-level standing or total', async () => {
    for (const entry of await roster()) {
      expect(entry).not.toHaveProperty('standing');
      expect(entry).not.toHaveProperty('outstandingMinor');
    }
  });

  it('answers the contract filters exactly as it did with the charge tables empty', async () => {
    expect(await Promise.all(CONTRACT_FILTERS.map(ids))).toEqual(withoutCharges);
    expect(await ids('?contractStanding=delinquent')).toEqual([LATE]);
    expect(await ids('?standing=delinquent')).toEqual([LATE]);
  });

  it('filters the extras rail independently, and both rails together', async () => {
    expect(await ids('?extrasStanding=delinquent')).toEqual([BUYER, PAID_UP].sort());
    expect(await ids('?extrasStanding=good')).toEqual([LATE]);
    expect(await ids('?contractStanding=delinquent&extrasStanding=delinquent')).toEqual([]);
    expect(await ids('?contractStanding=good&extrasStanding=delinquent')).toEqual([PAID_UP]);
  });

  it('rejects an unknown standing and a legacy filter contradicting the new one', async () => {
    expect((await billing('GET', '/students?extrasStanding=late')).status).toBe(400);
    expect(
      (await billing('GET', '/students?standing=good&contractStanding=delinquent')).status,
    ).toBe(400);
  });

  it('a hold turns the contract exempt and leaves extras unchanged', async () => {
    const before = await entryOf(LATE);
    await jsonOf(await billing('POST', `/holds/${LATE}`, { reason: 'Agreed to wait.' }), 201);
    const heldBuyer = await jsonOf(
      await billing('POST', `/holds/${PAID_UP}`, { reason: 'Talk first.' }),
      201,
    );
    expect(heldBuyer).toBeTruthy();

    const late = await entryOf(LATE);
    expect(late.contract!.standing).toBe('exempt');
    expect(late.extras).toEqual(before.extras);

    // A hold never makes an overdue extra exempt.
    const paidUp = await entryOf(PAID_UP);
    expect(paidUp.extras!.standing).toBe('delinquent');
    expect(await ids('?extrasStanding=exempt')).toEqual([]);
    expect(await ids('?contractStanding=exempt')).toEqual([LATE, PAID_UP].sort());

    await billing('DELETE', `/holds/${LATE}`);
    await billing('DELETE', `/holds/${PAID_UP}`);
  });
});
