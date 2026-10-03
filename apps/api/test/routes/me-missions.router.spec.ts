import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { enroll, insertEvent, insertMission, insertRequirement, insertSubmission } from '../db/mission-fixtures';

/**
 * Student missions API (RFC 0022 §5, §6, §8; M27 Task 07), through the real
 * routes against a real D1: list composition (enrolled, implicit, joinable,
 * teaser, absent), target redaction, "reads never write", join / leave / rejoin,
 * and the manual check.
 *
 * Missions are dated around the real clock, because the routes read `new Date()`.
 * Storage is isolated per test; the `beforeAll` users, topics, grants and groups
 * are shared.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT = 'mm-student';
const ADMIN = 'mm-admin';
const T_OK = '7b2f0c2e-7b3d-4e5f-8a9b-0c1d2e3f4b01'; // restricted, granted to the student
const T_NO = '7b2f0c2e-7b3d-4e5f-8a9b-0c1d2e3f4b02'; // restricted, not granted
const G_OTHER = 'mm-group-other';
const G_MINE = 'mm-group-mine';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let studentToken: string;
let adminToken: string;

type Json = Record<string, any>;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const user = (id: string) =>
    env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, `Name ${id}`, `${id}@me-missions.test`, 'hash');
  const topic = (id: string, title: string) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO topic_nodes (id, title, status, archived, visibility) VALUES (?, ?, 'published', 0, 'restricted')`,
    ).bind(id, title);

  await env.DB.batch([
    user(STUDENT),
    user(ADMIN),
    env.DB.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'admin'").bind(ADMIN),
    topic(T_OK, 'Kihon'),
    topic(T_NO, 'Secret kata'),
    env.DB.prepare(
      'INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind(`enr-${STUDENT}-${T_OK}`, STUDENT, T_OK, ADMIN),
    env.DB.prepare("INSERT OR IGNORE INTO user_groups (id, name) VALUES (?, 'Black belts')").bind(G_OTHER),
    env.DB.prepare("INSERT OR IGNORE INTO user_groups (id, name) VALUES (?, 'White belts')").bind(G_MINE),
    env.DB.prepare('INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)').bind(G_MINE, STUDENT),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [studentToken, adminToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT, email: 's@me-missions.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: ADMIN, email: 'a@me-missions.test', roles: ['admin'] }),
  ]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function req(method: string, path: string, token = studentToken) {
  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function list(token = studentToken): Promise<Json[]> {
  const res = await req('GET', '/me/missions', token);
  expect(res.status).toBe(200);
  return ((await res.json()) as Json[] | null) ?? [];
}

const entryOf = (entries: Json[], missionId: string) => entries.find((e) => e.mission.id === missionId);

/** An active mission open around now (or in the given window). */
async function mission(
  title: string,
  opts: {
    enrollmentMode?: 'auto' | 'open' | 'assigned';
    mode?: 'parallel' | 'sequential';
    startAt?: number;
    endAt?: number;
    predicateKind?: string;
  } = {},
): Promise<string> {
  const id = await insertMission({
    startAt: new Date(opts.startAt ?? Date.now() - DAY).toISOString(),
    endAt: new Date(opts.endAt ?? Date.now() + 30 * DAY).toISOString(),
    enrollmentMode: opts.enrollmentMode,
    mode: opts.mode,
    predicateKind: opts.predicateKind,
  });
  await env.DB.prepare("UPDATE missions SET title = ?, description = 'Secret plan', xp_reward = 100 WHERE id = ?")
    .bind(title, id)
    .run();
  return id;
}

async function step(
  missionId: string,
  position: number,
  kind: string,
  opts: { topicId?: string; eventId?: string; params?: unknown; xpReward?: number } = {},
): Promise<string> {
  const id = await insertRequirement(missionId, position, kind, opts);
  if (opts.xpReward) {
    await env.DB.prepare('UPDATE mission_requirements SET xp_reward = ? WHERE id = ?').bind(opts.xpReward, id).run();
  }
  return id;
}

const countRows = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

const enrollmentRow = (missionId: string, userId = STUDENT) =>
  env.DB.prepare('SELECT source, counts_from, left_at FROM mission_enrollments WHERE mission_id = ? AND user_id = ?')
    .bind(missionId, userId)
    .first<{ source: string; counts_from: string; left_at: string | null }>();

