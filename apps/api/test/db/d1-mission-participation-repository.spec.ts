import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1MissionParticipationRepository } from '@api/adapters/db/d1-mission-participation-repository';
import { applyMigrations } from '../helpers/apply-migrations';
import { insertMission, insertRequirement, insertUser } from './mission-fixtures';

describe('D1MissionParticipationRepository', () => {
  let repo: D1MissionParticipationRepository;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    repo = new D1MissionParticipationRepository(env.DB);
  });

  async function progressRow(requirementId: string, userId: string) {
    return env.DB
      .prepare('SELECT * FROM mission_requirement_progress WHERE requirement_id = ? AND user_id = ?')
      .bind(requirementId, userId)
      .first<Record<string, unknown>>();
  }

  describe('enrollment', () => {
    it('ensureEnrollment inserts once and ignores a duplicate, active or left', async () => {
      const m = await insertMission();
      const u = await insertUser();
      expect(await repo.ensureEnrollment(m, u, 'auto', '2026-05-01T10:00:00.000Z')).toBe(true);
      expect(await repo.ensureEnrollment(m, u, 'admin', '2026-05-02T10:00:00.000Z')).toBe(false);

      const e = await repo.findEnrollment(m, u);
      expect(e).toMatchObject({ missionId: m, userId: u, source: 'auto', countsFrom: '2026-05-01T10:00:00.000Z', leftAt: null });
      expect(typeof e?.joinedAt).toBe('string');

      await repo.leave(m, u, '2026-05-05T10:00:00.000Z');
      expect(await repo.ensureEnrollment(m, u, 'auto', '2026-05-01T10:00:00.000Z')).toBe(false);
      expect((await repo.findEnrollment(m, u))?.leftAt).toBe('2026-05-05T10:00:00.000Z');
    });

    it('join creates a self enrollment; a re-join clears left_at and keeps counts_from', async () => {
      const m = await insertMission({ enrollmentMode: 'open' });
      const u = await insertUser();
      const joined = await repo.join(m, u, '2026-05-03T08:00:00.000Z');
      expect(joined).toMatchObject({
        source: 'self',
        joinedAt: '2026-05-03T08:00:00.000Z',
        countsFrom: '2026-05-03T08:00:00.000Z',
        leftAt: null,
      });

      expect(await repo.leave(m, u, '2026-05-04T08:00:00.000Z')).toBe(true);
      expect(await repo.leave(m, u, '2026-05-04T09:00:00.000Z')).toBe(false);

      const rejoined = await repo.join(m, u, '2026-05-06T08:00:00.000Z');
      expect(rejoined).toMatchObject({ countsFrom: '2026-05-03T08:00:00.000Z', joinedAt: '2026-05-03T08:00:00.000Z', leftAt: null });
    });

    it('leave reports false for a missing enrollment', async () => {
      expect(await repo.leave(await insertMission(), await insertUser(), '2026-05-04T08:00:00.000Z')).toBe(false);
    });

    it('lists enrollments per mission and per user, with activeOnly skipping left rows', async () => {
      const m = await insertMission();
      const other = await insertMission();
      const [a, b] = [await insertUser(), await insertUser()];
      await repo.ensureEnrollment(m, a, 'auto', '2026-05-01T10:00:00.000Z');
      await repo.ensureEnrollment(m, b, 'auto', '2026-05-01T10:00:00.000Z');
      await repo.ensureEnrollment(other, a, 'admin', '2026-05-01T10:00:00.000Z');
      await repo.leave(m, b, '2026-05-02T00:00:00.000Z');

      expect((await repo.listEnrollments(m)).map(e => e.userId).sort()).toEqual([a, b].sort());
      expect((await repo.listEnrollments(m, { activeOnly: true })).map(e => e.userId)).toEqual([a]);
      expect((await repo.listUserEnrollments(a)).map(e => e.missionId).sort()).toEqual([m, other].sort());
      expect((await repo.listUserEnrollments(b, { activeOnly: true }))).toEqual([]);
      expect((await repo.listUserEnrollments(b)).map(e => e.missionId)).toEqual([m]);
    });
  });

  describe('step progress', () => {
    it('completeStep returns true once, then false and leaves the row unchanged', async () => {
      const m = await insertMission();
      const r = await insertRequirement(m, 1, 'manual_check');
      const u = await insertUser();
      const args = {
        requirementId: r,
        userId: u,
        missionId: m,
        targetCount: 3,
        completedAt: '2026-05-04 10:00:00',
        completedBy: 'hook' as const,
      };
      expect(await repo.completeStep(args)).toBe(true);
      const first = await progressRow(r, u);
      expect(first).toMatchObject({ current_count: 3, target_count: 3, completed_at: '2026-05-04 10:00:00', completed_by: 'hook' });
      expect(first?.recorded_at).not.toBeNull();

      expect(await repo.completeStep({ ...args, completedAt: '2026-05-09 10:00:00', completedBy: 'reconcile' })).toBe(false);
      expect(await progressRow(r, u)).toEqual(first);
    });

    it('completeStep completes an existing partial row', async () => {
      const m = await insertMission();
      const r = await insertRequirement(m, 1, 'manual_check');
      const u = await insertUser();
      await repo.setPartialCount({ requirementId: r, userId: u, missionId: m, currentCount: 1, targetCount: 2 });
      expect(
        await repo.completeStep({ requirementId: r, userId: u, missionId: m, targetCount: 2, completedAt: '2026-05-04 10:00:00', completedBy: 'reconcile' }),
      ).toBe(true);
      expect(await progressRow(r, u)).toMatchObject({ current_count: 2, completed_by: 'reconcile' });
    });

    it('setPartialCount upserts, may go down, and never touches a completed row', async () => {
      const m = await insertMission();
      const r = await insertRequirement(m, 1, 'manual_check');
      const u = await insertUser();
      const base = { requirementId: r, userId: u, missionId: m, targetCount: 3 };

      await repo.setPartialCount({ ...base, currentCount: 2 });
      expect(await progressRow(r, u)).toMatchObject({ current_count: 2, target_count: 3, completed_at: null });
      await repo.setPartialCount({ ...base, currentCount: 1 });
      expect(await progressRow(r, u)).toMatchObject({ current_count: 1 });

      await repo.completeStep({ ...base, completedAt: '2026-05-04 10:00:00', completedBy: 'hook' });
      const completed = await progressRow(r, u);
      await repo.setPartialCount({ ...base, currentCount: 0, targetCount: 5 });
      expect(await progressRow(r, u)).toEqual(completed);
    });

    it('markChecked sets checked_at once, creating the row', async () => {
      const m = await insertMission();
      const r = await insertRequirement(m, 1, 'manual_check');
      const u = await insertUser();
      const args = { requirementId: r, userId: u, missionId: m, targetCount: 1, checkedAt: '2026-05-04T10:00:00.000Z' };
      expect(await repo.markChecked(args)).toBe(true);
      expect(await repo.markChecked({ ...args, checkedAt: '2026-05-05T10:00:00.000Z' })).toBe(false);
      expect(await progressRow(r, u)).toMatchObject({ checked_at: '2026-05-04T10:00:00.000Z', current_count: 0, target_count: 1 });

      const [progress] = await repo.listStepProgress(m, u);
      expect(progress).toMatchObject({
        requirementId: r,
        userId: u,
        missionId: m,
        checkedAt: '2026-05-04T10:00:00.000Z',
        completedAt: null,
        completedBy: null,
        recordedAt: null,
      });
    });

    it('markChecked on a row that already has progress only sets checked_at', async () => {
      const m = await insertMission();
      const r = await insertRequirement(m, 1, 'manual_check');
      const u = await insertUser();
      await repo.setPartialCount({ requirementId: r, userId: u, missionId: m, currentCount: 0, targetCount: 1 });
      expect(await repo.markChecked({ requirementId: r, userId: u, missionId: m, targetCount: 1, checkedAt: '2026-05-04 10:00:00' })).toBe(true);
      expect(await progressRow(r, u)).toMatchObject({ checked_at: '2026-05-04 10:00:00' });
    });

    it('listStepProgress returns only the mission and user asked for', async () => {
      const m = await insertMission();
      const other = await insertMission();
      const r1 = await insertRequirement(m, 1, 'manual_check');
      const r2 = await insertRequirement(other, 1, 'manual_check');
      const [u, v] = [await insertUser(), await insertUser()];
      await repo.setPartialCount({ requirementId: r1, userId: u, missionId: m, currentCount: 0, targetCount: 1 });
      await repo.setPartialCount({ requirementId: r1, userId: v, missionId: m, currentCount: 0, targetCount: 1 });
      await repo.setPartialCount({ requirementId: r2, userId: u, missionId: other, currentCount: 0, targetCount: 1 });
      expect((await repo.listStepProgress(m, u)).map(p => p.requirementId)).toEqual([r1]);
    });
  });

  it('captureEvidence keeps the first row per (requirement, user, refId)', async () => {
    const m = await insertMission();
    const r = await insertRequirement(m, 1, 'manual_check');
    const u = await insertUser();
    const args = { requirementId: r, userId: u, refId: 'media-1', occurredAt: '2026-05-04 10:00:00', source: 'hook' as const };
    expect(await repo.captureEvidence(args)).toBe(true);
    expect(await repo.captureEvidence({ ...args, occurredAt: '2026-05-06 10:00:00', source: 'backfill' })).toBe(false);
    expect(await repo.captureEvidence({ ...args, refId: 'media-2' })).toBe(true);

    const { results } = await env.DB
      .prepare('SELECT ref_id, occurred_at, source FROM mission_evidence WHERE requirement_id = ? AND user_id = ? ORDER BY ref_id')
      .bind(r, u)
      .all();
    expect(results).toEqual([
      { ref_id: 'media-1', occurred_at: '2026-05-04 10:00:00', source: 'hook' },
      { ref_id: 'media-2', occurred_at: '2026-05-04 10:00:00', source: 'hook' },
    ]);
  });
});
