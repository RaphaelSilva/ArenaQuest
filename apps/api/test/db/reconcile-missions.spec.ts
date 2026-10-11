import { env, createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { buildContainer } from '@api/container';
import { D1EnrollmentRepository } from '@api/adapters/db/d1-enrollment-repository';
import { D1MissionParticipationRepository } from '@api/adapters/db/d1-mission-participation-repository';
import { reconcileMissions, type ReconcileMissionsDeps } from '@api/jobs/reconcile-missions';
import { applyMigrations } from '../helpers/apply-migrations';
import {
  enroll,
  insertEvidence,
  insertMedia,
  insertMission,
  insertRequirement,
  insertSubmission,
  insertTopic,
  insertUser,
} from './mission-fixtures';

/**
 * The daily mission reconciliation (RFC 0022 §4; M27 Task 08) against a real D1:
 * through `scheduled()` with the hooks bypassed (rows inserted directly), the scope
 * window, the set-based materialisation of implicit enrollments and the evidence
 * backfill. Every instant is relative to the real clock, because `scheduled()` reads it.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ADMIN_ROLE = 'bace0701-15e3-5144-97c5-47487d543032';
const CONTENT_CREATOR_ROLE = '3318927d-8b5e-52d9-a145-2e4323919ed6';
const STUDENT_ROLE = 'bf3d0f1d-7d77-5151-922e-b87dff0fa7ad';

const isoAt = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
/** SQLite `YYYY-MM-DD HH:MM:SS` (UTC), the form the source tables store. */
const sqliteAt = (offsetMs: number) => isoAt(offsetMs).slice(0, 19).replace('T', ' ');

beforeAll(async () => {
  await applyMigrations(env.DB);
});

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function topicWith(opts: { visibility?: 'public' | 'restricted' | 'private'; parentId?: string } = {}) {
  const id = await insertTopic();
  await env.DB
    .prepare("UPDATE topic_nodes SET status = 'published', visibility = ?, parent_id = ? WHERE id = ?")
    .bind(opts.visibility ?? 'restricted', opts.parentId ?? null, id)
    .run();
  return id;
}

async function userWith(opts: { role?: string; status?: string } = {}) {
  const id = await insertUser();
  if (opts.status) await env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(opts.status, id).run();
  if (opts.role) {
    await env.DB.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').bind(id, opts.role).run();
  }
  return id;
}

async function grantUser(userId: string, topicId: string, grantedBy: string) {
  await env.DB
    .prepare('INSERT INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, topicId, grantedBy)
    .run();
}

async function groupOf(memberIds: string[]) {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO user_groups (id, name) VALUES (?, ?)').bind(id, `group-${id}`).run();
  for (const userId of memberIds) {
    await env.DB.prepare('INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)').bind(id, userId).run();
  }
  return id;
}

async function insertBadge() {
  const id = crypto.randomUUID();
  await env.DB
    .prepare("INSERT INTO badges (id, slug, name, icon_emoji, rule_kind) VALUES (?, ?, 'Finisher', '*', 'manual')")
    .bind(id, `finisher-${id}`)
    .run();
  return id;
}

async function enrollmentOf(missionId: string, userId: string) {
  return env.DB
    .prepare('SELECT source, counts_from, left_at FROM mission_enrollments WHERE mission_id = ? AND user_id = ?')
    .bind(missionId, userId)
    .first<{ source: string; counts_from: string; left_at: string | null }>();
}

async function evidenceOf(requirementId: string, userId: string) {
  const { results } = await env.DB
    .prepare('SELECT ref_id, occurred_at, source FROM mission_evidence WHERE requirement_id = ? AND user_id = ? ORDER BY ref_id')
    .bind(requirementId, userId)
    .all<{ ref_id: string; occurred_at: string; source: string }>();
  return results;
}

async function insertXpEvent(userId: string, sourceKind: string, sourceId: string, earnedAt: string) {
  await env.DB
    .prepare(
      `INSERT INTO xp_events (id, user_id, source_kind, source_id, points, idempotency_key, earned_at)
       VALUES (?, ?, ?, ?, 10, ?, ?)`,
    )
    .bind(crypto.randomUUID(), userId, sourceKind, sourceId, `${sourceKind}:${sourceId}`, earnedAt)
    .run();
}

async function insertTopicProgress(userId: string, topicId: string, status: string, createdAt: string, updatedAt: string) {
  await env.DB
    .prepare(
      `INSERT INTO topic_progress (id, user_id, topic_node_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), userId, topicId, status, createdAt, updatedAt)
    .run();
}

/** Every row of the tables the job may write, for a byte-for-byte comparison. */
async function snapshot() {
  const tables = [
    'mission_enrollments',
    'mission_requirement_progress',
    'mission_evidence',
    'mission_progress',
    'xp_events',
    'user_badges',
    'user_xp',
    'user_streak',
  ];
  const out: Record<string, unknown[]> = {};
  for (const table of tables) {
    out[table] = (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
  }
  return out;
}

async function runScheduled(workerEnv: AppEnv = env as AppEnv) {
  const controller = createScheduledController({ scheduledTime: Date.now(), cron: '0 3 * * *' });
  const ctx = createExecutionContext();
  try {
    await worker.scheduled(controller, workerEnv, ctx);
  } finally {
    await waitOnExecutionContext(ctx);
  }
}

function jobDeps(now: Date): ReconcileMissionsDeps {
  const container = buildContainer(env as AppEnv);
  return {
    missions: container.gamification.missionRepo,
    participation: container.gamification.missionParticipationRepo,
    evaluator: container.gamification.missionEvaluator,
    now: () => now,
  };
}

/** The structured log lines with an `event` field, from one console method's spy. */
function events(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls.flatMap((call) => {
    try {
      const parsed = JSON.parse(String(call[0]));
      return parsed && typeof parsed === 'object' && 'event' in parsed ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function quietConsole() {
  return {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  };
}

/** A D1 whose `prepare` throws for statements matching `pattern`; everything else is the real one. */
function faultyDb(real: D1Database, pattern: RegExp): D1Database {
  return {
    prepare: (sql: string) => {
      if (pattern.test(sql)) throw new Error('D1 is down');
      return real.prepare(sql);
    },
    batch: (statements: D1PreparedStatement[]) => real.batch(statements),
    exec: (sql: string) => real.exec(sql),
    dump: () => real.dump(),
    withSession: (constraint?: string) => real.withSession(constraint),
  } as unknown as D1Database;
}

/** A live `auto` mission with one 3-submission step on a public topic, reward XP and a badge. */
async function liveSubmissionMission() {
  const topicId = await topicWith({ visibility: 'public' });
  const badgeId = await insertBadge();
  const missionId = await insertMission({ startAt: isoAt(-2 * DAY), endAt: isoAt(5 * DAY) });
  await env.DB.prepare('UPDATE missions SET xp_reward = 100, badge_id = ? WHERE id = ?').bind(badgeId, missionId).run();
  const requirementId = await insertRequirement(missionId, 1, 'submissions_on_topic', {
    topicId,
    params: { minCount: 3 },
  });
  await env.DB.prepare('UPDATE mission_requirements SET xp_reward = 20 WHERE id = ?').bind(requirementId).run();
  return { topicId, badgeId, missionId, requirementId };
}

// ---------------------------------------------------------------------------
// scheduled()
// ---------------------------------------------------------------------------

describe('scheduled() - mission reconciliation', () => {
  it('completes a mission whose hooks were skipped, with completed_by = reconcile and the third submission as completed_at', async () => {
    const console_ = quietConsole();
    const { topicId, badgeId, missionId, requirementId } = await liveSubmissionMission();
    const student = await userWith({ role: STUDENT_ROLE });
    const third = sqliteAt(-12 * HOUR);
    await insertSubmission(topicId, student, sqliteAt(-36 * HOUR));
    await insertSubmission(topicId, student, sqliteAt(-24 * HOUR));
    await insertSubmission(topicId, student, third);

    await runScheduled();

    expect(await enrollmentOf(missionId, student)).toMatchObject({ source: 'auto', left_at: null });
    const step = await env.DB
      .prepare('SELECT current_count, completed_at, completed_by FROM mission_requirement_progress WHERE requirement_id = ? AND user_id = ?')
      .bind(requirementId, student)
      .first();
    expect(step).toEqual({ current_count: 3, completed_at: third, completed_by: 'reconcile' });

    const progress = await env.DB
      .prepare('SELECT current_value, target_value, completed FROM mission_progress WHERE mission_id = ? AND user_id = ?')
      .bind(missionId, student)
      .first();
    expect(progress).toEqual({ current_value: 1, target_value: 1, completed: 1 });

    const { results: xp } = await env.DB
      .prepare("SELECT source_kind, source_id, points FROM xp_events WHERE user_id = ? AND source_kind LIKE 'mission_%' ORDER BY source_kind")
      .bind(student)
      .all();
    expect(xp).toEqual([
      { source_kind: 'mission_reward', source_id: missionId, points: 100 },
      { source_kind: 'mission_step_reward', source_id: requirementId, points: 20 },
    ]);
    const badge = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM user_badges WHERE user_id = ? AND badge_id = ?')
      .bind(student, badgeId)
      .first<{ n: number }>();
    expect(badge?.n).toBe(1);

    const line = events(console_.log).find((e) => e.event === 'missions.reconcile');
    expect(line).toMatchObject({ trigger: 'scheduled', failed: 0 });
    expect(line?.stepsClosed).toBeGreaterThanOrEqual(1);
    expect(line?.missionsClosed).toBeGreaterThanOrEqual(1);
    // Counts only: no user id ever reaches the log line.
    expect(JSON.stringify(line)).not.toContain(student);
  });

  it('a second run in a row changes no row', async () => {
    quietConsole();
    const { topicId } = await liveSubmissionMission();
    const student = await userWith({ role: STUDENT_ROLE });
    for (const offset of [-30, -20, -10]) await insertSubmission(topicId, student, sqliteAt(offset * HOUR));

    await runScheduled();
    const after = await snapshot();
    await runScheduled();

    expect(await snapshot()).toEqual(after);
  });

  it('keeps a completed mission intact after its evidence is deleted, and never writes user_streak', async () => {
    quietConsole();
    const { topicId, missionId, requirementId } = await liveSubmissionMission();
    const student = await userWith({ role: STUDENT_ROLE });
    for (const offset of [-30, -20, -10]) await insertSubmission(topicId, student, sqliteAt(offset * HOUR));

    await runScheduled();
    const completed = await snapshot();

    await env.DB.prepare('DELETE FROM topic_submissions WHERE author_id = ?').bind(student).run();
    await runScheduled();

    const after = await snapshot();
    expect(after.mission_requirement_progress).toEqual(completed.mission_requirement_progress);
    expect(after.mission_progress).toEqual(completed.mission_progress);
    expect(after.xp_events).toEqual(completed.xp_events);
    expect(after.user_badges).toEqual(completed.user_badges);

    const step = await env.DB
      .prepare('SELECT completed_at FROM mission_requirement_progress WHERE requirement_id = ? AND user_id = ?')
      .bind(requirementId, student)
      .first<{ completed_at: string | null }>();
    expect(step?.completed_at).not.toBeNull();
    const mission = await env.DB
      .prepare('SELECT completed FROM mission_progress WHERE mission_id = ? AND user_id = ?')
      .bind(missionId, student)
      .first<{ completed: number }>();
    expect(mission?.completed).toBe(1);
    const streak = await env.DB.prepare('SELECT * FROM user_streak WHERE user_id = ?').bind(student).first();
    expect(streak).toBeNull();
  });

  it('a failing reconciliation neither throws nor stops billing and the sweep', async () => {
    const console_ = quietConsole();
    // Every mission read fails: the job counts the failure and returns.
    await expect(
      runScheduled({ ...env, DB: faultyDb(env.DB, /\bmissions\b/) } as unknown as AppEnv),
    ).resolves.toBeUndefined();

    expect(events(console_.info).map((e) => e.event)).toContain('billing.invoice_run');
    expect(events(console_.log).map((e) => e.event)).toContain('submissions.sweep_pending');
    expect(events(console_.error)).toContainEqual(expect.objectContaining({ event: 'missions.reconcile', failed: 1 }));
  });

  it('a failing billing run does not skip the sweep or the reconciliation', async () => {
    const console_ = quietConsole();
    const { topicId, requirementId } = await liveSubmissionMission();
    const student = await userWith({ role: STUDENT_ROLE });
    for (const offset of [-30, -20, -10]) await insertSubmission(topicId, student, sqliteAt(offset * HOUR));

    // Billing's first read fails, so `scheduled()` rejects with billing's error after
    // the two `finally` links ran.
    await expect(
      runScheduled({ ...env, DB: faultyDb(env.DB, /\bsubscriptions\b/) } as unknown as AppEnv),
    ).rejects.toThrow('D1 is down');

    expect(events(console_.log).map((e) => e.event)).toEqual(
      expect.arrayContaining(['submissions.sweep_pending', 'missions.reconcile']),
    );
    const step = await env.DB
      .prepare('SELECT completed_by FROM mission_requirement_progress WHERE requirement_id = ? AND user_id = ?')
      .bind(requirementId, student)
      .first<{ completed_by: string }>();
    expect(step?.completed_by).toBe('reconcile');
  });
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

describe('reconcileMissions - scope', () => {
  it('reconciles a mission ended 47 h ago and skips one ended 49 h ago', async () => {
    quietConsole();
    const topicId = await topicWith({ visibility: 'public' });
    const student = await userWith({ role: STUDENT_ROLE });
    await insertSubmission(topicId, student, sqliteAt(-4 * DAY));

    const recent = await insertMission({ startAt: isoAt(-10 * DAY), endAt: isoAt(-47 * HOUR) });
    const recentReq = await insertRequirement(recent, 1, 'submissions_on_topic', { topicId, params: { minCount: 1 } });
    const stale = await insertMission({ startAt: isoAt(-10 * DAY), endAt: isoAt(-49 * HOUR) });
    const staleReq = await insertRequirement(stale, 1, 'submissions_on_topic', { topicId, params: { minCount: 1 } });

    const report = await reconcileMissions(jobDeps(new Date()));
    expect(report.failed).toBe(0);

    const stepOf = (requirementId: string) =>
      env.DB
        .prepare('SELECT completed_by FROM mission_requirement_progress WHERE requirement_id = ? AND user_id = ?')
        .bind(requirementId, student)
        .first<{ completed_by: string }>();
    expect((await stepOf(recentReq))?.completed_by).toBe('reconcile');
    expect(await enrollmentOf(stale, student)).toBeNull();
    expect(await stepOf(staleReq)).toBeNull();
  });

  it('skips inactive, legacy and not-yet-started missions', async () => {
    quietConsole();
    const topicId = await topicWith({ visibility: 'public' });
    const student = await userWith({ role: STUDENT_ROLE });
    const inactive = await insertMission({ startAt: isoAt(-DAY), endAt: isoAt(DAY), active: false });
    const future = await insertMission({ startAt: isoAt(DAY), endAt: isoAt(2 * DAY) });
    for (const id of [inactive, future]) {
      await insertRequirement(id, 1, 'submissions_on_topic', { topicId, params: { minCount: 1 } });
    }
    const legacy = await insertMission({ startAt: isoAt(-DAY), endAt: isoAt(DAY), predicateKind: 'watch_video' });

    await reconcileMissions(jobDeps(new Date()));

    for (const id of [inactive, future, legacy]) expect(await enrollmentOf(id, student)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// materializeImplicitEnrollments
// ---------------------------------------------------------------------------

describe('D1MissionParticipationRepository.materializeImplicitEnrollments', () => {
  const repo = () => new D1MissionParticipationRepository(env.DB);

  it('auto: enrolls granted and public-only students, never staff, inactive or gated-out users, in parity with getEffectiveAccessTopicIds', async () => {
    const grantor = await userWith();
    const parent = await topicWith({ visibility: 'restricted' });
    const child = await topicWith({ visibility: 'restricted', parentId: parent });
    const publicTopic = await topicWith({ visibility: 'public' });

    const viaAncestor = await userWith({ role: STUDENT_ROLE });
    await grantUser(viaAncestor, parent, grantor);
    const viaGroup = await userWith({ role: STUDENT_ROLE });
    const group = await groupOf([viaGroup]);
    await env.DB
      .prepare('INSERT INTO enrollments_user_group (id, group_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), group, child, grantor)
      .run();
    const gatedOut = await userWith({ role: STUDENT_ROLE });
    const admin = await userWith({ role: ADMIN_ROLE });
    await grantUser(admin, parent, grantor);
    const creator = await userWith({ role: CONTENT_CREATOR_ROLE });
    await grantUser(creator, parent, grantor);
    const inactive = await userWith({ role: STUDENT_ROLE, status: 'inactive' });
    await grantUser(inactive, parent, grantor);

    const startAt = isoAt(-DAY);
    const gated = await insertMission({ startAt, endAt: isoAt(DAY) });
    const created = await repo().materializeImplicitEnrollments(
      { id: gated, startAt, enrollmentMode: 'auto' },
      [child, publicTopic],
    );
    expect(created).toBe(2);

    expect(await enrollmentOf(gated, viaAncestor)).toEqual({ source: 'auto', counts_from: startAt, left_at: null });
    expect(await enrollmentOf(gated, viaGroup)).toMatchObject({ source: 'auto' });
    for (const userId of [gatedOut, admin, creator, inactive]) expect(await enrollmentOf(gated, userId)).toBeNull();

    // Public-only: a target set holding only a public topic enrolls a student with no grant.
    const open = await insertMission({ startAt, endAt: isoAt(DAY) });
    await repo().materializeImplicitEnrollments({ id: open, startAt, enrollmentMode: 'auto' }, [publicTopic]);
    expect(await enrollmentOf(open, gatedOut)).toMatchObject({ source: 'auto' });
    expect(await enrollmentOf(open, admin)).toBeNull();

    // Parity with the single-user effective access set, for every non-staff active user.
    const access = new D1EnrollmentRepository(env.DB);
    for (const userId of [viaAncestor, viaGroup, gatedOut]) {
      const set = new Set(await access.getEffectiveAccessTopicIds(userId));
      const reachable = [child, publicTopic].every((t) => set.has(t));
      expect(await enrollmentOf(gated, userId) !== null).toBe(reachable);
    }
  });

  it('auto: a private target enrolls nobody, even a granted student', async () => {
    const grantor = await userWith();
    const secret = await topicWith({ visibility: 'private' });
    const student = await userWith({ role: STUDENT_ROLE });
    await grantUser(student, secret, grantor);
    const startAt = isoAt(-DAY);
    const mission = await insertMission({ startAt, endAt: isoAt(DAY) });

    expect(await repo().materializeImplicitEnrollments({ id: mission, startAt, enrollmentMode: 'auto' }, [secret])).toBe(0);
    expect(await enrollmentOf(mission, student)).toBeNull();
  });

  it('auto without topic targets enrolls every active non-staff user; an existing left row is untouched; a second call inserts nothing', async () => {
    const startAt = isoAt(-DAY);
    const mission = await insertMission({ startAt, endAt: isoAt(DAY) });
    const student = await userWith({ role: STUDENT_ROLE });
    const noRole = await userWith();
    const admin = await userWith({ role: ADMIN_ROLE });
    const leaver = await userWith({ role: STUDENT_ROLE });
    await enroll(mission, leaver, { source: 'self', countsFrom: isoAt(-HOUR), leftAt: isoAt(-1000) });

    expect(await repo().materializeImplicitEnrollments({ id: mission, startAt, enrollmentMode: 'auto' }, [])).toBeGreaterThan(0);
    expect(await enrollmentOf(mission, student)).toMatchObject({ source: 'auto', counts_from: startAt });
    expect(await enrollmentOf(mission, noRole)).toMatchObject({ source: 'auto' });
    expect(await enrollmentOf(mission, admin)).toBeNull();
    expect(await enrollmentOf(mission, leaver)).toMatchObject({ source: 'self', left_at: expect.any(String) });

    expect(await repo().materializeImplicitEnrollments({ id: mission, startAt, enrollmentMode: 'auto' }, [])).toBe(0);
  });

  it('assigned: enrolls direct audience users and members of the audience groups as admin, nobody else', async () => {
    const startAt = isoAt(-DAY);
    const mission = await insertMission({ startAt, endAt: isoAt(DAY), enrollmentMode: 'assigned' });
    const direct = await userWith({ role: STUDENT_ROLE });
    const member = await userWith({ role: STUDENT_ROLE });
    const outsider = await userWith({ role: STUDENT_ROLE });
    const group = await groupOf([member]);
    await env.DB.prepare('INSERT INTO mission_audience_user (mission_id, user_id) VALUES (?, ?)').bind(mission, direct).run();
    await env.DB.prepare('INSERT INTO mission_audience_group (mission_id, group_id) VALUES (?, ?)').bind(mission, group).run();

    expect(await repo().materializeImplicitEnrollments({ id: mission, startAt, enrollmentMode: 'assigned' }, [])).toBe(2);
    expect(await enrollmentOf(mission, direct)).toEqual({ source: 'admin', counts_from: startAt, left_at: null });
    expect(await enrollmentOf(mission, member)).toEqual({ source: 'admin', counts_from: startAt, left_at: null });
    expect(await enrollmentOf(mission, outsider)).toBeNull();
  });

  it('open: enrolls nobody', async () => {
    const startAt = isoAt(-DAY);
    const mission = await insertMission({ startAt, endAt: isoAt(DAY), enrollmentMode: 'open' });
    await userWith({ role: STUDENT_ROLE });
    expect(await repo().materializeImplicitEnrollments({ id: mission, startAt, enrollmentMode: 'open' }, [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// backfillEvidence
// ---------------------------------------------------------------------------

describe('D1MissionParticipationRepository.backfillEvidence', () => {
  const repo = () => new D1MissionParticipationRepository(env.DB);

  it('video_watched: inserts a first watch inside the window, skips one outside it, other topics, non-video media and non-enrolled users, and keeps hook rows', async () => {
    const uploader = await userWith();
    const topic = await topicWith({ visibility: 'public' });
    const otherTopic = await topicWith({ visibility: 'public' });
    const inside = await insertMedia(topic, uploader);
    const before = await insertMedia(topic, uploader);
    const hooked = await insertMedia(topic, uploader);
    const elsewhere = await insertMedia(otherTopic, uploader);
    const pdf = await insertMedia(topic, uploader, { type: 'application/pdf' });

    const startAt = isoAt(-2 * DAY);
    const endAt = isoAt(5 * DAY);
    const mission = await insertMission({ startAt, endAt });
    const requirement = await insertRequirement(mission, 1, 'video_watched', { topicId: topic, params: { minCount: 2 } });
    const student = await userWith({ role: STUDENT_ROLE });
    const stranger = await userWith({ role: STUDENT_ROLE });
    await enroll(mission, student, { countsFrom: startAt });

    const watchedAt = sqliteAt(-DAY);
    await insertXpEvent(student, 'video', inside, watchedAt);
    await insertXpEvent(student, 'video', before, sqliteAt(-3 * DAY));
    await insertXpEvent(student, 'video', hooked, sqliteAt(-20 * HOUR));
    await insertXpEvent(student, 'video', elsewhere, watchedAt);
    await insertXpEvent(student, 'video', pdf, watchedAt);
    await insertXpEvent(stranger, 'video', inside, watchedAt);
    const hookAt = sqliteAt(-10 * HOUR);
    await insertEvidence(requirement, student, hooked, hookAt);

    const args = { mission: { id: mission, startAt, endAt }, requirement: { id: requirement, kind: 'video_watched' as const, topicId: topic } };
    expect(await repo().backfillEvidence(args.mission, args.requirement)).toBe(1);

    const rows = await evidenceOf(requirement, student);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ ref_id: inside, occurred_at: watchedAt, source: 'backfill' });
    expect(rows).toContainEqual({ ref_id: hooked, occurred_at: hookAt, source: 'hook' });
    expect(await evidenceOf(requirement, stranger)).toEqual([]);

    // Idempotent.
    expect(await repo().backfillEvidence(args.mission, args.requirement)).toBe(0);
  });

  it('topic_visited: a visit from topic_progress.created_at, or updated_at while in progress, inside the window only', async () => {
    const topic = await topicWith({ visibility: 'public' });
    const startAt = isoAt(-2 * DAY);
    const endAt = isoAt(5 * DAY);
    const mission = await insertMission({ startAt, endAt });
    const requirement = await insertRequirement(mission, 1, 'topic_visited', { topicId: topic });

    const created = await userWith({ role: STUDENT_ROLE });
    const updated = await userWith({ role: STUDENT_ROLE });
    const finished = await userWith({ role: STUDENT_ROLE });
    for (const userId of [created, updated, finished]) await enroll(mission, userId, { countsFrom: startAt });

    const createdAt = sqliteAt(-DAY);
    await insertTopicProgress(created, topic, 'completed', createdAt, sqliteAt(-HOUR));
    const updatedAt = sqliteAt(-5 * HOUR);
    await insertTopicProgress(updated, topic, 'in_progress', sqliteAt(-10 * DAY), updatedAt);
    // A completed row's updated_at is not a visit, and its creation is before the window.
    await insertTopicProgress(finished, topic, 'completed', sqliteAt(-10 * DAY), sqliteAt(-HOUR));

    const result = await repo().backfillEvidence(
      { id: mission, startAt, endAt },
      { id: requirement, kind: 'topic_visited', topicId: topic },
    );
    expect(result).toBe(2);
    expect(await evidenceOf(requirement, created)).toEqual([{ ref_id: topic, occurred_at: createdAt, source: 'backfill' }]);
    expect(await evidenceOf(requirement, updated)).toEqual([{ ref_id: topic, occurred_at: updatedAt, source: 'backfill' }]);
    expect(await evidenceOf(requirement, finished)).toEqual([]);
  });

  it('other kinds insert nothing', async () => {
    const topic = await topicWith({ visibility: 'public' });
    const startAt = isoAt(-DAY);
    const endAt = isoAt(DAY);
    const mission = await insertMission({ startAt, endAt });
    const requirement = await insertRequirement(mission, 1, 'submissions_on_topic', { topicId: topic, params: { minCount: 1 } });
    expect(
      await repo().backfillEvidence({ id: mission, startAt, endAt }, { id: requirement, kind: 'submissions_on_topic', topicId: topic }),
    ).toBe(0);
  });
});
