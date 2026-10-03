import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { encodeCursor } from '@api/routes/_shared/cursor';
import { enroll, insertEvent, insertMedia, insertTopic, insertUser } from '../db/mission-fixtures';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let adminToken: string;
let contentCreatorToken: string;
let studentToken: string;

let adminUserId: string;
let publishedTopic: string;
let videoTopic: string;
let archivedTopic: string;
let pricedEvent: string;
let unpricedEvent: string;

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function publishedTopicId(opts: { archived?: boolean } = {}): Promise<string> {
  const id = await insertTopic();
  await env.DB
    .prepare("UPDATE topic_nodes SET status = 'published', archived = ? WHERE id = ?")
    .bind(opts.archived ? 1 : 0, id)
    .run();
  return id;
}

beforeAll(async () => {
  await applyMigrations(env.DB);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, contentCreatorToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: 'admin-missions-test', email: 'admin@missions.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc-missions-test', email: 'cc@missions.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: 'student-missions-test', email: 'student@missions.test', roles: ['student'] }),
  ]);

  adminUserId = await insertUser();
  publishedTopic = await publishedTopicId();
  videoTopic = await publishedTopicId();
  await insertMedia(videoTopic, adminUserId, { type: 'video/mp4', status: 'ready' });
  archivedTopic = await publishedTopicId({ archived: true });

  pricedEvent = await insertEvent('2030-01-10 18:00:00', adminUserId);
  await env.DB
    .prepare("INSERT INTO event_prices (event_id, amount_minor, currency, updated_by) VALUES (?, 8000, 'BRL', ?)")
    .bind(pricedEvent, adminUserId)
    .run();
  unpricedEvent = await insertEvent('2030-01-11 18:00:00', adminUserId);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function req(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; env?: Partial<AppEnv> } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const ctx = createExecutionContext();
  const workerEnv = options.env ? ({ ...env, ...options.env } as AppEnv) : (env as AppEnv);
  const res = await worker.fetch(request, workerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

type Body = Record<string, unknown>;

function missionBody(overrides: Body = {}): Body {
  return {
    title: 'Kihon month',
    description: 'Two demonstrations, then a self-check.',
    startAt: iso(DAY),
    endAt: iso(30 * DAY),
    mode: 'sequential',
    xpReward: 100,
    requirements: [
      { kind: 'submissions_on_topic', title: 'Two demonstrations', topicId: publishedTopic, params: { minCount: 2 }, xpReward: 20 },
      { kind: 'manual_check', title: 'Self-check', params: { instructions: 'Tick when done' } },
    ],
    ...overrides,
  };
}

interface MissionDetail {
  mission: { id: string; predicateKind: string; mode: string; enrollmentMode: string; title: string; endAt: string; active: boolean };
  requirements: Array<{ id: string; position: number; kind: string; title: string; topicId: string | null }>;
  audience: { groupIds: string[]; userIds: string[] };
}

async function createMission(overrides: Body = {}): Promise<MissionDetail> {
  const res = await req('POST', '/admin/missions', { token: adminToken, body: missionBody(overrides) });
  expect(res.status).toBe(201);
  return (await res.json<{ data: MissionDetail }>()).data;
}

async function enrollmentOf(missionId: string, userId: string) {
  return env.DB
    .prepare('SELECT source, counts_from, left_at FROM mission_enrollments WHERE mission_id = ? AND user_id = ?')
    .bind(missionId, userId)
    .first<{ source: string; counts_from: string; left_at: string | null }>();
}

// ---------------------------------------------------------------------------
// Role matrix - reads open to staff, writes admin-only (RFC 0022 §8)
// ---------------------------------------------------------------------------

describe('admin missions - role matrix', () => {
  let missionId: string;
  let requirementId: string;

  beforeAll(async () => {
    const created = await createMission({ enrollmentMode: 'assigned' });
    missionId = created.mission.id;
    requirementId = created.requirements[0].id;
  });

  const writes = () => [
    ['POST', '/admin/missions', missionBody()],
    ['PATCH', `/admin/missions/${missionId}`, { title: 'Renamed' }],
    ['PUT', `/admin/missions/${missionId}/requirements`, { requirements: missionBody().requirements }],
    ['PATCH', `/admin/missions/${missionId}/requirements/${requirementId}`, { title: 'Renamed step' }],
    ['PUT', `/admin/missions/${missionId}/audience`, { groupIds: [], userIds: [] }],
    ['DELETE', `/admin/missions/${missionId}`, undefined],
  ] as const;

  const reads = () => [
    `/admin/missions`,
    `/admin/missions/${missionId}`,
    `/admin/missions/${missionId}/participants`,
  ];

  it('a content creator gets 403 on every write', async () => {
    for (const [method, path, body] of writes()) {
      const res = await req(method, path, { token: contentCreatorToken, body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    // Nothing changed behind the 403s.
    const detail = await req('GET', `/admin/missions/${missionId}`, { token: adminToken });
    const data = (await detail.json<{ data: MissionDetail }>()).data;
    expect(data.mission.title).toBe('Kihon month');
    expect(data.mission.active).toBe(true);
  });

  it('a content creator gets 403 on a write even with an invalid body', async () => {
    const res = await req('POST', '/admin/missions', { token: contentCreatorToken, body: { title: '' } });
    expect(res.status).toBe(403);
  });

  it('a content creator gets 200 on list, detail and participants', async () => {
    for (const path of reads()) {
      const res = await req('GET', path, { token: contentCreatorToken });
      expect(res.status, path).toBe(200);
    }
  });

  it('a student gets 403 on every route', async () => {
    for (const path of reads()) {
      expect((await req('GET', path, { token: studentToken })).status, path).toBe(403);
    }
    for (const [method, path, body] of writes()) {
      expect((await req(method, path, { token: studentToken, body })).status, `${method} ${path}`).toBe(403);
    }
  });

  it('an admin gets 200 on every write but create (201)', async () => {
    // The requirement rename runs before the replace, which issues new requirement ids.
    const [create, patch, replace, rename, audience, remove] = writes();
    const results: number[] = [];
    for (const [method, path, body] of [create, patch, rename, replace, audience, remove]) {
      results.push((await req(method, path, { token: adminToken, body })).status);
    }
    expect(results).toEqual([201, 200, 200, 200, 200, 200]);
  });
});

// ---------------------------------------------------------------------------
// Create - typed requirements and target validation
// ---------------------------------------------------------------------------

describe('POST /admin/missions', () => {
  it('creates a sequential two-step mission that reads back in position order', async () => {
    const created = await createMission();
    expect(created.mission.predicateKind).toBe('requirements');
    expect(created.requirements.map((r) => r.position)).toEqual([1, 2]);

    const res = await req('GET', `/admin/missions/${created.mission.id}`, { token: adminToken });
    expect(res.status).toBe(200);
    const detail = (await res.json<{ data: MissionDetail }>()).data;
    expect(detail.mission).toMatchObject({ predicateKind: 'requirements', mode: 'sequential', enrollmentMode: 'auto' });
    expect(detail.requirements.map((r) => [r.position, r.kind])).toEqual([
      [1, 'submissions_on_topic'],
      [2, 'manual_check'],
    ]);
    expect(detail.audience).toEqual({ groupIds: [], userIds: [] });

    const list = await req('GET', '/admin/missions', { token: adminToken });
    const item = (await list.json<{ data: Array<Body & { id: string }> }>()).data.find((m) => m.id === created.mission.id);
    expect(item).toMatchObject({ requirementCount: 2, enrolledCount: 0, completedCount: 0 });
  });

  it('accepts video_watched on a topic with a ready video and an event with a price', async () => {
    const created = await createMission({
      requirements: [
        { kind: 'video_watched', title: 'Watch', topicId: videoTopic, params: { minCount: 1 } },
        { kind: 'event_participation', title: 'Seminar', eventId: pricedEvent },
        { kind: 'topic_visited', title: 'Visit', topicId: publishedTopic },
      ],
    });
    expect(created.requirements).toHaveLength(3);
  });

  const schemaCases: Array<[string, unknown[], { index: number; reason: string; field?: string }]> = [
    [
      'an unknown kind',
      [{ kind: 'manual_check', title: 'Ok' }, { kind: 'teleport', title: 'No', params: {} }],
      { index: 1, reason: 'UNKNOWN_KIND', field: 'kind' },
    ],
    [
      'minCount 0',
      [{ kind: 'video_watched', title: 'Watch', topicId: crypto.randomUUID(), params: { minCount: 0 } }],
      { index: 0, reason: 'TOO_SMALL', field: 'params.minCount' },
    ],
    [
      'an extra params key',
      [
        { kind: 'manual_check', title: 'Ok' },
        { kind: 'manual_check', title: 'Ok' },
        { kind: 'manual_check', title: 'Extra', params: { instructions: '', colour: 'red' } },
      ],
      { index: 2, reason: 'UNRECOGNIZED_KEYS', field: 'params' },
    ],
  ];

  for (const [name, requirements, expected] of schemaCases) {
    it(`answers 400 with the index and reason for ${name}`, async () => {
      const res = await req('POST', '/admin/missions', { token: adminToken, body: missionBody({ requirements }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'ValidationError', ...expected });
    });
  }

  it('answers 400 INVALID_REQUIREMENT_TARGET for an archived topic', async () => {
    const res = await req('POST', '/admin/missions', {
      token: adminToken,
      body: missionBody({
        requirements: [
          { kind: 'manual_check', title: 'Ok' },
          { kind: 'topic_visited', title: 'Visit', topicId: archivedTopic },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_REQUIREMENT_TARGET', index: 1, reason: 'TOPIC_ARCHIVED' });
  });

  it('answers 400 INVALID_REQUIREMENT_TARGET for video_watched on a topic without a video', async () => {
    const res = await req('POST', '/admin/missions', {
      token: adminToken,
      body: missionBody({
        requirements: [{ kind: 'video_watched', title: 'Watch', topicId: publishedTopic, params: { minCount: 1 } }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_REQUIREMENT_TARGET', index: 0, reason: 'TOPIC_HAS_NO_VIDEO' });
  });

  it('answers 400 EVENT_NOT_CHARGEABLE for an unpriced event', async () => {
    const res = await req('POST', '/admin/missions', {
      token: adminToken,
      body: missionBody({
        requirements: [
          { kind: 'event_participation', title: 'Priced', eventId: pricedEvent },
          { kind: 'event_participation', title: 'Free', eventId: unpricedEvent },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'EVENT_NOT_CHARGEABLE', index: 1, reason: 'EVENT_NOT_CHARGEABLE' });
  });

  it('answers 400 REQUIREMENT_SHARING_DISABLED for shared_only while SUBMISSIONS_SHARING_ENABLED=false', async () => {
    const sharedOnly = {
      kind: 'submissions_on_topic',
      title: 'One shared demonstration',
      topicId: publishedTopic,
      params: { minCount: 1, visibility: 'shared_only' },
    };
    const res = await req('POST', '/admin/missions', {
      token: adminToken,
      env: { SUBMISSIONS_SHARING_ENABLED: 'false' } as Partial<AppEnv>,
      body: missionBody({ requirements: [sharedOnly] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'REQUIREMENT_SHARING_DISABLED',
      index: 0,
      reason: 'REQUIREMENT_SHARING_DISABLED',
    });

    // The same requirement is accepted while sharing is on.
    const ok = await req('POST', '/admin/missions', { token: adminToken, body: missionBody({ requirements: [sharedOnly] }) });
    expect(ok.status).toBe(201);
  });

  it('refuses the deprecated predicate fields in the request', async () => {
    const res = await req('POST', '/admin/missions', {
      token: adminToken,
      body: missionBody({ predicateKind: 'topics_completed', predicateParams: '3' }),
    });
    expect(res.status).toBe(400);
  });

  it('answers 400 when endAt is not after startAt', async () => {
    const at = iso(DAY);
    const res = await req('POST', '/admin/missions', { token: adminToken, body: missionBody({ startAt: at, endAt: at }) });
    expect(res.status).toBe(400);
  });

  it('answers 400 AUDIENCE_NOT_ALLOWED for an audience on a non-assigned mission', async () => {
    const res = await req('POST', '/admin/missions', {
      token: adminToken,
      body: missionBody({ enrollmentMode: 'open', audience: { groupIds: [], userIds: [] } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'AUDIENCE_NOT_ALLOWED' });
  });
});

// ---------------------------------------------------------------------------
// Start lock
// ---------------------------------------------------------------------------

describe('start lock', () => {
  let started: MissionDetail;

  beforeAll(async () => {
    started = await createMission({ startAt: iso(-DAY), endAt: iso(7 * DAY) });
  });

  it('PUT .../requirements answers 409 MISSION_STARTED', async () => {
    const res = await req('PUT', `/admin/missions/${started.mission.id}/requirements`, {
      token: adminToken,
      body: { requirements: [{ kind: 'manual_check', title: 'New' }] },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'MISSION_STARTED', fields: ['requirements'] });
  });

  for (const [field, value] of [
    ['mode', 'parallel'],
    ['xpReward', 999],
    ['enrollmentMode', 'open'],
    ['startAt', iso(-2 * DAY)],
  ] as const) {
    it(`PATCH ${field} answers 409 MISSION_STARTED`, async () => {
      const res = await req('PATCH', `/admin/missions/${started.mission.id}`, { token: adminToken, body: { [field]: value } });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'MISSION_STARTED', fields: [field] });
    });
  }

  it('PATCH title answers 200', async () => {
    const res = await req('PATCH', `/admin/missions/${started.mission.id}`, { token: adminToken, body: { title: 'Renamed' } });
    expect(res.status).toBe(200);
    expect((await res.json<{ data: { title: string } }>()).data.title).toBe('Renamed');
  });

  it('PATCH a later endAt answers 200; an earlier one answers 409', async () => {
    const later = iso(14 * DAY);
    const res = await req('PATCH', `/admin/missions/${started.mission.id}`, { token: adminToken, body: { endAt: later } });
    expect(res.status).toBe(200);
    expect((await res.json<{ data: { endAt: string } }>()).data.endAt).toBe(later);

    const earlier = await req('PATCH', `/admin/missions/${started.mission.id}`, {
      token: adminToken,
      body: { endAt: iso(10 * DAY) },
    });
    expect(earlier.status).toBe(409);
    expect(await earlier.json()).toEqual({ error: 'MISSION_STARTED', fields: ['endAt'] });
  });

  it('PATCH an endAt below now answers 400 (kept from M7)', async () => {
    const res = await req('PATCH', `/admin/missions/${started.mission.id}`, { token: adminToken, body: { endAt: iso(-1000) } });
    expect(res.status).toBe(400);
  });

  it('PATCH .../requirements/{reqId} renames in place after start and 404s on a foreign id', async () => {
    const step = started.requirements[0];
    const res = await req('PATCH', `/admin/missions/${started.mission.id}/requirements/${step.id}`, {
      token: adminToken,
      body: { title: 'Two clean demonstrations' },
    });
    expect(res.status).toBe(200);
    const renamed = (await res.json<{ data: { id: string; title: string; position: number } }>()).data;
    expect(renamed).toMatchObject({ id: step.id, title: 'Two clean demonstrations', position: 1 });

    const missing = await req('PATCH', `/admin/missions/${started.mission.id}/requirements/${crypto.randomUUID()}`, {
      token: adminToken,
      body: { title: 'Nope' },
    });
    expect(missing.status).toBe(404);
  });

  it('before start, requirements, mode and xpReward stay editable', async () => {
    const upcoming = await createMission();
    const put = await req('PUT', `/admin/missions/${upcoming.mission.id}/requirements`, {
      token: adminToken,
      body: {
        requirements: [
          { kind: 'manual_check', title: 'First' },
          { kind: 'topic_visited', title: 'Second', topicId: publishedTopic },
        ],
      },
    });
    expect(put.status).toBe(200);
    const steps = (await put.json<{ data: Array<{ position: number; title: string }> }>()).data;
    expect(steps.map((s) => [s.position, s.title])).toEqual([
      [1, 'First'],
      [2, 'Second'],
    ]);

    const patch = await req('PATCH', `/admin/missions/${upcoming.mission.id}`, {
      token: adminToken,
      body: { mode: 'parallel', enrollmentMode: 'open', xpReward: 300 },
    });
    expect(patch.status).toBe(200);
    expect((await patch.json<{ data: Body }>()).data).toMatchObject({ mode: 'parallel', enrollmentMode: 'open', xpReward: 300 });
  });
});

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

describe('PUT /admin/missions/{id}/audience', () => {
  it('answers 409 MISSION_NOT_ASSIGNED on an auto mission', async () => {
    const created = await createMission();
    const res = await req('PUT', `/admin/missions/${created.mission.id}/audience`, {
      token: adminToken,
      body: { groupIds: [], userIds: [] },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'MISSION_NOT_ASSIGNED' });
  });

  it('answers 400 UNKNOWN_AUDIENCE_TARGET for an id that does not exist', async () => {
    const created = await createMission({ enrollmentMode: 'assigned' });
    const ghost = crypto.randomUUID();
    const res = await req('PUT', `/admin/missions/${created.mission.id}/audience`, {
      token: adminToken,
      body: { groupIds: [], userIds: [ghost] },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'UNKNOWN_AUDIENCE_TARGET', groupIds: [], userIds: [ghost] });
  });

  it('enrolls covered users and sets left_at on removal, keeping progress and xp', async () => {
    const [kept, removed, member] = await Promise.all([insertUser(), insertUser(), insertUser()]);
    const groupId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO user_groups (id, name) VALUES (?, ?)").bind(groupId, `Black belts ${groupId}`),
      env.DB.prepare('INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)').bind(groupId, member),
    ]);

    const startAt = iso(DAY);
    const created = await createMission({
      startAt,
      enrollmentMode: 'assigned',
      audience: { groupIds: [groupId], userIds: [kept, removed] },
    });
    const missionId = created.mission.id;
    expect(created.audience).toEqual({ groupIds: [groupId], userIds: [kept, removed] });
    for (const userId of [kept, removed, member]) {
      expect(await enrollmentOf(missionId, userId)).toEqual({ source: 'admin', counts_from: startAt, left_at: null });
    }

    // The removed user already earned something: a step and its XP.
    const step = created.requirements[1];
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO mission_requirement_progress
             (requirement_id, user_id, mission_id, current_count, target_count, checked_at, completed_at, completed_by, recorded_at)
           VALUES (?, ?, ?, 1, 1, '2030-01-02 10:00:00', '2030-01-02 10:00:00', 'hook', '2030-01-02 10:00:00')`,
        )
        .bind(step.id, removed, missionId),
      env.DB
        .prepare(
          `INSERT INTO xp_events (id, user_id, source_kind, source_id, points, idempotency_key)
           VALUES (?, ?, 'mission_step_reward', ?, 20, ?)`,
        )
        .bind(crypto.randomUUID(), removed, step.id, `step:${step.id}`),
    ]);

    const res = await req('PUT', `/admin/missions/${missionId}/audience`, {
      token: adminToken,
      body: { groupIds: [groupId], userIds: [kept] },
    });
    expect(res.status).toBe(200);
    expect((await res.json<{ data: Body }>()).data).toEqual({ groupIds: [groupId], userIds: [kept] });

    expect((await enrollmentOf(missionId, removed))?.left_at).not.toBeNull();
    expect((await enrollmentOf(missionId, kept))?.left_at).toBeNull();
    expect((await enrollmentOf(missionId, member))?.left_at).toBeNull();

    const progress = await env.DB
      .prepare('SELECT completed_at FROM mission_requirement_progress WHERE requirement_id = ? AND user_id = ?')
      .bind(step.id, removed)
      .first<{ completed_at: string }>();
    expect(progress?.completed_at).toBe('2030-01-02 10:00:00');
    const xp = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM xp_events WHERE user_id = ? AND source_kind = 'mission_step_reward'")
      .bind(removed)
      .first<{ n: number }>();
    expect(xp?.n).toBe(1);

    // Re-adding the user re-activates the same enrollment, keeping its counts_from.
    const again = await req('PUT', `/admin/missions/${missionId}/audience`, {
      token: adminToken,
      body: { groupIds: [groupId], userIds: [kept, removed] },
    });
    expect(again.status).toBe(200);
    expect(await enrollmentOf(missionId, removed)).toEqual({ source: 'admin', counts_from: startAt, left_at: null });

    const detail = await req('GET', `/admin/missions/${missionId}`, { token: contentCreatorToken });
    expect((await detail.json<{ data: MissionDetail }>()).data.audience.userIds.sort()).toEqual([kept, removed].sort());
  });
});

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

interface ParticipantPage {
  data: Array<{
    userId: string;
    name: string | null;
    email: string | null;
    source: string;
    joinedAt: string;
    countsFrom: string;
    leftAt: string | null;
    progress: Body | null;
    steps: Array<{ requirementId: string; currentCount: number; targetCount: number; completedAt: string | null; completedBy: string | null; checkedAt: string | null }>;
  }>;
  nextCursor: string | null;
}

describe('GET /admin/missions/{id}/participants', () => {
  it('returns enrollments with per-step progress and completed_by', async () => {
    const created = await createMission();
    const missionId = created.mission.id;
    const [first, second] = created.requirements;
    const student = await insertUser();
    await enroll(missionId, student, { source: 'auto', countsFrom: created.mission.endAt });
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO mission_requirement_progress
             (requirement_id, user_id, mission_id, current_count, target_count, completed_at, completed_by, recorded_at)
           VALUES (?, ?, ?, 2, 2, '2030-01-03 09:00:00', 'reconcile', '2030-01-04 03:00:00')`,
        )
        .bind(first.id, student, missionId),
      env.DB
        .prepare(
          `INSERT INTO mission_requirement_progress (requirement_id, user_id, mission_id, current_count, target_count)
           VALUES (?, ?, ?, 0, 1)`,
        )
        .bind(second.id, student, missionId),
      env.DB
        .prepare(
          `INSERT INTO mission_progress (user_id, mission_id, current_value, target_value) VALUES (?, ?, 1, 2)`,
        )
        .bind(student, missionId),
    ]);

    const res = await req('GET', `/admin/missions/${missionId}/participants`, { token: contentCreatorToken });
    expect(res.status).toBe(200);
    const page = await res.json<ParticipantPage>();
    expect(page.nextCursor).toBeNull();
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      userId: student,
      name: 'User',
      email: `${student}@test.local`,
      source: 'auto',
      leftAt: null,
      progress: { currentValue: 1, targetValue: 2, completed: false, completedAt: null },
    });
    expect(page.data[0].steps).toEqual([
      {
        requirementId: first.id,
        currentCount: 2,
        targetCount: 2,
        checkedAt: null,
        completedAt: '2030-01-03 09:00:00',
        completedBy: 'reconcile',
      },
      { requirementId: second.id, currentCount: 0, targetCount: 1, checkedAt: null, completedAt: null, completedBy: null },
    ]);
  });

  it('pages 50 at a time with an opaque cursor', async () => {
    const created = await createMission();
    const missionId = created.mission.id;
    const users = await Promise.all(Array.from({ length: 51 }, () => insertUser()));
    for (const userId of users) await enroll(missionId, userId);

    const first = await req('GET', `/admin/missions/${missionId}/participants`, { token: adminToken });
    const page1 = await first.json<ParticipantPage>();
    expect(page1.data).toHaveLength(50);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const second = await req('GET', `/admin/missions/${missionId}/participants?cursor=${page1.nextCursor}`, {
      token: adminToken,
    });
    const page2 = await second.json<ParticipantPage>();
    expect(page2.data).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const seen = [...page1.data, ...page2.data].map((p) => p.userId);
    expect(new Set(seen).size).toBe(51);
    expect(seen.sort()).toEqual([...users].sort());
  });

  it('answers 400 InvalidCursor for a malformed cursor', async () => {
    const created = await createMission();
    for (const cursor of ['%%%', encodeURIComponent(btoa('no-separator'))]) {
      const res = await req('GET', `/admin/missions/${created.mission.id}/participants?cursor=${cursor}`, {
        token: adminToken,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'InvalidCursor' });
    }
    // A well-formed cursor past the end is just an empty page.
    const past = encodeCursor({ sortKey: '9999-12-31 23:59:59', id: 'z' });
    const empty = await req('GET', `/admin/missions/${created.mission.id}/participants?cursor=${past}`, { token: adminToken });
    expect(await empty.json()).toEqual({ data: [], nextCursor: null });
  });

  it('answers 404 for an unknown mission', async () => {
    const res = await req('GET', `/admin/missions/${crypto.randomUUID()}/participants`, { token: adminToken });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Legacy rows and delete
// ---------------------------------------------------------------------------

describe('legacy missions and delete', () => {
  it('lists a legacy predicate mission with its deprecated fields', async () => {
    const id = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO missions (id, title, description, start_at, end_at, predicate_kind, predicate_params, xp_reward)
         VALUES (?, 'Legacy', 'M7 mission', '2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z', 'topics_completed', '{"count":3}', 50)`,
      )
      .bind(id)
      .run();

    const res = await req('GET', '/admin/missions', { token: contentCreatorToken });
    expect(res.status).toBe(200);
    const legacy = (await res.json<{ data: Array<Body & { id: string }> }>()).data.find((m) => m.id === id);
    expect(legacy).toMatchObject({
      predicateKind: 'topics_completed',
      predicateParams: '{"count":3}',
      mode: 'parallel',
      enrollmentMode: 'auto',
      requirementCount: 0,
    });

    const detail = await req('GET', `/admin/missions/${id}`, { token: adminToken });
    expect(detail.status).toBe(200);
    expect((await detail.json<{ data: MissionDetail }>()).data.requirements).toEqual([]);
  });

  it('DELETE soft-deletes and 404s on an unknown id', async () => {
    const created = await createMission();
    const res = await req('DELETE', `/admin/missions/${created.mission.id}`, { token: adminToken });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { success: true } });

    const detail = await req('GET', `/admin/missions/${created.mission.id}`, { token: adminToken });
    expect((await detail.json<{ data: MissionDetail }>()).data.mission.active).toBe(false);

    const missing = await req('DELETE', `/admin/missions/${crypto.randomUUID()}`, { token: adminToken });
    expect(missing.status).toBe(404);
  });
});
