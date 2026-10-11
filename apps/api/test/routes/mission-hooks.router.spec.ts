import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { MissionEvaluator } from '@arenaquest/shared/domain/gamification/mission-evaluator';
import mp4Fixture from '../fixtures/submissions/sample.mp4?inline';
import { insertCharge, insertEvent, insertMedia, insertMission, insertRequirement } from '../db/mission-fixtures';

/**
 * Mission hooks at the evidence write sites (RFC 0022 §3.2; M27 Task 06),
 * through the real routes against a real D1, KV and R2: each hooked write
 * advances (or regresses) its step within the same request, and a failing
 * evaluator never changes the originating status or body.
 *
 * Missions are dated around the real clock, because the routes evaluate at
 * `new Date()`. Storage is isolated per test; the `beforeAll` users, topics and
 * enrollments are shared.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT = 'mh-student';
const ADMIN = 'mh-admin';
// The visit route validates a UUID.
const T_MAIN = '6a1f0c2e-7b3d-4e5f-8a9b-0c1d2e3f4a01';
const T_OTHER = '6a1f0c2e-7b3d-4e5f-8a9b-0c1d2e3f4a02';
const T_PLAIN = '6a1f0c2e-7b3d-4e5f-8a9b-0c1d2e3f4a03';

const DAY = 86_400_000;

let studentToken: string;
let adminToken: string;

type Json = Record<string, any>;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const user = (id: string) =>
    env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, `Name ${id}`, `${id}@mission-hooks.test`, 'hash');
  const topic = (id: string) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO topic_nodes (id, title, status, archived, visibility) VALUES (?, ?, 'published', 0, 'restricted')`,
    ).bind(id, `Title ${id}`);
  const enroll = (topicId: string) =>
    env.DB.prepare(
      'INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind(`enr-${STUDENT}-${topicId}`, STUDENT, topicId, ADMIN);

  await env.DB.batch([
    user(STUDENT),
    user(ADMIN),
    env.DB.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'admin'").bind(ADMIN),
    ...[T_MAIN, T_OTHER, T_PLAIN].map(topic),
    ...[T_MAIN, T_OTHER, T_PLAIN].map(enroll),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [studentToken, adminToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT, email: 's@mission-hooks.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: ADMIN, email: 'a@mission-hooks.test', roles: ['admin'] }),
  ]);
});

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function req(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const MP4 = (() => {
  const base64 = mp4Fixture.slice(mp4Fixture.indexOf(',') + 1);
  return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
})();

/** Presign and simulate the client's PUT; returns the pending submission id. */
async function upload(topicId: string, description = 'How I did it'): Promise<string> {
  const res = await req('POST', `/topics/${topicId}/submissions/presign`, {
    token: studentToken,
    body: { fileName: 'kata.mp4', contentType: 'video/mp4', sizeBytes: MP4.byteLength, title: 'Kata', description },
  });
  expect(res.status).toBe(201);
  const { submission } = (await res.json()) as Json;
  const row = await env.DB.prepare('SELECT storage_key FROM topic_submissions WHERE id = ?')
    .bind(submission.id)
    .first<{ storage_key: string }>();
  await env.R2.put(row!.storage_key, MP4, { httpMetadata: { contentType: 'video/mp4' } });
  return submission.id;
}

const finalize = (topicId: string, sid: string) =>
  req('POST', `/topics/${topicId}/submissions/${sid}/finalize`, { token: studentToken });

/** A ready submission of the student on `topicId`. */
async function ready(topicId: string, description?: string): Promise<string> {
  const sid = await upload(topicId, description);
  expect((await finalize(topicId, sid)).status).toBe(200);
  return sid;
}

