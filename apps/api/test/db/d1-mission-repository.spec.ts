import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1MissionRepository } from '@api/adapters/db/d1-mission-repository';
import type { MissionCreateInput } from '@arenaquest/shared/ports/i-mission-repository';
import type { RequirementInput } from '@arenaquest/shared/domain/missions/requirements';
import { applyMigrations } from '../helpers/apply-migrations';
import { insertEvent, insertMission, insertRequirement, insertTopic, insertUser } from './mission-fixtures';

const NOW = '2026-05-20T12:00:00.000Z';

function missionInput(overrides: Partial<MissionCreateInput> = {}): MissionCreateInput {
  return {
    title: 'Kata month',
    description: '',
    startAt: '2026-05-01T10:00:00.000Z',
    endAt: '2026-05-31T23:59:59.000Z',
    predicateKind: 'ignored',
    predicateParams: '{"ignored":true}',
    xpReward: 100,
    badgeId: null,
    active: true,
    ...overrides,
  };
}

async function insertGroup(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO user_groups (id, name) VALUES (?, ?)').bind(id, `group-${id}`).run();
  return id;
}

describe('D1MissionRepository (requirements, audience, listings)', () => {
  let repo: D1MissionRepository;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    repo = new D1MissionRepository(env.DB);
  });

  describe('createWithRequirements', () => {
    it("stores the mission as 'requirements' / '{}' with positions and parsed params", async () => {
      const topic = await insertTopic();
      const admin = await insertUser();
      const event = await insertEvent('2026-05-10 19:00:00', admin);
      const inputs = [
        { kind: 'submissions_on_topic', title: 'Three demos', topicId: topic, params: { minCount: 3 } },
        { kind: 'event_participation', title: 'Seminar', eventId: event, xpReward: 20, params: {} },
        { kind: 'manual_check', title: 'Tick', params: {} },
      ] as RequirementInput[];

      const { mission, requirements } = await repo.createWithRequirements(
        missionInput({ mode: 'sequential' }),
        inputs,
      );

      expect(mission.predicateKind).toBe('requirements');
      expect(mission.predicateParams).toBe('{}');
      expect(mission.mode).toBe('sequential');
      expect(mission.enrollmentMode).toBe('auto');
      expect(requirements.map(r => [r.position, r.kind, r.topicId, r.eventId, r.xpReward])).toEqual([
        [1, 'submissions_on_topic', topic, null, 0],
        [2, 'event_participation', null, event, 20],
        [3, 'manual_check', null, null, 0],
      ]);
      expect(requirements[0].params).toEqual({
        minCount: 3,
        requireDescription: false,
        visibility: 'any',
        countModerated: false,
      });
      expect(requirements[2].params).toEqual({ instructions: '' });

      // The defaults are stored, not only applied on read.
      const raw = await env.DB
        .prepare('SELECT params FROM mission_requirements WHERE id = ?')
        .bind(requirements[0].id)
        .first<{ params: string }>();
      expect(JSON.parse(raw!.params)).toEqual(requirements[0].params);

      expect(await repo.listRequirements(mission.id)).toEqual(requirements);
    });

    it('writes nothing when one requirement violates the table check', async () => {
      const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM missions').first<{ n: number }>();
      // A topic kind without a target fails the pairing check — the whole batch rolls back.
      const bad = [{ kind: 'topic_visited', title: 'Visit', params: {} }] as unknown as RequirementInput[];
      await expect(repo.createWithRequirements(missionInput(), bad)).rejects.toThrow();
      const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM missions').first<{ n: number }>();
      expect(after!.n).toBe(before!.n);
    });
  });

  it('replaceRequirements swaps the list atomically with fresh ids and positions', async () => {
    const topic = await insertTopic();
    const { mission, requirements: first } = await repo.createWithRequirements(missionInput(), [
      { kind: 'manual_check', title: 'A', xpReward: 0, params: { instructions: '' } },
      { kind: 'manual_check', title: 'B', xpReward: 0, params: { instructions: '' } },
    ]);

    const replaced = await repo.replaceRequirements(mission.id, [
      { kind: 'video_watched', title: 'Watch two', topicId: topic, xpReward: 5, params: { minCount: 2 } },
    ]);

    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ position: 1, kind: 'video_watched', topicId: topic, params: { minCount: 2 } });
    expect(first.map(r => r.id)).not.toContain(replaced[0].id);
    expect(await repo.listRequirements(mission.id)).toEqual(replaced);
  });

  it('listRequirements is empty for a legacy mission', async () => {
    const legacy = await insertMission({ predicateKind: 'complete_topics' });
    expect(await repo.listRequirements(legacy)).toEqual([]);
  });

  describe('findCandidateRequirements', () => {
    it('matches kind and target on active, in-window requirement missions only', async () => {
      const topic = await insertTopic();
      const otherTopic = await insertTopic();
      const live = await insertMission();
      const inactive = await insertMission({ active: false });
      const future = await insertMission({ startAt: '2026-06-01T00:00:00.000Z', endAt: '2026-06-30T00:00:00.000Z' });
      const ended = await insertMission({ startAt: '2026-04-01T00:00:00.000Z', endAt: '2026-05-20T11:59:59.000Z' });
      const legacy = await insertMission({ predicateKind: 'complete_topics' });

      const hit = await insertRequirement(live, 1, 'topic_visited', { topicId: topic });
      await insertRequirement(live, 2, 'video_watched', { topicId: topic, params: { minCount: 1 } });
      await insertRequirement(live, 3, 'topic_visited', { topicId: otherTopic });
      for (const m of [inactive, future, ended, legacy]) {
        await insertRequirement(m, 1, 'topic_visited', { topicId: topic });
      }

      const found = await repo.findCandidateRequirements({ kind: 'topic_visited', topicId: topic }, NOW);
      expect(found.map(c => c.requirement.id)).toEqual([hit]);
      expect(found[0].mission.id).toBe(live);
      expect(found[0].mission.title).toBe('Mission');
      expect(found[0].requirement).toMatchObject({ missionId: live, position: 1, topicId: topic, eventId: null });
    });

    it('includes the window edges, compared as instants', async () => {
      const topic = await insertTopic();
      const m = await insertMission({ startAt: '2026-05-20T12:00:00.000Z', endAt: '2026-05-20T12:00:00.000Z' });
      const req = await insertRequirement(m, 1, 'topic_visited', { topicId: topic });
      // The SQLite form of the same instant matches as well.
      for (const now of [NOW, '2026-05-20 12:00:00']) {
        const found = await repo.findCandidateRequirements({ kind: 'topic_visited', topicId: topic }, now);
        expect(found.map(c => c.requirement.id)).toEqual([req]);
      }
      expect(await repo.findCandidateRequirements({ kind: 'topic_visited', topicId: topic }, '2026-05-20T12:00:01.000Z')).toEqual([]);
    });

    it('matches event targets through event_id', async () => {
      const admin = await insertUser();
      const event = await insertEvent('2026-05-10 19:00:00', admin);
      const otherEvent = await insertEvent('2026-05-11 19:00:00', admin);
      const m = await insertMission();
      const req = await insertRequirement(m, 1, 'event_participation', { eventId: event });
      await insertRequirement(m, 2, 'event_participation', { eventId: otherEvent });

      const found = await repo.findCandidateRequirements({ kind: 'event_participation', eventId: event }, NOW);
      expect(found.map(c => c.requirement.id)).toEqual([req]);
    });
  });

  it('replaceAudience is replace-all and getAudience reads it back', async () => {
    const m = await insertMission({ enrollmentMode: 'assigned' });
    expect(await repo.getAudience(m)).toEqual({ groupIds: [], userIds: [] });

    const [g1, g2, g3] = [await insertGroup(), await insertGroup(), await insertGroup()];
    const u1 = await insertUser();
    await repo.replaceAudience(m, { groupIds: [g1, g2, g1], userIds: [u1] });
    const first = await repo.getAudience(m);
    expect(first.groupIds.sort()).toEqual([g1, g2].sort());
    expect(first.userIds).toEqual([u1]);

    await repo.replaceAudience(m, { groupIds: [g3], userIds: [] });
    expect(await repo.getAudience(m)).toEqual({ groupIds: [g3], userIds: [] });
  });

  it('splits active missions into legacy and requirement listings', async () => {
    // A fresh window of its own so other tests' missions stay out of the assertion.
    const window = { startAt: '2027-01-01T00:00:00.000Z', endAt: '2027-01-31T00:00:00.000Z' };
    const now = '2027-01-15T00:00:00.000Z';
    const legacy = await insertMission({ ...window, predicateKind: 'complete_topics' });
    const modern = await insertMission(window);
    await insertMission({ ...window, active: false });

    expect((await repo.listActiveLegacyMissions(now)).map(m => m.id)).toEqual([legacy]);
    expect((await repo.listActiveRequirementMissions(now)).map(m => m.id)).toEqual([modern]);
  });

  describe('mission_progress aggregate', () => {
    it('markCompleted only completes once: the first completed_at is kept', async () => {
      const user = await insertUser();
      const m = await insertMission();
      await repo.upsertProgress(user, m, 1, 3);
      const first = await repo.markCompleted(user, m);
      expect(first.completed).toBe(true);

      await env.DB
        .prepare("UPDATE mission_progress SET completed_at = '2000-01-01 00:00:00' WHERE user_id = ? AND mission_id = ?")
        .bind(user, m)
        .run();
      const second = await repo.markCompleted(user, m);
      expect(second.completed).toBe(true);
      const raw = await env.DB
        .prepare('SELECT completed_at FROM mission_progress WHERE user_id = ? AND mission_id = ?')
        .bind(user, m)
        .first<{ completed_at: string }>();
      expect(raw?.completed_at).toBe('2000-01-01 00:00:00');
    });

    it('upsertProgress updates target_value on conflict', async () => {
      const user = await insertUser();
      const m = await insertMission();
      await repo.upsertProgress(user, m, 1, 3);
      const progress = await repo.upsertProgress(user, m, 1, 5);
      expect(progress).toMatchObject({ currentValue: 2, targetValue: 5, completed: false });
    });

    it('upsertProgress still auto-completes when the target is reached', async () => {
      const user = await insertUser();
      const m = await insertMission();
      await repo.upsertProgress(user, m, 1, 2);
      const progress = await repo.upsertProgress(user, m, 1, 2);
      expect(progress).toMatchObject({ currentValue: 2, targetValue: 2, completed: true });
    });
  });
});
