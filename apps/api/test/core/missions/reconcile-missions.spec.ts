import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IMissionParticipationRepository, IMissionRepository } from '@arenaquest/shared/ports';
import type { Mission, MissionRequirement } from '@arenaquest/shared/domain/mission';
import type { MissionEvaluator } from '@arenaquest/shared/domain/gamification/mission-evaluator';
import {
  isInReconcileScope,
  reconcileMissions,
  reconcileOneMission,
  type ReconcileMissionsDeps,
} from '@api/jobs/reconcile-missions';

/**
 * The reconciliation job's orchestration (RFC 0022 §4; M27 Task 08) with fakes:
 * scope, the order of the three steps, per-mission failure isolation and the
 * counts-only log line. The SQL is covered by `test/db/reconcile-missions.spec.ts`.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm-1',
    title: 'Kihon month',
    description: '',
    startAt: at(-10 * 24 * HOUR),
    endAt: at(10 * 24 * HOUR),
    predicateKind: 'requirements',
    predicateParams: '{}',
    xpReward: 0,
    badgeId: null,
    active: true,
    mode: 'parallel',
    enrollmentMode: 'auto',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function requirement(overrides: Partial<MissionRequirement> = {}): MissionRequirement {
  return {
    id: 'r-1',
    missionId: 'm-1',
    position: 1,
    kind: 'submissions_on_topic',
    title: 'Step',
    topicId: 't-1',
    eventId: null,
    params: { minCount: 1 },
    xpReward: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeDeps(missions: Mission[], requirements: Record<string, MissionRequirement[]>) {
  const missionRepo = {
    listAll: vi.fn(async () => missions),
    findById: vi.fn(async (id: string) => missions.find((m) => m.id === id) ?? null),
    listRequirements: vi.fn(async (id: string) => requirements[id] ?? []),
  } as unknown as IMissionRepository;
  const participation = {
    materializeImplicitEnrollments: vi.fn(async () => 2),
    backfillEvidence: vi.fn(async () => 1),
  } as unknown as IMissionParticipationRepository;
  const evaluator = {
    reconcileMission: vi.fn(async (missionId: string) => ({
      missionId,
      enrollmentsEvaluated: 3,
      implicitEnrollmentsCreated: 0,
      stepsCompleted: 1,
      missionsCompleted: 1,
    })),
  } as unknown as MissionEvaluator;
  const deps: ReconcileMissionsDeps = { missions: missionRepo, participation, evaluator, now: () => NOW };
  return { deps, missionRepo, participation, evaluator };
}

function quiet() {
  return {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('isInReconcileScope', () => {
  it('keeps active, started requirements missions ended at most 48 h ago (ISO and SQLite instants)', () => {
    expect(isInReconcileScope(mission(), NOW)).toBe(true);
    expect(isInReconcileScope(mission({ endAt: at(-47 * HOUR) }), NOW)).toBe(true);
    expect(isInReconcileScope(mission({ endAt: at(-48 * HOUR) }), NOW)).toBe(true);
    expect(isInReconcileScope(mission({ endAt: '2026-06-13 13:00:00' }), NOW)).toBe(true); // 47 h, SQLite form
    expect(isInReconcileScope(mission({ endAt: at(-49 * HOUR) }), NOW)).toBe(false);
    expect(isInReconcileScope(mission({ endAt: '2026-06-13 11:00:00' }), NOW)).toBe(false); // 49 h, SQLite form
  });

  it('drops inactive, legacy and not-yet-started missions', () => {
    expect(isInReconcileScope(mission({ active: false }), NOW)).toBe(false);
    expect(isInReconcileScope(mission({ predicateKind: 'watch_video' }), NOW)).toBe(false);
    expect(isInReconcileScope(mission({ startAt: at(HOUR) }), NOW)).toBe(false);
  });
});

describe('reconcileMissions', () => {
  it('materialises, backfills the two captured kinds, then evaluates — once per mission in scope', async () => {
    const { log } = quiet();
    const live = mission({ id: 'm-1' });
    const ended = mission({ id: 'm-old', endAt: at(-72 * HOUR) });
    const reqs = [
      requirement({ id: 'r-sub', kind: 'submissions_on_topic', topicId: 't-1' }),
      requirement({ id: 'r-vid', position: 2, kind: 'video_watched', topicId: 't-2' }),
      requirement({ id: 'r-vis', position: 3, kind: 'topic_visited', topicId: 't-1' }),
      requirement({ id: 'r-chk', position: 4, kind: 'manual_check', topicId: null }),
    ];
    const { deps, participation, evaluator } = makeDeps([live, ended], { 'm-1': reqs, 'm-old': reqs });

    const report = await reconcileMissions(deps);

    expect(participation.materializeImplicitEnrollments).toHaveBeenCalledOnce();
    expect(participation.materializeImplicitEnrollments).toHaveBeenCalledWith(live, ['t-1', 't-2']);
    expect(vi.mocked(participation.backfillEvidence).mock.calls.map(([, r]) => r.id)).toEqual(['r-vid', 'r-vis']);
    expect(evaluator.reconcileMission).toHaveBeenCalledOnce();
    expect(evaluator.reconcileMission).toHaveBeenCalledWith('m-1', NOW);
    expect(report).toEqual({
      missions: 1,
      enrollmentsCreated: 2,
      evidenceBackfilled: 2,
      enrollmentsEvaluated: 3,
      stepsClosed: 1,
      missionsClosed: 1,
      failed: 0,
    });

    const line = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(Object.keys(line).sort()).toEqual(
      ['at', 'enrollmentsCreated', 'enrollmentsEvaluated', 'event', 'evidenceBackfilled', 'failed', 'missions', 'missionsClosed', 'stepsClosed', 'trigger'].sort(),
    );
    expect(line).toMatchObject({ event: 'missions.reconcile', trigger: 'scheduled' });
  });

  it('a failing mission is counted and the next one still runs; the run never throws', async () => {
    const { error } = quiet();
    const { deps, participation, evaluator } = makeDeps(
      [mission({ id: 'm-bad' }), mission({ id: 'm-good' })],
      { 'm-bad': [requirement()], 'm-good': [requirement()] },
    );
    vi.mocked(participation.materializeImplicitEnrollments).mockImplementationOnce(async () => {
      throw new Error('D1 is down');
    });

    const report = await reconcileMissions(deps);

    expect(report).toMatchObject({ missions: 2, failed: 1, missionsClosed: 1 });
    expect(evaluator.reconcileMission).toHaveBeenCalledWith('m-good', NOW);
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: 'missions.reconcile', failed: 1 });
  });

  it('a failing mission listing resolves with failed = 1', async () => {
    quiet();
    const { deps, missionRepo } = makeDeps([], {});
    vi.mocked(missionRepo.listAll).mockRejectedValueOnce(new Error('D1 is down'));
    await expect(reconcileMissions(deps)).resolves.toMatchObject({ missions: 0, failed: 1 });
  });

  it('a mission without requirements is skipped, and without an evaluator only steps 2-3 run', async () => {
    quiet();
    const { deps, participation } = makeDeps(
      [mission({ id: 'm-empty' }), mission({ id: 'm-1', enrollmentMode: 'assigned' })],
      { 'm-1': [requirement({ kind: 'video_watched' })] },
    );
    const report = await reconcileMissions({ ...deps, evaluator: undefined });

    expect(participation.materializeImplicitEnrollments).toHaveBeenCalledOnce();
    expect(report).toEqual({
      missions: 2,
      enrollmentsCreated: 2,
      evidenceBackfilled: 1,
      enrollmentsEvaluated: 0,
      stepsClosed: 0,
      missionsClosed: 0,
      failed: 0,
    });
  });
});

describe('reconcileOneMission', () => {
  it('null for an unknown or legacy mission', async () => {
    quiet();
    const { deps } = makeDeps([mission({ id: 'm-legacy', predicateKind: 'watch_video' })], {});
    expect(await reconcileOneMission(deps, 'missing', NOW)).toBeNull();
    expect(await reconcileOneMission(deps, 'm-legacy', NOW)).toBeNull();
  });

  it('runs the same routine outside the daily window, without materialising before the start', async () => {
    const { log } = quiet();
    const old = mission({ id: 'm-old', endAt: at(-30 * 24 * HOUR), startAt: at(-60 * 24 * HOUR) });
    const future = mission({ id: 'm-future', startAt: at(HOUR) });
    const { deps, participation, evaluator } = makeDeps([old, future], {
      'm-old': [requirement()],
      'm-future': [requirement()],
    });

    expect(await reconcileOneMission(deps, 'm-old', NOW)).toMatchObject({ missions: 1, stepsClosed: 1, failed: 0 });
    expect(evaluator.reconcileMission).toHaveBeenCalledWith('m-old', NOW);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ event: 'missions.reconcile', trigger: 'admin' });

    vi.mocked(participation.materializeImplicitEnrollments).mockClear();
    await reconcileOneMission(deps, 'm-future', NOW);
    expect(participation.materializeImplicitEnrollments).not.toHaveBeenCalled();
  });
});