/** An active `auto` mission open around now, with its XP reward. */
async function mission(opts: { xpReward?: number; mode?: 'parallel' | 'sequential' } = {}): Promise<string> {
  const id = await insertMission({
    startAt: new Date(Date.now() - DAY).toISOString(),
    endAt: new Date(Date.now() + 30 * DAY).toISOString(),
    mode: opts.mode,
  });
  if (opts.xpReward) await env.DB.prepare('UPDATE missions SET xp_reward = ? WHERE id = ?').bind(opts.xpReward, id).run();
  return id;
}

async function step(
  missionId: string,
  kind: string,
  opts: { topicId?: string; eventId?: string; params?: unknown; xpReward?: number; position?: number } = {},
): Promise<string> {
  const id = await insertRequirement(missionId, opts.position ?? 1, kind, {
    topicId: opts.topicId,
    eventId: opts.eventId,
    params: opts.params,
  });
  if (opts.xpReward) {
    await env.DB.prepare('UPDATE mission_requirements SET xp_reward = ? WHERE id = ?').bind(opts.xpReward, id).run();
  }
  return id;
}

interface StepRow {
  current_count: number;
  completed_at: string | null;
  completed_by: string | null;
}

const progressOf = (requirementId: string, userId = STUDENT) =>
  env.DB.prepare(
    'SELECT current_count, completed_at, completed_by FROM mission_requirement_progress WHERE requirement_id = ? AND user_id = ?',
  )
    .bind(requirementId, userId)
    .first<StepRow>();

const missionCompleted = async (missionId: string) =>
  (
    await env.DB.prepare('SELECT completed FROM mission_progress WHERE user_id = ? AND mission_id = ?')
      .bind(STUDENT, missionId)
      .first<{ completed: number }>()
  )?.completed === 1;

const xpKeys = async () =>
  (
    await env.DB.prepare("SELECT idempotency_key FROM xp_events WHERE user_id = ? AND source_kind LIKE 'mission_%'")
      .bind(STUDENT)
      .all<{ idempotency_key: string }>()
  ).results.map((r) => r.idempotency_key);

/** A published event that started inside every mission window. */
const pastEvent = () => insertEvent(new Date(Date.now() - DAY / 2).toISOString(), ADMIN);

/** A finalize body without the fields that differ between two uploads. */
function shapeOf(body: Json): Json {
  const { id: _id, topicNodeId: _topic, createdAt: _created, updatedAt: _updated, url: _url, ...rest } = body;
  return rest;
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

describe('submission finalize', () => {
  it('the third described ready submission closes a minCount 3 step and its mission in that request', async () => {
    const m = await mission({ xpReward: 50 });
    const r = await step(m, 'submissions_on_topic', {
      topicId: T_MAIN,
      params: { minCount: 3, requireDescription: true },
      xpReward: 20,
    });

    await ready(T_MAIN);
    await ready(T_MAIN);
    // An undescribed one does not count.
    await ready(T_MAIN, '');
    expect(await progressOf(r)).toMatchObject({ current_count: 2, completed_at: null });
    expect(await missionCompleted(m)).toBe(false);

    const sid = await upload(T_MAIN);
    const res = await finalize(T_MAIN, sid);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;

    const row = await progressOf(r);
    expect(row?.completed_at).toEqual(expect.any(String));
    expect(row?.completed_by).toBe('hook');
    expect(await missionCompleted(m)).toBe(true);
    expect((await xpKeys()).sort()).toEqual([`mission_reward:${m}:v1`, `mission_step_reward:${r}:v1`]);

    // Byte-identical to a finalize with no mission involved.
    const plain = await upload(T_PLAIN);
    const plainRes = await finalize(T_PLAIN, plain);
    expect(plainRes.status).toBe(200);
    expect(shapeOf(body)).toEqual(shapeOf((await plainRes.json()) as Json));
  });

  it('a closed step on a day with no other activity advances user_streak once', async () => {
    const m = await mission();
    await step(m, 'submissions_on_topic', { topicId: T_MAIN, params: { minCount: 2 } });
    const streak = () =>
      env.DB.prepare('SELECT current_streak FROM user_streak WHERE user_id = ?')
        .bind(STUDENT)
        .first<{ current_streak: number }>();

    await ready(T_MAIN);
    expect(await streak()).toBeNull();
    await ready(T_MAIN);
    expect((await streak())?.current_streak).toBe(1);
    // A later finalize closes nothing and records nothing more.
    await ready(T_MAIN);
    expect((await streak())?.current_streak).toBe(1);
  });

  it('a thrown evaluator leaves the finalize status and body unchanged', async () => {
    const m = await mission();
    const r = await step(m, 'submissions_on_topic', { topicId: T_MAIN, params: { minCount: 1 } });
    const spy = vi.spyOn(MissionEvaluator.prototype, 'onSignal').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const sid = await upload(T_MAIN);
    const res = await finalize(T_MAIN, sid);
    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body).toMatchObject({ id: sid, status: 'ready' });
    expect(await progressOf(r)).toBeNull();

    spy.mockRestore();
    const plain = await upload(T_PLAIN);
    const plainRes = await finalize(T_PLAIN, plain);
    expect(shapeOf(body)).toEqual(shapeOf((await plainRes.json()) as Json));
  });
});

