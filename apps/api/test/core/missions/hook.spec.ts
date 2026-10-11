import { describe, it, expect, vi, afterEach } from 'vitest';
import { MissionEvaluator, type EvaluationOutcome } from '@arenaquest/shared/domain/gamification/mission-evaluator';
import { runMissionHook, type MissionHookDeps } from '@api/core/missions/hook';

/**
 * Unit spec of the mission hook runner (RFC 0022 §3.2, §8; M27 Task 06): signal
 * resolution, the badge follow-up, and the best-effort contract — never throws,
 * logs ids only. The route-level behaviour lives in
 * `test/routes/mission-hooks.router.spec.ts`.
 */

const NOW = new Date('2026-05-15T12:00:00.000Z');
const empty = (): EvaluationOutcome => ({ stepsCompleted: [], missionsCompleted: [] });

function makeDeps(over: {
  onSignal?: ReturnType<typeof vi.fn>;
  badgeEvaluate?: ReturnType<typeof vi.fn>;
  findSubmission?: ReturnType<typeof vi.fn>;
  getCharge?: ReturnType<typeof vi.fn>;
  listUserEnrollments?: ReturnType<typeof vi.fn>;
  listRequirements?: ReturnType<typeof vi.fn>;
  noEvaluator?: boolean;
} = {}) {
  const onSignal = over.onSignal ?? vi.fn().mockResolvedValue(empty());
  const badgeEvaluate = over.badgeEvaluate ?? vi.fn().mockResolvedValue([]);
  const findSubmission = over.findSubmission ?? vi.fn().mockResolvedValue(null);
  const getCharge = over.getCharge ?? vi.fn().mockResolvedValue(null);
  const listUserEnrollments = over.listUserEnrollments ?? vi.fn().mockResolvedValue([]);
  const listRequirements = over.listRequirements ?? vi.fn().mockResolvedValue([]);
  const deps = {
    gamification: {
      missionEvaluator: over.noEvaluator ? undefined : { onSignal },
      badgeEngine: { evaluate: badgeEvaluate },
      missionRepo: { listRequirements },
      missionParticipationRepo: { listUserEnrollments },
    },
    engagement: { submissionRepo: { findById: findSubmission } },
    billing: { eventChargeRepo: { getCharge } },
  } as unknown as MissionHookDeps;
  return { deps, onSignal, badgeEvaluate, findSubmission, getCharge, listUserEnrollments, listRequirements };
}

afterEach(() => vi.restoreAllMocks());

describe('runMissionHook — pass-through signals', () => {
  it('hands an evaluator signal through unchanged, with the given clock', async () => {
    const { deps, onSignal, badgeEvaluate } = makeDeps();
    const signal = { kind: 'topic_visit' as const, userId: 'u1', topicId: 't1' };
    await runMissionHook(deps, signal, NOW);
    expect(onSignal).toHaveBeenCalledWith(signal, NOW);
    expect(badgeEvaluate).not.toHaveBeenCalled();
  });

  it('is a no-op without a mission evaluator', async () => {
    const { deps, findSubmission } = makeDeps({ noEvaluator: true });
    await expect(runMissionHook(deps, { kind: 'submission_by_id', submissionId: 's1' }, NOW)).resolves.toBeUndefined();
    expect(findSubmission).not.toHaveBeenCalled();
  });

  it('runs the badge engine for the user only when a mission completed', async () => {
    const onSignal = vi.fn().mockResolvedValue({
      stepsCompleted: [{ missionId: 'm1', requirementId: 'r1', completedAt: '2026-05-15 12:00:00' }],
      missionsCompleted: ['m1'],
    });
    const { deps, badgeEvaluate } = makeDeps({ onSignal });
    await runMissionHook(deps, { kind: 'submission', userId: 'u1', topicIds: ['t1'] }, NOW);
    expect(badgeEvaluate).toHaveBeenCalledTimes(1);
    expect(badgeEvaluate).toHaveBeenCalledWith('u1', NOW);
  });

  it('does not run the badge engine when only a step completed', async () => {
    const onSignal = vi.fn().mockResolvedValue({
      stepsCompleted: [{ missionId: 'm1', requirementId: 'r1', completedAt: '2026-05-15 12:00:00' }],
      missionsCompleted: [],
    });
    const { deps, badgeEvaluate } = makeDeps({ onSignal });
    await runMissionHook(deps, { kind: 'submission', userId: 'u1', topicIds: ['t1'] }, NOW);
    expect(badgeEvaluate).not.toHaveBeenCalled();
  });
});