// ---------------------------------------------------------------------------
// GET /me/missions — composition
// ---------------------------------------------------------------------------

describe('GET /me/missions — list composition', () => {
  it('lists implicit auto, joinable open, a locked teaser and legacy; omits the gated-out auto', async () => {
    const autoOk = await mission('Auto OK');
    await step(autoOk, 1, 'submissions_on_topic', { topicId: T_OK, params: { minCount: 2 } });
    const autoNo = await mission('Auto gated');
    await step(autoNo, 1, 'topic_visited', { topicId: T_NO });
    const open = await mission('Open', { enrollmentMode: 'open' });
    await step(open, 1, 'manual_check', { params: { instructions: 'Bow twice' } });
    const assigned = await mission('Assigned', { enrollmentMode: 'assigned' });
    await step(assigned, 1, 'manual_check', { xpReward: 40 });
    await env.DB.prepare('INSERT INTO mission_audience_group (mission_id, group_id) VALUES (?, ?)').bind(assigned, G_OTHER).run();
    const legacy = await mission('Legacy', { predicateKind: 'lessons_completed' });

    const entries = await list();

    const auto = entryOf(entries, autoOk)!;
    expect(auto.enrollment).toEqual({ source: 'auto', joinedAt: null, implicit: true });
    expect(auto.joinable).toBe(false);
    expect(auto.locked).toBeNull();
    expect(auto.steps).toHaveLength(1);
    expect(auto.steps[0]).toMatchObject({
      kind: 'submissions_on_topic',
      state: 'open',
      current: 0,
      required: 2,
      completedAt: null,
      instructions: null,
      target: { type: 'topic', topicId: T_OK, title: 'Kihon', accessible: true },
    });

    expect(entryOf(entries, autoNo)).toBeUndefined();

    const joinable = entryOf(entries, open)!;
    expect(joinable.enrollment).toBeNull();
    expect(joinable.joinable).toBe(true);
    expect(joinable.steps[0]).toMatchObject({ kind: 'manual_check', state: 'open', target: null, instructions: 'Bow twice' });

    const teaser = entryOf(entries, assigned)!;
    expect(teaser.locked).toEqual({ reason: 'assigned', groups: ['Black belts'] });
    expect(teaser.steps).toEqual([]);
    expect(teaser.mission.title).toBe('Assigned');
    expect(teaser.mission.description).toBe('');
    expect(teaser.mission.xpReward).toBe(0);
    expect(teaser.progress).toBeNull();
    expect(teaser.enrollment).toBeNull();

    const old = entryOf(entries, legacy)!;
    expect(old.steps).toEqual([]);
    expect(old.enrollment).toBeNull();
    expect(old.locked).toBeNull();
  });

  it('shows an assigned mission to a group member as an implicit admin enrollment', async () => {
    const assigned = await mission('Mine', { enrollmentMode: 'assigned' });
    await step(assigned, 1, 'manual_check');
    await env.DB.prepare('INSERT INTO mission_audience_group (mission_id, group_id) VALUES (?, ?)').bind(assigned, G_MINE).run();

    const entry = entryOf(await list(), assigned)!;
    expect(entry.locked).toBeNull();
    expect(entry.enrollment).toEqual({ source: 'admin', joinedAt: null, implicit: true });
    expect(entry.steps).toHaveLength(1);
  });

  it("an admin's list holds no implicit enrollment in an auto mission", async () => {
    const auto = await mission('Auto');
    await step(auto, 1, 'manual_check');
    const open = await mission('Open', { enrollmentMode: 'open' });
    await step(open, 1, 'manual_check');

    const entries = await list(adminToken);
    expect(entryOf(entries, auto)).toBeUndefined();
    expect(entryOf(entries, open)?.joinable).toBe(true);
  });

  it('two GETs (and the dashboard) write no enrollment and no progress row', async () => {
    const auto = await mission('Auto');
    await step(auto, 1, 'submissions_on_topic', { topicId: T_OK, params: { minCount: 1 } });
    await step(auto, 2, 'manual_check');
    await insertSubmission(T_OK, STUDENT, new Date(Date.now() - HOUR).toISOString());
    const open = await mission('Open', { enrollmentMode: 'open' });
    await step(open, 1, 'manual_check');

    await list();
    await list();
    expect((await req('GET', '/me/dashboard')).status).toBe(200);
    expect((await req('GET', `/me/missions/${auto}`)).status).toBe(200);

    expect(await countRows('mission_enrollments')).toBe(0);
    expect(await countRows('mission_requirement_progress')).toBe(0);
  });

  it('the dashboard embeds the same entries', async () => {
    const auto = await mission('Auto');
    await step(auto, 1, 'manual_check');
    const res = await req('GET', '/me/dashboard');
    const body = (await res.json()) as Json;
    expect(entryOf(body.missions, auto)?.enrollment).toEqual({ source: 'auto', joinedAt: null, implicit: true });
  });
});