describe('submission edit and delete', () => {
  it('adding a description in a PATCH counts the submission', async () => {
    const m = await mission();
    const r = await step(m, 'submissions_on_topic', {
      topicId: T_MAIN,
      params: { minCount: 2, requireDescription: true },
    });
    await ready(T_MAIN);
    const bare = await ready(T_MAIN, '');
    expect((await progressOf(r))?.current_count).toBe(1);

    const res = await req('PATCH', `/topics/${T_MAIN}/submissions/${bare}`, {
      token: studentToken,
      body: { description: 'Now explained' },
    });
    expect(res.status).toBe(200);
    expect((await progressOf(r))?.completed_at).toEqual(expect.any(String));
  });

  it('deleting a counted submission lowers an incomplete step', async () => {
    const m = await mission();
    const r = await step(m, 'submissions_on_topic', { topicId: T_MAIN, params: { minCount: 3 } });
    const first = await ready(T_MAIN);
    await ready(T_MAIN);
    expect((await progressOf(r))?.current_count).toBe(2);

    const res = await req('DELETE', `/topics/${T_MAIN}/submissions/${first}`, { token: studentToken });
    expect(res.status).toBe(204);
    expect((await progressOf(r))?.current_count).toBe(1);
  });

  it('deleting a counted submission of a completed step changes nothing', async () => {
    const m = await mission();
    const r = await step(m, 'submissions_on_topic', { topicId: T_MAIN, params: { minCount: 1 } });
    const sid = await ready(T_MAIN);
    const before = await progressOf(r);
    expect(before?.completed_at).toEqual(expect.any(String));

    expect((await req('DELETE', `/topics/${T_MAIN}/submissions/${sid}`, { token: studentToken })).status).toBe(204);
    expect(await progressOf(r)).toEqual(before);
    expect(await missionCompleted(m)).toBe(true);
  });
});