describe('runMissionHook — resolved signals', () => {
  it('resolves a staff moderation to a submission signal for the author', async () => {
    const findSubmission = vi.fn().mockResolvedValue({ id: 's1', authorId: 'author', topicNodeId: 't9' });
    const { deps, onSignal } = makeDeps({ findSubmission });
    await runMissionHook(deps, { kind: 'submission_by_id', submissionId: 's1' }, NOW);
    expect(findSubmission).toHaveBeenCalledWith('s1');
    expect(onSignal).toHaveBeenCalledWith({ kind: 'submission', userId: 'author', topicIds: ['t9'] }, NOW);
  });

  it('skips a submission that no longer exists', async () => {
    const { deps, onSignal } = makeDeps();
    await runMissionHook(deps, { kind: 'submission_by_id', submissionId: 'gone' }, NOW);
    expect(onSignal).not.toHaveBeenCalled();
  });

  it("resolves a charge id to the charge's user and event", async () => {
    const getCharge = vi.fn().mockResolvedValue({ id: 'c1', userId: 'student', eventId: 'ev1' });
    const { deps, onSignal } = makeDeps({ getCharge });
    await runMissionHook(deps, { kind: 'event_charge_by_id', chargeId: 'c1' }, NOW);
    expect(onSignal).toHaveBeenCalledWith({ kind: 'event_charge', userId: 'student', eventId: 'ev1' }, NOW);
  });

  it('skips an unknown charge', async () => {
    const { deps, onSignal } = makeDeps();
    await runMissionHook(deps, { kind: 'event_charge_by_id', chargeId: 'nope' }, NOW);
    expect(onSignal).not.toHaveBeenCalled();
  });

  it("a move signals the target plus every submission topic of the user's active enrollments", async () => {
    const listUserEnrollments = vi.fn().mockResolvedValue([{ missionId: 'm1' }, { missionId: 'm2' }]);
    const listRequirements = vi.fn(async (missionId: string) =>
      missionId === 'm1'
        ? [
            { id: 'r1', kind: 'submissions_on_topic', topicId: 'source' },
            { id: 'r2', kind: 'topic_visited', topicId: 'visited-only' },
          ]
        : [
            { id: 'r3', kind: 'submissions_on_topic', topicId: 'target' },
            { id: 'r4', kind: 'event_participation', topicId: null },
          ],
    );
    const { deps, onSignal } = makeDeps({ listUserEnrollments, listRequirements });
    await runMissionHook(deps, { kind: 'submission_move', userId: 'u1', targetTopicId: 'target' }, NOW);
    expect(listUserEnrollments).toHaveBeenCalledWith('u1', { activeOnly: true });
    const sent = onSignal.mock.calls[0][0];
    expect(sent.kind).toBe('submission');
    expect(sent.userId).toBe('u1');
    expect([...sent.topicIds].sort()).toEqual(['source', 'target']);
  });

  it('a move by a user with no enrollment signals the target only', async () => {
    const { deps, onSignal, listRequirements } = makeDeps();
    await runMissionHook(deps, { kind: 'submission_move', userId: 'u1', targetTopicId: 'target' }, NOW);
    expect(listRequirements).not.toHaveBeenCalled();
    expect(onSignal).toHaveBeenCalledWith({ kind: 'submission', userId: 'u1', topicIds: ['target'] }, NOW);
  });
});

describe('runMissionHook — best-effort', () => {
  it('swallows a throwing evaluator and logs ids only', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSignal = vi.fn().mockRejectedValue(new Error('D1_ERROR: boom'));
    const { deps } = makeDeps({ onSignal });
    await expect(
      runMissionHook(deps, { kind: 'video_watch', userId: 'u1', topicId: 't1', mediaId: 'md1' }, NOW),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    const [tag, payload] = error.mock.calls[0];
    expect(tag).toBe('[mission] hook failed');
    expect(payload).toEqual({
      signal: 'video_watch',
      userId: 'u1',
      topicId: 't1',
      mediaId: 'md1',
      error: 'D1_ERROR: boom',
    });
  });

  it('swallows a throwing badge engine', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSignal = vi.fn().mockResolvedValue({ stepsCompleted: [], missionsCompleted: ['m1'] });
    const badgeEvaluate = vi.fn().mockRejectedValue(new Error('badge down'));
    const { deps } = makeDeps({ onSignal, badgeEvaluate });
    await expect(runMissionHook(deps, { kind: 'submission', userId: 'u1', topicIds: ['t1'] }, NOW)).resolves.toBeUndefined();
  });

  it('swallows a throwing resolver and never logs submission content', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const findSubmission = vi.fn().mockRejectedValue(new Error('read failed'));
    const { deps, onSignal } = makeDeps({ findSubmission });
    await runMissionHook(deps, { kind: 'submission_by_id', submissionId: 's1' }, NOW);
    expect(onSignal).not.toHaveBeenCalled();
    expect(error.mock.calls[0][1]).toEqual({ signal: 'submission_by_id', submissionId: 's1', error: 'read failed' });
  });
});

describe('runMissionHook — cheap when idle', () => {
  it('with no matching requirement the evaluator runs exactly one lookup and nothing else', async () => {
    const calls: string[] = [];
    const tracked = <T extends object>(name: string, impl: Partial<Record<string, unknown>> = {}) =>
      new Proxy(impl as T, {
        get(target, prop) {
          if (typeof prop !== 'string' || prop === 'then') return undefined;
          return async (...args: unknown[]) => {
            calls.push(`${name}.${prop}`);
            const fn = (target as Record<string, unknown>)[prop];
            return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown)(...args) : undefined;
          };
        },
      });
    const missions = tracked('missions', { findCandidateRequirements: () => [] });
    const evaluator = new MissionEvaluator(
      missions as never,
      tracked('participation') as never,
      tracked('evidence') as never,
      tracked('badges') as never,
      tracked('xp') as never,
      tracked('streak') as never,
      tracked('context') as never,
      { sharingEnabled: true },
    );
    const deps = {
      gamification: {
        missionEvaluator: evaluator,
        badgeEngine: tracked('badgeEngine'),
        missionRepo: missions,
        missionParticipationRepo: tracked('participation'),
      },
    } as unknown as MissionHookDeps;

    await runMissionHook(deps, { kind: 'submission', userId: 'u1', topicIds: ['t1'] }, NOW);
    expect(calls).toEqual(['missions.findCandidateRequirements']);
  });
});