// ---------------------------------------------------------------------------
// Target redaction
// ---------------------------------------------------------------------------

describe('target redaction', () => {
  it('redacts a topic outside the access set and an event the caller cannot see', async () => {
    const restricted = await insertEvent(new Date(Date.now() + 2 * DAY).toISOString(), ADMIN);
    await env.DB.prepare("UPDATE events SET audience = 'restricted', title = 'Private seminar' WHERE id = ?").bind(restricted).run();
    const members = await insertEvent(new Date(Date.now() + 3 * DAY).toISOString(), ADMIN);

    const open = await mission('Open', { enrollmentMode: 'open' });
    await step(open, 1, 'topic_visited', { topicId: T_NO });
    await step(open, 2, 'event_participation', { eventId: restricted });
    await step(open, 3, 'event_participation', { eventId: members });
    await step(open, 4, 'topic_visited', { topicId: T_OK });

    const steps = entryOf(await list(), open)!.steps as Json[];
    expect(steps.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    expect(steps[0].target).toEqual({ type: 'topic', topicId: null, title: null, accessible: false });
    expect(steps[1].target).toEqual({ type: 'event', slug: null, title: null, startsAt: null });
    expect(steps[2].target).toMatchObject({ type: 'event', slug: `seminar-${members}`, title: 'Seminar' });
    expect(typeof steps[2].target.startsAt).toBe('string');
    expect(steps[3].target).toEqual({ type: 'topic', topicId: T_OK, title: 'Kihon', accessible: true });
  });
});

// ---------------------------------------------------------------------------
// GET /me/missions/{id}
// ---------------------------------------------------------------------------

describe('GET /me/missions/{id}', () => {
  it('answers the entry for a visible mission and 404 for a teaser, a gated-out auto and an unknown id', async () => {
    const auto = await mission('Auto');
    await step(auto, 1, 'manual_check');
    const gated = await mission('Gated');
    await step(gated, 1, 'topic_visited', { topicId: T_NO });
    const assigned = await mission('Assigned', { enrollmentMode: 'assigned' });
    await step(assigned, 1, 'manual_check');
    await env.DB.prepare('INSERT INTO mission_audience_group (mission_id, group_id) VALUES (?, ?)').bind(assigned, G_OTHER).run();

    const ok = await req('GET', `/me/missions/${auto}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Json).mission.id).toBe(auto);

    expect((await req('GET', `/me/missions/${assigned}`)).status).toBe(404);
    expect((await req('GET', `/me/missions/${gated}`)).status).toBe(404);
    expect((await req('GET', '/me/missions/not-a-mission')).status).toBe(404);
  });

  it('answers 404 on join, leave and check of an assigned mission the caller is not in', async () => {
    const assigned = await mission('Assigned', { enrollmentMode: 'assigned' });
    const manual = await step(assigned, 1, 'manual_check');
    await env.DB.prepare('INSERT INTO mission_audience_group (mission_id, group_id) VALUES (?, ?)').bind(assigned, G_OTHER).run();

    expect((await req('POST', `/me/missions/${assigned}/join`)).status).toBe(404);
    expect((await req('POST', `/me/missions/${assigned}/leave`)).status).toBe(404);
    expect((await req('POST', `/me/missions/${assigned}/requirements/${manual}/check`)).status).toBe(404);
    expect(await countRows('mission_enrollments')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Join / leave
// ---------------------------------------------------------------------------

describe('POST /me/missions/{id}/join', () => {
  it('joins an open mission mid-window with 201, then answers 200', async () => {
    const open = await mission('Open', { enrollmentMode: 'open', startAt: Date.now() - 5 * DAY });
    await step(open, 1, 'manual_check');

    const first = await req('POST', `/me/missions/${open}/join`);
    expect(first.status).toBe(201);
    const body = (await first.json()) as Json;
    expect(body.enrollment).toMatchObject({ source: 'self', implicit: false });
    expect(body.joinable).toBe(false);

    const row = await enrollmentRow(open);
    expect(row?.source).toBe('self');
    // counts_from is the join time, not the mission start.
    expect(Date.parse(row!.counts_from)).toBeGreaterThan(Date.now() - 60_000);

    expect((await req('POST', `/me/missions/${open}/join`)).status).toBe(200);
  });

  it('refuses a non-open mission (409 MISSION_NOT_JOINABLE) and an open one outside its window (409 MISSION_CLOSED)', async () => {
    const auto = await mission('Auto');
    await step(auto, 1, 'manual_check');
    const ended = await mission('Ended', { enrollmentMode: 'open', startAt: Date.now() - 10 * DAY, endAt: Date.now() - DAY });
    await step(ended, 1, 'manual_check');
    const future = await mission('Future', { enrollmentMode: 'open', startAt: Date.now() + DAY, endAt: Date.now() + 10 * DAY });
    await step(future, 1, 'manual_check');

    const notJoinable = await req('POST', `/me/missions/${auto}/join`);
    expect(notJoinable.status).toBe(409);
    expect(((await notJoinable.json()) as Json).error).toBe('MISSION_NOT_JOINABLE');

    for (const id of [ended, future]) {
      const closed = await req('POST', `/me/missions/${id}/join`);
      expect(closed.status).toBe(409);
      expect(((await closed.json()) as Json).error).toBe('MISSION_CLOSED');
    }
    expect(await countRows('mission_enrollments')).toBe(0);
  });

  it('a late join counts only the evidence created after it', async () => {
    const open = await mission('Open', { enrollmentMode: 'open', startAt: Date.now() - 5 * DAY });
    await step(open, 1, 'submissions_on_topic', { topicId: T_OK, params: { minCount: 3 } });

    expect((await req('POST', `/me/missions/${open}/join`)).status).toBe(201);
    // Put the join two hours back so evidence can sit on both sides of it.
    const joinedAt = new Date(Date.now() - 2 * HOUR).toISOString();
    await env.DB.prepare('UPDATE mission_enrollments SET joined_at = ?, counts_from = ? WHERE mission_id = ?')
      .bind(joinedAt, joinedAt, open)
      .run();
    await insertSubmission(T_OK, STUDENT, new Date(Date.now() - 3 * HOUR).toISOString()); // before the join
    await insertSubmission(T_OK, STUDENT, new Date(Date.now() - HOUR).toISOString()); // after the join

    const entry = entryOf(await list(), open)!;
    expect(entry.steps[0]).toMatchObject({ state: 'open', current: 1, required: 3 });
  });
});

describe('POST /me/missions/{id}/leave', () => {
  it('leaves a self enrollment (204), then 404; a rejoin keeps the first counts_from', async () => {
    const open = await mission('Open', { enrollmentMode: 'open' });
    await step(open, 1, 'manual_check');

    expect((await req('POST', `/me/missions/${open}/join`)).status).toBe(201);
    const firstCountsFrom = (await enrollmentRow(open))!.counts_from;

    expect((await req('POST', `/me/missions/${open}/leave`)).status).toBe(204);
    expect((await enrollmentRow(open))!.left_at).not.toBeNull();
    const afterLeave = entryOf(await list(), open)!;
    expect(afterLeave.enrollment).toBeNull();
    expect(afterLeave.joinable).toBe(true);

    expect((await req('POST', `/me/missions/${open}/leave`)).status).toBe(404);

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await req('POST', `/me/missions/${open}/join`)).status).toBe(201);
    const rejoined = (await enrollmentRow(open))!;
    expect(rejoined.left_at).toBeNull();
    expect(rejoined.counts_from).toBe(firstCountsFrom);
  });

  it('answers 409 MISSION_NOT_LEAVABLE for an implicit or an admin enrollment, 404 when never joined', async () => {
    const auto = await mission('Auto');
    await step(auto, 1, 'manual_check');
    const assigned = await mission('Assigned', { enrollmentMode: 'assigned' });
    await step(assigned, 1, 'manual_check');
    await env.DB.prepare('INSERT INTO mission_audience_user (mission_id, user_id) VALUES (?, ?)').bind(assigned, STUDENT).run();
    await enroll(assigned, STUDENT, { source: 'admin', countsFrom: new Date(Date.now() - DAY).toISOString() });
    const open = await mission('Open', { enrollmentMode: 'open' });
    await step(open, 1, 'manual_check');

    for (const id of [auto, assigned]) {
      const res = await req('POST', `/me/missions/${id}/leave`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as Json).error).toBe('MISSION_NOT_LEAVABLE');
    }
    expect((await req('POST', `/me/missions/${open}/leave`)).status).toBe(404);
    expect((await enrollmentRow(assigned))!.left_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Manual check
// ---------------------------------------------------------------------------

describe('POST /me/missions/{id}/requirements/{reqId}/check', () => {
  const stepRewards = async () =>
    (
      await env.DB.prepare(
        "SELECT points FROM xp_events WHERE user_id = ? AND source_kind = 'mission_step_reward'",
      )
        .bind(STUDENT)
        .all<{ points: number }>()
    ).results;

  it('completes the step in the same request with XP and streak; a second tick changes nothing', async () => {
    const auto = await mission('Auto');
    const manual = await step(auto, 1, 'manual_check', { xpReward: 30 });
    await step(auto, 2, 'topic_visited', { topicId: T_OK });

    const res = await req('POST', `/me/missions/${auto}/requirements/${manual}/check`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.step).toMatchObject({ id: manual, state: 'completed', current: 1, required: 1 });
    expect(body.step.completedAt).not.toBeNull();
    expect(body.mission.mission.id).toBe(auto);
    expect(body.mission.enrollment).toMatchObject({ source: 'auto', implicit: false });

    expect(await stepRewards()).toEqual([{ points: 30 }]);
    const streak = await env.DB.prepare('SELECT current_streak FROM user_streak WHERE user_id = ?')
      .bind(STUDENT)
      .first<{ current_streak: number }>();
    expect(streak?.current_streak).toBe(1);

    const again = await req('POST', `/me/missions/${auto}/requirements/${manual}/check`);
    expect(again.status).toBe(200);
    expect(((await again.json()) as Json).step).toMatchObject({ id: manual, state: 'completed' });
    expect(await stepRewards()).toEqual([{ points: 30 }]);
  });

  it('answers 409 MISSION_STEP_LOCKED for a sequential step whose predecessor is incomplete', async () => {
    const seq = await mission('Sequential', { mode: 'sequential' });
    await step(seq, 1, 'topic_visited', { topicId: T_OK });
    const manual = await step(seq, 2, 'manual_check', { xpReward: 10 });

    const res = await req('POST', `/me/missions/${seq}/requirements/${manual}/check`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error).toBe('MISSION_STEP_LOCKED');
    expect(await stepRewards()).toEqual([]);
  });

  it('answers 409 MISSION_CLOSED outside the window', async () => {
    const ended = await mission('Ended', { startAt: Date.now() - 10 * DAY, endAt: Date.now() - DAY });
    const manual = await step(ended, 1, 'manual_check');

    const res = await req('POST', `/me/missions/${ended}/requirements/${manual}/check`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error).toBe('MISSION_CLOSED');
  });

  it('answers 404 for a non-manual step, an unknown step and an open mission not joined', async () => {
    const auto = await mission('Auto');
    const visit = await step(auto, 1, 'topic_visited', { topicId: T_OK });
    const open = await mission('Open', { enrollmentMode: 'open' });
    const openManual = await step(open, 1, 'manual_check');

    expect((await req('POST', `/me/missions/${auto}/requirements/${visit}/check`)).status).toBe(404);
    expect((await req('POST', `/me/missions/${auto}/requirements/${openManual}/check`)).status).toBe(404);
    expect((await req('POST', `/me/missions/${open}/requirements/${openManual}/check`)).status).toBe(404);
    expect(await countRows('mission_requirement_progress')).toBe(0);
  });
});