describe('submission move', () => {
  it('moving a submission regresses the source step and counts on the target', async () => {
    const m = await mission();
    const source = await step(m, 'submissions_on_topic', { topicId: T_MAIN, params: { minCount: 3 } });
    const target = await step(m, 'submissions_on_topic', { topicId: T_OTHER, params: { minCount: 3 }, position: 2 });
    const moved = await ready(T_MAIN);
    await ready(T_MAIN);
    expect((await progressOf(source))?.current_count).toBe(2);

    const res = await req('POST', '/me/submissions/move', {
      token: studentToken,
      body: { ids: [moved], targetTopicId: T_OTHER },
    });
    expect(res.status).toBe(200);
    expect((await progressOf(source))?.current_count).toBe(1);
    expect((await progressOf(target))?.current_count).toBe(1);
  });

  it('a moved-in submission created before the window does not count', async () => {
    const m = await mission();
    const target = await step(m, 'submissions_on_topic', { topicId: T_OTHER, params: { minCount: 1 } });
    const old = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO topic_submissions
         (id, topic_node_id, author_id, title, description, storage_key, original_name, content_type,
          size_bytes, status, visibility, created_at)
       VALUES (?, ?, ?, 'Old', 'Last month', ?, 'old.mp4', 'video/mp4', 1, 'ready', 'private', ?)`,
    )
      .bind(old, T_MAIN, STUDENT, `submissions/${STUDENT}/${old}`, '2020-01-01 10:00:00')
      .run();

    const res = await req('POST', '/me/submissions/move', {
      token: studentToken,
      body: { ids: [old], targetTopicId: T_OTHER },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).moved).toHaveLength(1);
    // The hook evaluated the target step and found nothing inside the window.
    expect(await progressOf(target)).toMatchObject({ current_count: 0, completed_at: null });
  });
});

describe('staff moderation and removal', () => {
  it('unshare, clear moderation and remove re-evaluate the author', async () => {
    const m = await mission();
    const r = await step(m, 'submissions_on_topic', { topicId: T_MAIN, params: { minCount: 3 } });
    const sid = await ready(T_MAIN);
    await ready(T_MAIN);
    expect((await progressOf(r))?.current_count).toBe(2);

    expect((await req('POST', `/admin/submissions/${sid}/unshare`, { token: adminToken })).status).toBe(200);
    expect((await progressOf(r))?.current_count).toBe(1);

    expect((await req('DELETE', `/admin/submissions/${sid}/moderation`, { token: adminToken })).status).toBe(204);
    expect((await progressOf(r))?.current_count).toBe(2);

    expect((await req('DELETE', `/admin/submissions/${sid}`, { token: adminToken })).status).toBe(204);
    expect((await progressOf(r))?.current_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Visit and video
// ---------------------------------------------------------------------------

describe('topic visit', () => {
  it('a topic_visited step completes within the visit request, on a repeat visit too', async () => {
    // The first visit happens before any mission exists.
    expect((await req('POST', `/me/topics/${T_MAIN}/visit`, { token: studentToken })).status).toBe(200);
    const m = await mission();
    const r = await step(m, 'topic_visited', { topicId: T_MAIN });

    const res = await req('POST', `/me/topics/${T_MAIN}/visit`, { token: studentToken });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).changed).toBe(false);
    expect((await progressOf(r))?.completed_by).toBe('hook');
    expect(await missionCompleted(m)).toBe(true);
  });
});

describe('video watched', () => {
  it('a ready video of the topic completes a video_watched step', async () => {
    const m = await mission();
    const r = await step(m, 'video_watched', { topicId: T_MAIN, params: { minCount: 1 } });
    const video = await insertMedia(T_MAIN, ADMIN);

    const res = await req('POST', `/topics/${T_MAIN}/videos/${video}/watched`, { token: studentToken });
    expect(res.status).toBe(200);
    expect((await progressOf(r))?.completed_by).toBe('hook');
  });

  it('a media id of another topic is ignored', async () => {
    const m = await mission();
    const r = await step(m, 'video_watched', { topicId: T_MAIN, params: { minCount: 1 } });
    const elsewhere = await insertMedia(T_OTHER, ADMIN);

    const res = await req('POST', `/topics/${T_MAIN}/videos/${elsewhere}/watched`, { token: studentToken });
    expect(res.status).toBe(200);
    expect(await progressOf(r)).toBeNull();
    const evidence = await env.DB.prepare('SELECT COUNT(*) AS n FROM mission_evidence WHERE requirement_id = ?')
      .bind(r)
      .first<{ n: number }>();
    expect(evidence?.n).toBe(0);
  });

  it('a thrown evaluator leaves the watched status and body unchanged', async () => {
    const m = await mission();
    await step(m, 'video_watched', { topicId: T_MAIN, params: { minCount: 1 } });
    const video = await insertMedia(T_MAIN, ADMIN);
    const spy = vi.spyOn(MissionEvaluator.prototype, 'onSignal').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await req('POST', `/topics/${T_MAIN}/videos/${video}/watched`, { token: studentToken });
    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('xpAwarded');
  });
});

// ---------------------------------------------------------------------------
// Event charges
// ---------------------------------------------------------------------------

describe('event charges', () => {

  it('a payment that settles the charge completes an event_participation step', async () => {
    const m = await mission();
    const event = await pastEvent();
    const r = await step(m, 'event_participation', { eventId: event });
    const charge = await insertCharge(event, STUDENT, 'open', ADMIN);

    const res = await req('POST', `/admin/billing/charges/${charge}/payments`, {
      token: adminToken,
      body: { amountMinor: 8000, method: 'pix' },
    });
    expect(res.status).toBe(201);
    expect((await progressOf(r))?.completed_by).toBe('hook');
  });

  it('a settling adjustment completes the step', async () => {
    const m = await mission();
    const event = await pastEvent();
    const r = await step(m, 'event_participation', { eventId: event });
    const charge = await insertCharge(event, STUDENT, 'open', ADMIN);

    const res = await req('POST', `/admin/billing/charges/${charge}/adjustments`, {
      token: adminToken,
      body: { kind: 'discount', amountMinor: -8000, reason: 'Scholarship' },
    });
    expect(res.status).toBe(201);
    expect((await progressOf(r))?.completed_at).toEqual(expect.any(String));
  });

  it('voiding a paid charge before completion takes the count back to 0', async () => {
    const m = await mission();
    const event = await pastEvent();
    const r = await step(m, 'event_participation', { eventId: event });
    const charge = await insertCharge(event, STUDENT, 'paid', ADMIN);
    // The partial count a prior evaluation left before the step could close.
    await env.DB.prepare(
      `INSERT INTO mission_requirement_progress (requirement_id, user_id, mission_id, current_count, target_count)
       VALUES (?, ?, ?, 1, 1)`,
    )
      .bind(r, STUDENT, m)
      .run();
    await env.DB.prepare(
      "INSERT INTO mission_enrollments (mission_id, user_id, source, counts_from) VALUES (?, ?, 'auto', ?)",
    )
      .bind(m, STUDENT, new Date(Date.now() - DAY).toISOString())
      .run();

    const res = await req('POST', `/admin/billing/charges/${charge}/void`, {
      token: adminToken,
      body: { reason: 'No show' },
    });
    expect(res.status).toBe(200);
    expect(await progressOf(r)).toMatchObject({ current_count: 0, completed_at: null });
  });

  it('a reversal after completion changes nothing (write-once)', async () => {
    const m = await mission();
    const event = await pastEvent();
    const r = await step(m, 'event_participation', { eventId: event });
    const charge = await insertCharge(event, STUDENT, 'open', ADMIN);
    const paid = await req('POST', `/admin/billing/charges/${charge}/payments`, {
      token: adminToken,
      body: { amountMinor: 8000, method: 'pix' },
    });
    const payment = (await paid.json()) as Json;
    const before = await progressOf(r);
    expect(before?.completed_at).toEqual(expect.any(String));

    const res = await req('POST', `/admin/billing/charge-payments/${payment.id}/reverse`, {
      token: adminToken,
      body: { reason: 'Bounced' },
    });
    expect(res.status).toBe(201);
    expect(await progressOf(r)).toEqual(before);
  });

  it('a thrown evaluator leaves the payment status and body unchanged', async () => {
    const m = await mission();
    const event = await pastEvent();
    await step(m, 'event_participation', { eventId: event });
    const charge = await insertCharge(event, STUDENT, 'open', ADMIN);
    const spy = vi.spyOn(MissionEvaluator.prototype, 'onSignal').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await req('POST', `/admin/billing/charges/${charge}/payments`, {
      token: adminToken,
      body: { amountMinor: 8000, method: 'pix' },
    });
    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ chargeId: charge, amountMinor: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Best-effort across every hooked route
// ---------------------------------------------------------------------------

describe('a throwing evaluator on every other hooked route', () => {
  it('each route still answers its usual status and body', async () => {
    const m = await mission();
    const event = await pastEvent();
    await step(m, 'submissions_on_topic', { topicId: T_MAIN, params: { minCount: 5 } });
    await step(m, 'submissions_on_topic', { topicId: T_OTHER, params: { minCount: 5 }, position: 2 });
    await step(m, 'topic_visited', { topicId: T_MAIN, position: 3 });
    await step(m, 'event_participation', { eventId: event, position: 4 });
    const edited = await ready(T_MAIN);
    const deleted = await ready(T_MAIN);
    const moved = await ready(T_MAIN);
    const moderated = await ready(T_MAIN);
    const charge = await insertCharge(event, STUDENT, 'open', ADMIN);
    const voidable = await insertCharge(await pastEvent(), STUDENT, 'open', ADMIN);

    const spy = vi.spyOn(MissionEvaluator.prototype, 'onSignal').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const visit = await req('POST', `/me/topics/${T_MAIN}/visit`, { token: studentToken });
    expect(visit.status).toBe(200);
    expect(await visit.json()).toMatchObject({ changed: true });

    const patch = await req('PATCH', `/topics/${T_MAIN}/submissions/${edited}`, {
      token: studentToken,
      body: { description: 'Edited' },
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ id: edited, description: 'Edited' });

    expect((await req('DELETE', `/topics/${T_MAIN}/submissions/${deleted}`, { token: studentToken })).status).toBe(204);

    const move = await req('POST', '/me/submissions/move', {
      token: studentToken,
      body: { ids: [moved], targetTopicId: T_OTHER },
    });
    expect(move.status).toBe(200);
    expect(await move.json()).toMatchObject({ moved: [{ id: moved, topicNodeId: T_OTHER }], refused: [] });

    const unshare = await req('POST', `/admin/submissions/${moderated}/unshare`, { token: adminToken });
    expect(unshare.status).toBe(200);
    expect((await req('DELETE', `/admin/submissions/${moderated}/moderation`, { token: adminToken })).status).toBe(204);
    expect((await req('DELETE', `/admin/submissions/${moderated}`, { token: adminToken })).status).toBe(204);

    const adjustment = await req('POST', `/admin/billing/charges/${charge}/adjustments`, {
      token: adminToken,
      body: { kind: 'discount', amountMinor: -500, reason: 'Friend' },
    });
    expect(adjustment.status).toBe(201);
    expect(await adjustment.json()).toMatchObject({ chargeId: charge, amountMinor: -500 });

    const payment = await req('POST', `/admin/billing/charges/${charge}/payments`, {
      token: adminToken,
      body: { amountMinor: 7500, method: 'pix' },
    });
    const paid = (await payment.json()) as Json;
    const reverse = await req('POST', `/admin/billing/charge-payments/${paid.id}/reverse`, {
      token: adminToken,
      body: { reason: 'Bounced' },
    });
    expect(reverse.status).toBe(201);
    expect(await reverse.json()).toMatchObject({ chargeId: charge, amountMinor: -7500, reversesId: paid.id });

    const voided = await req('POST', `/admin/billing/charges/${voidable}/void`, {
      token: adminToken,
      body: { reason: 'No show' },
    });
    expect(voided.status).toBe(200);
    expect(await voided.json()).toMatchObject({ id: voidable, status: 'void' });

    // visit, patch, delete, move, unshare, clear, remove, adjustment, payment, reverse, void.
    expect(spy).toHaveBeenCalledTimes(11);
  });
});
