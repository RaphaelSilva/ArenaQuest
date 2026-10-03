import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1MissionEvidenceRepository } from '@api/adapters/db/d1-mission-evidence-repository';
import { D1MissionRepository } from '@api/adapters/db/d1-mission-repository';
import type { EvidenceCount } from '@arenaquest/shared/ports/i-mission-evidence-repository';
import type { Mission, MissionRequirement } from '@arenaquest/shared/domain/mission';
import { applyMigrations } from '../helpers/apply-migrations';
import {
  enroll,
  insertCharge,
  insertEvent,
  insertEvidence,
  insertMedia,
  insertMission,
  insertRequirement,
  insertSubmission,
  insertTopic,
  insertUser,
} from './mission-fixtures';

/**
 * RFC 0022 §3.3–§3.4. The mission window is stored in ISO-8601 (`…T10:00:00.000Z`)
 * and the evidence fixtures use both the SQLite form and ISO-8601, so every edge
 * proves the `datetime()` normalisation on both sides.
 */
const START = '2026-05-01T10:00:00.000Z';
const END = '2026-05-31T23:59:59.000Z';
const NOW = '2026-05-20T12:00:00.000Z';

describe('D1MissionEvidenceRepository.countForRequirement', () => {
  let evidence: D1MissionEvidenceRepository;
  let missions: D1MissionRepository;
  let admin: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    evidence = new D1MissionEvidenceRepository(env.DB);
    missions = new D1MissionRepository(env.DB);
    admin = await insertUser();
  });

  async function loadMission(id: string): Promise<Mission> {
    const mission = await missions.findById(id);
    if (!mission) throw new Error('fixture mission missing');
    return mission;
  }

  async function loadRequirement(missionId: string, id: string): Promise<MissionRequirement> {
    const found = (await missions.listRequirements(missionId)).find(r => r.id === id);
    if (!found) throw new Error('fixture requirement missing');
    return found;
  }

  async function count(
    missionId: string,
    requirementId: string,
    opts: { userId?: string | null; previous?: string | null; now?: string; sharingEnabled?: boolean } = {},
  ): Promise<EvidenceCount[]> {
    return evidence.countForRequirement({
      mission: await loadMission(missionId),
      requirement: await loadRequirement(missionId, requirementId),
      previousRequirementId: opts.previous ?? null,
      userId: opts.userId === undefined ? null : opts.userId,
      nowIso: opts.now ?? NOW,
      sharingEnabled: opts.sharingEnabled ?? true,
    });
  }

  async function one(missionId: string, requirementId: string, userId: string, opts: { sharingEnabled?: boolean; now?: string } = {}) {
    const rows = await count(missionId, requirementId, { ...opts, userId });
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  /** A requirements mission with one step and one enrolled user. */
  async function setup(
    kind: string,
    opts: { params?: unknown; topicId?: string; eventId?: string } = {},
  ): Promise<{ mission: string; req: string; user: string; topic: string }> {
    const topic = opts.topicId ?? (await insertTopic());
    const mission = await insertMission({ startAt: START, endAt: END });
    const target = kind === 'event_participation' ? { eventId: opts.eventId } : kind === 'manual_check' ? {} : { topicId: topic };
    const req = await insertRequirement(mission, 1, kind, { ...target, params: opts.params ?? {} });
    const user = await insertUser();
    await enroll(mission, user);
    return { mission, req, user, topic };
  }

  describe('submissions_on_topic', () => {
    it('excludes 09:59:59 and includes 10:00:00 at the window start, in both timestamp formats', async () => {
      const { mission, req, user, topic } = await setup('submissions_on_topic', { params: { minCount: 1 } });
      await insertSubmission(topic, user, '2026-05-01 09:59:59');
      await insertSubmission(topic, user, '2026-05-01 10:00:00');
      expect(await one(mission, req, user)).toEqual({ userId: user, count: 1, kthAt: '2026-05-01 10:00:00' });

      const iso = await insertUser();
      await enroll(mission, iso);
      await insertSubmission(topic, iso, '2026-05-01T09:59:59.000Z');
      await insertSubmission(topic, iso, '2026-05-01T10:00:00.000Z');
      expect(await one(mission, req, iso)).toEqual({ userId: iso, count: 1, kthAt: '2026-05-01 10:00:00' });
    });

    it('excludes items after now and after the mission end', async () => {
      const { mission, req, user, topic } = await setup('submissions_on_topic', { params: { minCount: 1 } });
      await insertSubmission(topic, user, '2026-05-20 12:00:01');
      expect((await one(mission, req, user)).count).toBe(0);
      // Once now passes the end, the bound is the end itself.
      expect((await one(mission, req, user, { now: '2026-06-10T00:00:00.000Z' })).count).toBe(1);
      await insertSubmission(topic, user, '2026-06-01 00:00:00');
      expect((await one(mission, req, user, { now: '2026-06-10T00:00:00.000Z' })).count).toBe(1);
    });

    it('counts three described submissions with kthAt = t3, and two once a description is emptied', async () => {
      const { mission, req, user, topic } = await setup('submissions_on_topic', {
        params: { minCount: 3, requireDescription: true },
      });
      await insertSubmission(topic, user, '2026-05-02 10:00:00');
      const t2 = await insertSubmission(topic, user, '2026-05-03 10:00:00');
      await insertSubmission(topic, user, '2026-05-04 10:00:00');
      expect(await one(mission, req, user)).toEqual({ userId: user, count: 3, kthAt: '2026-05-04 10:00:00' });

      await env.DB.prepare("UPDATE topic_submissions SET description = '' WHERE id = ?").bind(t2).run();
      expect(await one(mission, req, user)).toEqual({ userId: user, count: 2, kthAt: null });
    });

    it('ignores the description when requireDescription is false', async () => {
      const { mission, req, user, topic } = await setup('submissions_on_topic', { params: { minCount: 1 } });
      await insertSubmission(topic, user, '2026-05-02 10:00:00', { description: '' });
      expect((await one(mission, req, user)).count).toBe(1);
    });

    it('shared_only counts shared rows only, and none while sharing is disabled', async () => {
      const { mission, req, user, topic } = await setup('submissions_on_topic', {
        params: { minCount: 1, visibility: 'shared_only' },
      });
      await insertSubmission(topic, user, '2026-05-02 10:00:00', { visibility: 'private' });
      await insertSubmission(topic, user, '2026-05-03 10:00:00', { visibility: 'shared' });
      expect(await one(mission, req, user, { sharingEnabled: true })).toEqual({ userId: user, count: 1, kthAt: '2026-05-03 10:00:00' });
      expect((await one(mission, req, user, { sharingEnabled: false })).count).toBe(0);
    });

    it("visibility 'any' counts private and shared rows, whatever the sharing switch", async () => {
      const { mission, req, user, topic } = await setup('submissions_on_topic', { params: { minCount: 2 } });
      await insertSubmission(topic, user, '2026-05-02 10:00:00', { visibility: 'private' });
      await insertSubmission(topic, user, '2026-05-03 10:00:00', { visibility: 'shared' });
      expect((await one(mission, req, user, { sharingEnabled: false })).count).toBe(2);
    });

    it('a moderated submission counts only with countModerated', async () => {
      const skip = await setup('submissions_on_topic', { params: { minCount: 1 } });
      await insertSubmission(skip.topic, skip.user, '2026-05-02 10:00:00', { moderatedAt: '2026-05-03 10:00:00' });
      expect((await one(skip.mission, skip.req, skip.user)).count).toBe(0);

      const keep = await setup('submissions_on_topic', { params: { minCount: 1, countModerated: true } });
      await insertSubmission(keep.topic, keep.user, '2026-05-02 10:00:00', { moderatedAt: '2026-05-03 10:00:00' });
      expect((await one(keep.mission, keep.req, keep.user)).count).toBe(1);
    });

    it('a submission moved in from an older upload keeps its created_at and does not count', async () => {
      const { mission, req, user, topic } = await setup('submissions_on_topic', { params: { minCount: 1 } });
      const elsewhere = await insertTopic();
      const old = await insertSubmission(elsewhere, user, '2026-04-10 10:00:00');
      await env.DB
        .prepare("UPDATE topic_submissions SET topic_node_id = ?, updated_at = '2026-05-10 10:00:00' WHERE id = ?")
        .bind(topic, old)
        .run();
      expect((await one(mission, req, user)).count).toBe(0);
    });

    it('pending and removed submissions never count; other topics and authors neither', async () => {
      const { mission, req, user, topic } = await setup('submissions_on_topic', { params: { minCount: 1 } });
      await insertSubmission(topic, user, '2026-05-02 10:00:00', { status: 'pending' });
      await insertSubmission(topic, user, '2026-05-02 11:00:00', { status: 'removed' });
      await insertSubmission(await insertTopic(), user, '2026-05-02 12:00:00');
      await insertSubmission(topic, await insertUser(), '2026-05-02 13:00:00');
      expect(await one(mission, req, user)).toEqual({ userId: user, count: 0, kthAt: null });
    });

    it("opens at counts_from when it is later than the mission start (a 'self' join)", async () => {
      const { mission, req, topic } = await setup('submissions_on_topic', { params: { minCount: 1 } });
      const joiner = await insertUser();
      await enroll(mission, joiner, { source: 'self', countsFrom: '2026-05-10T08:00:00.000Z' });
      await insertSubmission(topic, joiner, '2026-05-10 07:59:59');
      expect((await one(mission, req, joiner)).count).toBe(0);
      await insertSubmission(topic, joiner, '2026-05-10 08:00:00');
      expect(await one(mission, req, joiner)).toEqual({ userId: joiner, count: 1, kthAt: '2026-05-10 08:00:00' });
    });
  });

  describe('event_participation', () => {
    it('a paid charge counts at the event start: future 0, past 1; void and open 0', async () => {
      const future = await insertEvent('2026-05-21 19:00:00', admin);
      const past = await insertEvent('2026-05-10 19:00:00', admin);

      const f = await setup('event_participation', { eventId: future });
      await insertCharge(future, f.user, 'paid', admin);
      expect(await one(f.mission, f.req, f.user)).toEqual({ userId: f.user, count: 0, kthAt: null });
      // Once now passes the start, the same charge counts at the start instant.
      expect(await one(f.mission, f.req, f.user, { now: '2026-05-21T19:00:00.000Z' })).toEqual({
        userId: f.user,
        count: 1,
        kthAt: '2026-05-21 19:00:00',
      });

      const p = await setup('event_participation', { eventId: past });
      await insertCharge(past, p.user, 'paid', admin);
      expect(await one(p.mission, p.req, p.user)).toEqual({ userId: p.user, count: 1, kthAt: '2026-05-10 19:00:00' });

      const voided = await insertUser();
      const open = await insertUser();
      await enroll(p.mission, voided);
      await enroll(p.mission, open);
      await insertCharge(past, voided, 'void', admin);
      await insertCharge(past, open, 'open', admin);
      expect((await one(p.mission, p.req, voided)).count).toBe(0);
      expect((await one(p.mission, p.req, open)).count).toBe(0);
    });

    it('a charge reversed back to open stops qualifying', async () => {
      const event = await insertEvent('2026-05-10 19:00:00', admin);
      const { mission, req, user } = await setup('event_participation', { eventId: event });
      const charge = await insertCharge(event, user, 'paid', admin);
      expect((await one(mission, req, user)).count).toBe(1);
      await env.DB.prepare("UPDATE event_charges SET status = 'open' WHERE id = ?").bind(charge).run();
      expect((await one(mission, req, user)).count).toBe(0);
    });

    it('an event that started before the window does not count', async () => {
      const event = await insertEvent('2026-05-01 09:59:59', admin);
      const { mission, req, user } = await setup('event_participation', { eventId: event });
      await insertCharge(event, user, 'paid', admin);
      expect((await one(mission, req, user)).count).toBe(0);
    });
  });

  describe('video_watched', () => {
    it('counts distinct ready videos of the target topic only', async () => {
      const { mission, req, user, topic } = await setup('video_watched', { params: { minCount: 2 } });
      const v1 = await insertMedia(topic, admin);
      const v2 = await insertMedia(topic, admin);
      const pdf = await insertMedia(topic, admin, { type: 'application/pdf' });
      const pending = await insertMedia(topic, admin, { status: 'pending' });
      const elsewhere = await insertMedia(await insertTopic(), admin);

      await insertEvidence(req, user, v1, '2026-05-02 10:00:00');
      await insertEvidence(req, user, pdf, '2026-05-02 11:00:00');
      await insertEvidence(req, user, pending, '2026-05-02 12:00:00');
      await insertEvidence(req, user, elsewhere, '2026-05-02 13:00:00');
      expect(await one(mission, req, user)).toEqual({ userId: user, count: 1, kthAt: null });

      await insertEvidence(req, user, v2, '2026-05-03T10:00:00.000Z');
      expect(await one(mission, req, user)).toEqual({ userId: user, count: 2, kthAt: '2026-05-03 10:00:00' });
    });

    it('evidence of another requirement does not count', async () => {
      const { mission, req, user, topic } = await setup('video_watched', { params: { minCount: 1 } });
      const other = await insertRequirement(mission, 2, 'video_watched', { topicId: topic, params: { minCount: 1 } });
      await insertEvidence(other, user, await insertMedia(topic, admin), '2026-05-02 10:00:00');
      expect((await one(mission, req, user)).count).toBe(0);
    });
  });

  describe('topic_visited', () => {
    it('counts a captured visit inside the window, at its instant', async () => {
      const { mission, req, user, topic } = await setup('topic_visited');
      await insertEvidence(req, user, topic, '2026-05-01T10:00:00.000Z');
      expect(await one(mission, req, user)).toEqual({ userId: user, count: 1, kthAt: '2026-05-01 10:00:00' });
    });

    it('ignores a captured visit before the step opened', async () => {
      const { mission, req, user, topic } = await setup('topic_visited');
      await insertEvidence(req, user, topic, '2026-05-01 09:59:59');
      expect((await one(mission, req, user)).count).toBe(0);
    });
  });

  describe('manual_check', () => {
    it('counts the step checked_at inside the window', async () => {
      const { mission, req, user } = await setup('manual_check');
      expect((await one(mission, req, user)).count).toBe(0);
      await env.DB
        .prepare(
          `INSERT INTO mission_requirement_progress (requirement_id, user_id, mission_id, target_count, checked_at)
           VALUES (?, ?, ?, 1, '2026-05-05T10:00:00.000Z')`,
        )
        .bind(req, user, mission)
        .run();
      expect(await one(mission, req, user)).toEqual({ userId: user, count: 1, kthAt: '2026-05-05 10:00:00' });
    });
  });

  describe('scope', () => {
    it('sequential: omits users whose previous step is incomplete and opens at its completed_at', async () => {
      const topic = await insertTopic();
      const mission = await insertMission({ startAt: START, endAt: END, mode: 'sequential' });
      const step1 = await insertRequirement(mission, 1, 'manual_check');
      const step2 = await insertRequirement(mission, 2, 'submissions_on_topic', { topicId: topic, params: { minCount: 1 } });
      const [done, partial, untouched] = [await insertUser(), await insertUser(), await insertUser()];
      for (const u of [done, partial, untouched]) await enroll(mission, u);

      await env.DB
        .prepare(
          `INSERT INTO mission_requirement_progress (requirement_id, user_id, mission_id, current_count, target_count, completed_at)
           VALUES (?, ?, ?, 1, 1, '2026-05-10 08:00:00'), (?, ?, ?, 0, 1, NULL)`,
        )
        .bind(step1, done, mission, step1, partial, mission)
        .run();
      for (const u of [done, partial, untouched]) {
        await insertSubmission(topic, u, '2026-05-10 07:59:59');
        await insertSubmission(topic, u, '2026-05-10T08:00:00.000Z');
      }

      const rows = await count(mission, step2, { previous: step1 });
      expect(rows).toEqual([{ userId: done, count: 1, kthAt: '2026-05-10 08:00:00' }]);
    });

    it('userId null returns one row per active enrollment and skips left ones', async () => {
      const { mission, req, user, topic } = await setup('submissions_on_topic', { params: { minCount: 2 } });
      const idle = await insertUser();
      const gone = await insertUser();
      await enroll(mission, idle);
      await enroll(mission, gone, { leftAt: '2026-05-05 00:00:00' });
      await insertSubmission(topic, user, '2026-05-02 10:00:00');
      await insertSubmission(topic, user, '2026-05-03 10:00:00');
      await insertSubmission(topic, gone, '2026-05-02 10:00:00');

      const rows = await count(mission, req, { userId: null });
      const byUser = new Map(rows.map(r => [r.userId, r]));
      expect(rows).toHaveLength(2);
      expect(byUser.get(user)).toEqual({ userId: user, count: 2, kthAt: '2026-05-03 10:00:00' });
      expect(byUser.get(idle)).toEqual({ userId: idle, count: 0, kthAt: null });
      expect(byUser.has(gone)).toBe(false);

      // A single user narrows the scope; a non-enrolled user yields nothing.
      expect(await count(mission, req, { userId: idle })).toEqual([{ userId: idle, count: 0, kthAt: null }]);
      expect(await count(mission, req, { userId: await insertUser() })).toEqual([]);
    });
  });
});
