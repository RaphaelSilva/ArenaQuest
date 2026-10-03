import { describe, it, expect, vi } from 'vitest';
import {
  MissionEvaluator,
  instantMs,
  isMissionStaff,
  type MissionContextResolver,
  type MissionUserContext,
} from '@arenaquest/shared/domain/gamification/mission-evaluator';
import { targetCountOf } from '@arenaquest/shared/domain/missions/requirements';
import type {
  IMissionRepository,
  IMissionParticipationRepository,
  IMissionEvidenceRepository,
  IBadgeRepository,
  BadgeRecord,
  MissionAudience,
  MissionCandidate,
  EvidenceCount,
} from '@arenaquest/shared/ports';
import type { XpEngine, XpAwardParams } from '@arenaquest/shared/domain/gamification/xp-engine';
import type { StreakEngine } from '@arenaquest/shared/domain/gamification/streak-engine';
import type {
  Mission,
  MissionEnrollment,
  MissionProgress,
  MissionRequirement,
  MissionRequirementProgress,
} from '@arenaquest/shared/domain/mission';

// ---------------------------------------------------------------------------
// Clock helpers — every instant is explicit, the evaluator never reads Date.now()
// ---------------------------------------------------------------------------

/** 2026-01-<day>T<hour>:00:00.000Z */
const T = (day: number, hour = 12): string =>
  `2026-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const at = (iso: string): Date => new Date(iso);

const START = '2026-01-01T00:00:00.000Z';
const END = '2026-01-31T00:00:00.000Z';

const TOPIC_A = 'topic-a';
const TOPIC_B = 'topic-b';
const STUDENT = 'student-1';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1',
    title: 'Mission',
    description: '',
    startAt: START,
    endAt: END,
    predicateKind: 'requirements',
    predicateParams: '{}',
    xpReward: 100,
    badgeId: null,
    active: true,
    mode: 'parallel',
    enrollmentMode: 'auto',
    createdAt: new Date(START),
    updatedAt: new Date(START),
    ...overrides,
  };
}

let reqSeq = 0;
function makeReq(missionId: string, position: number, overrides: Partial<MissionRequirement> = {}): MissionRequirement {
  reqSeq++;
  return {
    id: `req-${reqSeq}`,
    missionId,
    position,
    kind: 'submissions_on_topic',
    title: `Step ${position}`,
    topicId: TOPIC_A,
    eventId: null,
    params: { minCount: 1, requireDescription: false, visibility: 'any', countModerated: false },
    xpReward: 10,
    createdAt: START,
    updatedAt: START,
    ...overrides,
  };
}

const submissions = (missionId: string, position: number, topicId: string, minCount: number, xpReward = 10) =>
  makeReq(missionId, position, {
    kind: 'submissions_on_topic',
    topicId,
    params: { minCount, requireDescription: false, visibility: 'any', countModerated: false },
    xpReward,
  });
const visit = (missionId: string, position: number, topicId: string, xpReward = 10) =>
  makeReq(missionId, position, { kind: 'topic_visited', topicId, params: {}, xpReward });
const watch = (missionId: string, position: number, topicId: string, minCount: number) =>
  makeReq(missionId, position, { kind: 'video_watched', topicId, params: { minCount } });
const manual = (missionId: string, position: number, xpReward = 10) =>
  makeReq(missionId, position, { kind: 'manual_check', topicId: null, params: { instructions: '' }, xpReward });
const eventStep = (missionId: string, position: number, eventId: string) =>
  makeReq(missionId, position, { kind: 'event_participation', topicId: null, eventId, params: {} });

function makeBadge(overrides: Partial<BadgeRecord> = {}): BadgeRecord {
  return {
    id: 'badge-1',
    slug: 'mission-badge',
    name: 'Mission badge',
    iconEmoji: '*',
    description: '',
    xpReward: 25,
    ruleKind: 'manual',
    ruleParams: '{}',
    active: true,
    createdAt: START,
    updatedAt: START,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// In-memory world: fakes of the three mission ports, badges, XP, streak, resolver
// ---------------------------------------------------------------------------

interface SourceItem {
  requirementId: string;
  userId: string;
  at: string;
}

class World {
  missionsById = new Map<string, Mission>();
  requirementsByMission = new Map<string, MissionRequirement[]>();
  audience = new Map<string, MissionAudience>();
  missionProgress = new Map<string, MissionProgress>();
  enrollments = new Map<string, MissionEnrollment>();
  stepProgress = new Map<string, MissionRequirementProgress>();
  captured: Array<SourceItem & { refId: string; source: string }> = [];
  /** Qualifying items read "directly" from source tables (submissions, charges). */
  sourceItems: SourceItem[] = [];
  badgesById = new Map<string, BadgeRecord>();

  users = new Map<string, MissionUserContext>();
  readyVideos = new Set<string>(); // `${topicId}:${mediaId}`

  xpCalls: XpAwardParams[] = [];
  badgeAwards: Array<{ userId: string; badgeId: string }> = [];
  streakCalls: Array<{ userId: string; now: Date }> = [];
  countCalls: Array<Parameters<IMissionEvidenceRepository['countForRequirement']>[0]> = [];

  missionRepo: IMissionRepository;
  participation: IMissionParticipationRepository;
  evidence: IMissionEvidenceRepository;
  badges: IBadgeRepository;
  xp: XpEngine;
  streak: StreakEngine;
  resolver: MissionContextResolver;

  constructor() {
    const key = (a: string, b: string) => `${a}|${b}`;
    const notUsed = () => {
      throw new Error('not used by the evaluator');
    };

    this.missionRepo = {
      findById: vi.fn(async (id: string) => this.missionsById.get(id) ?? null),
      create: vi.fn(notUsed),
      update: vi.fn(notUsed),
      listAll: vi.fn(notUsed),
      listActiveMissions: vi.fn(notUsed),
      findProgress: vi.fn(async (userId: string, missionId: string) => this.missionProgress.get(key(userId, missionId)) ?? null),
      upsertProgress: vi.fn(async (userId: string, missionId: string, increment: number, target: number) => {
        // Mirrors D1MissionRepository: clamp to target, auto-complete at target.
        const existing = this.missionProgress.get(key(userId, missionId));
        const row: MissionProgress = existing
          ? { ...existing, currentValue: Math.min(existing.targetValue, existing.currentValue + increment) }
          : {
              userId,
              missionId,
              currentValue: Math.min(increment, target),
              targetValue: target,
              completed: false,
              completedAt: null,
              updatedAt: new Date(),
            };
        if (!row.completed && row.currentValue >= row.targetValue) {
          row.completed = true;
          row.completedAt = new Date();
        }
        this.missionProgress.set(key(userId, missionId), row);
        return row;
      }),
      markCompleted: vi.fn(async (userId: string, missionId: string) => {
        const row = this.missionProgress.get(key(userId, missionId))!;
        row.completed = true;
        row.completedAt = new Date();
        return row;
      }),
      countCompletedMissions: vi.fn(notUsed),
      createWithRequirements: vi.fn(notUsed),
      listRequirements: vi.fn(async (missionId: string) => [...(this.requirementsByMission.get(missionId) ?? [])]),
      replaceRequirements: vi.fn(notUsed),
      findCandidateRequirements: vi.fn(async (target, nowIso: string) => {
        const out: MissionCandidate[] = [];
        for (const mission of this.missionsById.values()) {
          if (!mission.active) continue;
          const now = instantMs(nowIso);
          if (instantMs(mission.startAt) > now || instantMs(mission.endAt) < now) continue;
          for (const requirement of this.requirementsByMission.get(mission.id) ?? []) {
            if (requirement.kind !== target.kind) continue;
            if (target.topicId !== undefined && requirement.topicId !== target.topicId) continue;
            if (target.eventId !== undefined && requirement.eventId !== target.eventId) continue;
            out.push({ requirement, mission });
          }
        }
        return out;
      }),
      getAudience: vi.fn(async (missionId: string) => this.audience.get(missionId) ?? { groupIds: [], userIds: [] }),
      replaceAudience: vi.fn(notUsed),
      listActiveLegacyMissions: vi.fn(notUsed),
      listActiveRequirementMissions: vi.fn(notUsed),
    };

    const progressRow = (requirementId: string, userId: string, missionId: string, targetCount: number) => {
      const k = key(requirementId, userId);
      let row = this.stepProgress.get(k);
      if (!row) {
        row = {
          requirementId,
          userId,
          missionId,
          currentCount: 0,
          targetCount,
          checkedAt: null,
          completedAt: null,
          completedBy: null,
          recordedAt: null,
          updatedAt: START,
        };
        this.stepProgress.set(k, row);
      }
      return row;
    };

    this.participation = {
      ensureEnrollment: vi.fn(async (missionId: string, userId: string, source: 'auto' | 'admin', countsFrom: string) => {
        const k = key(missionId, userId);
        if (this.enrollments.has(k)) return false;
        this.enrollments.set(k, { missionId, userId, source, joinedAt: countsFrom, countsFrom, leftAt: null });
        return true;
      }),
      materializeImplicitEnrollments: vi.fn(notUsed),
      backfillEvidence: vi.fn(notUsed),
      join: vi.fn(notUsed),
      leave: vi.fn(notUsed),
      findEnrollment: vi.fn(async (missionId: string, userId: string) => this.enrollments.get(key(missionId, userId)) ?? null),
      listEnrollments: vi.fn(async (missionId: string, opts?: { activeOnly?: boolean }) =>
        [...this.enrollments.values()].filter((e) => e.missionId === missionId && (!opts?.activeOnly || e.leftAt === null)),
      ),
      listUserEnrollments: vi.fn(notUsed),
      listStepProgress: vi.fn(async (missionId: string, userId: string) =>
        [...this.stepProgress.values()]
          .filter((p) => p.missionId === missionId && p.userId === userId)
          .map((p) => ({ ...p })),
      ),
      completeStep: vi.fn(async (args) => {
        const row = progressRow(args.requirementId, args.userId, args.missionId, args.targetCount);
        if (row.completedAt) return false;
        row.completedAt = args.completedAt;
        row.completedBy = args.completedBy;
        row.currentCount = args.targetCount;
        return true;
      }),
      setPartialCount: vi.fn(async (args) => {
        const row = progressRow(args.requirementId, args.userId, args.missionId, args.targetCount);
        if (row.completedAt) return;
        row.currentCount = args.currentCount;
        row.targetCount = args.targetCount;
      }),
      markChecked: vi.fn(async (args) => {
        const row = progressRow(args.requirementId, args.userId, args.missionId, args.targetCount);
        if (row.checkedAt) return false;
        row.checkedAt = args.checkedAt;
        return true;
      }),
      captureEvidence: vi.fn(async (args) => {
        const exists = this.captured.some(
          (c) => c.requirementId === args.requirementId && c.userId === args.userId && c.refId === args.refId,
        );
        if (exists) return false;
        this.captured.push({
          requirementId: args.requirementId,
          userId: args.userId,
          refId: args.refId,
          at: args.occurredAt,
          source: args.source,
        });
        return true;
      }),
    };

    // Mirrors the §3.4 counting SQL: window floor, sequential unlock, end/now cap, k-th instant.
    this.evidence = {
      countForRequirement: vi.fn(async (args) => {
        this.countCalls.push(args);
        const { mission, requirement, previousRequirementId, userId, nowIso } = args;
        const rows: EvidenceCount[] = [];
        const capMs = Math.min(instantMs(mission.endAt), instantMs(nowIso));
        for (const e of this.enrollments.values()) {
          if (e.missionId !== mission.id || e.leftAt !== null) continue;
          if (userId !== null && e.userId !== userId) continue;
          let opensAt: string;
          if (previousRequirementId) {
            const prev = this.stepProgress.get(key(previousRequirementId, e.userId));
            if (!prev?.completedAt) continue; // omitted: step still locked
            opensAt = prev.completedAt;
          } else {
            opensAt = instantMs(e.countsFrom) > instantMs(mission.startAt) ? e.countsFrom : mission.startAt;
          }
          const items = [...this.sourceItems, ...this.captured]
            .filter((i) => i.requirementId === requirement.id && i.userId === e.userId)
            .map((i) => i.at)
            .filter((a) => instantMs(a) >= instantMs(opensAt) && instantMs(a) <= capMs)
            .sort((a, b) => instantMs(a) - instantMs(b));
          rows.push({ userId: e.userId, count: items.length, kthAt: items[targetCountOf(requirement) - 1] ?? null });
        }
        return rows;
      }),
    };

    this.badges = {
      listActive: vi.fn(notUsed),
      listAll: vi.fn(notUsed),
      findById: vi.fn(async (id: string) => this.badgesById.get(id) ?? null),
      findBySlug: vi.fn(notUsed),
      create: vi.fn(notUsed),
      update: vi.fn(notUsed),
      awardBadge: vi.fn(async (userId: string, badgeId: string) => {
        this.badgeAwards.push({ userId, badgeId });
        return { id: 'ub', userId, badgeId, earnedAt: START };
      }),
      listUserBadges: vi.fn(notUsed),
      revokeBadge: vi.fn(notUsed),
    };

    this.xp = {
      award: vi.fn(async (params: XpAwardParams) => {
        this.xpCalls.push(params);
        return null;
      }),
    } as unknown as XpEngine;

    this.streak = {
      recordActivity: vi.fn(async (userId: string, now: Date) => {
        this.streakCalls.push({ userId, now });
      }),
    } as unknown as StreakEngine;

    this.resolver = {
      getUserContext: vi.fn(async (userId: string) => this.users.get(userId) ?? null),
      isReadyVideoOfTopic: vi.fn(async (topicId: string, mediaId: string) => this.readyVideos.has(`${topicId}:${mediaId}`)),
    };
  }

  evaluator(sharingEnabled = true): MissionEvaluator {
    return new MissionEvaluator(
      this.missionRepo,
      this.participation,
      this.evidence,
      this.badges,
      this.xp,
      this.streak,
      this.resolver,
      { sharingEnabled },
    );
  }

  addMission(mission: Mission, requirements: MissionRequirement[]): Mission {
    this.missionsById.set(mission.id, mission);
    this.requirementsByMission.set(mission.id, requirements);
    return mission;
  }

  enroll(missionId: string, userId: string, overrides: Partial<MissionEnrollment> = {}): MissionEnrollment {
    const mission = this.missionsById.get(missionId)!;
    const e: MissionEnrollment = {
      missionId,
      userId,
      source: 'auto',
      joinedAt: mission.startAt,
      countsFrom: mission.startAt,
      leftAt: null,
      ...overrides,
    };
    this.enrollments.set(`${missionId}|${userId}`, e);
    return e;
  }

  addStudent(userId = STUDENT, ctx: Partial<MissionUserContext> = {}) {
    this.users.set(userId, { isStaff: false, groupIds: [], accessibleTopicIds: [TOPIC_A, TOPIC_B], ...ctx });
  }

  item(requirementId: string, atIso: string, userId = STUDENT) {
    this.sourceItems.push({ requirementId, userId, at: atIso });
  }

  step(requirementId: string, userId = STUDENT) {
    return this.stepProgress.get(`${requirementId}|${userId}`);
  }

  xpOf(action: string) {
    return this.xpCalls.filter((c) => c.action === action);
  }

  async evaluate(missionId: string, nowIso: string, origin: 'hook' | 'manual_check' | 'reconcile' = 'hook', userId = STUDENT) {
    const mission = this.missionsById.get(missionId)!;
    const reqs = this.requirementsByMission.get(missionId)!;
    const enrollment = this.enrollments.get(`${missionId}|${userId}`)!;
    return this.evaluator().evaluateEnrollment(mission, reqs, enrollment, at(nowIso), origin);
  }
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('instantMs', () => {
  it('reads a SQLite datetime as UTC, like an ISO string with Z', () => {
    expect(instantMs('2026-01-10 00:00:00')).toBe(Date.parse('2026-01-10T00:00:00Z'));
    expect(instantMs('2026-01-10T00:00:00')).toBe(Date.parse('2026-01-10T00:00:00Z'));
    expect(instantMs('2026-01-10T00:00:00.000Z')).toBe(Date.parse('2026-01-10T00:00:00Z'));
  });
});

describe('isMissionStaff', () => {
  it('treats admin and content_creator as staff, tutor and student not', () => {
    expect(isMissionStaff(['admin'])).toBe(true);
    expect(isMissionStaff(['student', 'content_creator'])).toBe(true);
    expect(isMissionStaff(['tutor', 'student'])).toBe(false);
  });
});

describe('MissionEvaluator — windowing and sequential unlock', () => {
  it('sequential: step 2 evidence before step 1 completedAt does not count; after it does', async () => {
    const w = new World();
    const m = makeMission({ mode: 'sequential' });
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    const s2 = submissions(m.id, 2, TOPIC_B, 1);
    w.addMission(m, [s1, s2]);
    w.enroll(m.id, STUDENT);

    w.item(s2.id, T(3)); // before step 1 completes
    w.item(s1.id, T(5));
    const first = await w.evaluate(m.id, T(6));

    expect(first.stepsCompleted).toEqual([{ missionId: m.id, requirementId: s1.id, completedAt: T(5) }]);
    expect(w.step(s2.id)?.completedAt ?? null).toBeNull();
    expect(w.step(s2.id)?.currentCount).toBe(0);
    const step2Call = w.countCalls.find((c) => c.requirement.id === s2.id)!;
    expect(step2Call.previousRequirementId).toBe(s1.id);
    expect(step2Call.userId).toBe(STUDENT);

    w.item(s2.id, T(7)); // after step 1 completedAt
    const second = await w.evaluate(m.id, T(8));
    expect(second.stepsCompleted).toEqual([{ missionId: m.id, requirementId: s2.id, completedAt: T(7) }]);
    expect(second.missionsCompleted).toEqual([m.id]);
  });

  it('sequential: a locked step is not counted at all', async () => {
    const w = new World();
    const m = makeMission({ mode: 'sequential' });
    const s1 = submissions(m.id, 1, TOPIC_A, 2);
    const s2 = submissions(m.id, 2, TOPIC_B, 1);
    w.addMission(m, [s1, s2]);
    w.enroll(m.id, STUDENT);
    w.item(s1.id, T(2));
    w.item(s2.id, T(3));

    const outcome = await w.evaluate(m.id, T(4));

    expect(outcome.stepsCompleted).toEqual([]);
    expect(w.countCalls.map((c) => c.requirement.id)).toEqual([s1.id]);
    expect(w.step(s1.id)?.currentCount).toBe(1);
    expect(w.step(s2.id)).toBeUndefined();
  });

  it('parallel: every step is open from the floor, whatever the order of completion', async () => {
    const w = new World();
    const m = makeMission({ mode: 'parallel' });
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    const s2 = submissions(m.id, 2, TOPIC_B, 1);
    w.addMission(m, [s1, s2]);
    w.enroll(m.id, STUDENT);
    w.item(s2.id, T(3));

    const outcome = await w.evaluate(m.id, T(4));

    expect(outcome.stepsCompleted).toEqual([{ missionId: m.id, requirementId: s2.id, completedAt: T(3) }]);
    expect(w.countCalls.every((c) => c.previousRequirementId === null)).toBe(true);
    expect(w.step(s1.id)?.currentCount).toBe(0);
  });

  it('late open join: countsFrom = joinedAt, evidence before Join is ignored', async () => {
    const w = new World();
    const m = makeMission({ enrollmentMode: 'open' });
    const s1 = submissions(m.id, 1, TOPIC_A, 2);
    w.addMission(m, [s1]);
    // SQLite-form instants, as the enrollment table stores them.
    w.enroll(m.id, STUDENT, { source: 'self', joinedAt: '2026-01-10 00:00:00', countsFrom: '2026-01-10 00:00:00' });
    w.item(s1.id, T(5));
    w.item(s1.id, T(12));

    const first = await w.evaluate(m.id, T(14));
    expect(first.stepsCompleted).toEqual([]);
    expect(w.step(s1.id)?.currentCount).toBe(1);

    w.item(s1.id, T(13));
    const second = await w.evaluate(m.id, T(14));
    expect(second.stepsCompleted).toEqual([{ missionId: m.id, requirementId: s1.id, completedAt: T(13) }]);
  });

  it('edges: evidence exactly at startAt and endAt counts; before startAt, after endAt or after now does not', async () => {
    const w = new World();
    const m = makeMission();
    const s1 = submissions(m.id, 1, TOPIC_A, 3);
    w.addMission(m, [s1]);
    w.enroll(m.id, STUDENT);
    w.item(s1.id, '2025-12-31T23:59:59.999Z'); // just before startAt
    w.item(s1.id, START);
    w.item(s1.id, END);
    w.item(s1.id, '2026-01-31T00:00:00.001Z'); // just after endAt

    await w.evaluate(m.id, '2026-02-01T00:00:00.000Z', 'reconcile');
    expect(w.step(s1.id)?.currentCount).toBe(2);
    expect(w.step(s1.id)?.completedAt).toBeNull();

    // Evaluated before endAt, an item dated after now does not count either.
    const w2 = new World();
    const m2 = w2.addMission(makeMission(), [submissions('mission-1', 1, TOPIC_A, 3)]);
    const r2 = w2.requirementsByMission.get(m2.id)![0];
    w2.enroll(m2.id, STUDENT);
    w2.item(r2.id, START);
    w2.item(r2.id, T(20));
    await w2.evaluate(m2.id, T(10));
    expect(w2.step(r2.id)?.currentCount).toBe(1);
  });
});

describe('MissionEvaluator — completion instant', () => {
  const setup = () => {
    const w = new World();
    const m = makeMission({ xpReward: 0 });
    const s1 = submissions(m.id, 1, TOPIC_A, 3);
    w.addMission(m, [s1]);
    w.enroll(m.id, STUDENT);
    for (const day of [2, 3, 4, 5]) w.item(s1.id, T(day)); // t1 < t2 < t3 < t4
    return { w, m, s1 };
  };

  it('completedAt is t3 when evaluated at t3', async () => {
    const { w, m, s1 } = setup();
    await w.evaluate(m.id, T(4));
    expect(w.step(s1.id)?.completedAt).toBe(T(4)); // items t1, t2, t3 = days 2, 3, 4
  });

  it('completedAt is still t3 when evaluated a day after t4 (hook or reconcile)', async () => {
    const hook = setup();
    await hook.w.evaluate(hook.m.id, T(6), 'hook');
    expect(hook.w.step(hook.s1.id)?.completedAt).toBe(T(4));
    expect(hook.w.step(hook.s1.id)?.completedBy).toBe('hook');

    const cron = setup();
    await cron.w.evaluate(cron.m.id, T(6), 'reconcile');
    expect(cron.w.step(cron.s1.id)?.completedAt).toBe(T(4));
    expect(cron.w.step(cron.s1.id)?.completedBy).toBe('reconcile');
  });
});

describe('MissionEvaluator — regression and write-once', () => {
  it('an incomplete step count drops when evidence disappears', async () => {
    const w = new World();
    const m = makeMission();
    const s1 = submissions(m.id, 1, TOPIC_A, 3);
    w.addMission(m, [s1]);
    w.enroll(m.id, STUDENT);
    w.item(s1.id, T(2));
    w.item(s1.id, T(3));

    await w.evaluate(m.id, T(4));
    expect(w.step(s1.id)?.currentCount).toBe(2);

    w.sourceItems.pop();
    await w.evaluate(m.id, T(5));
    expect(w.step(s1.id)?.currentCount).toBe(1);
  });

  it('re-evaluating a completed mission after its evidence disappears changes nothing and rewards nothing', async () => {
    const w = new World();
    w.badgesById.set('badge-1', makeBadge());
    const m = makeMission({ badgeId: 'badge-1' });
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    const s2 = submissions(m.id, 2, TOPIC_B, 1);
    w.addMission(m, [s1, s2]);
    w.enroll(m.id, STUDENT);
    w.item(s1.id, T(2));
    w.item(s2.id, T(3));
    await w.evaluate(m.id, T(4));
    expect(w.missionProgress.get(`${STUDENT}|${m.id}`)?.completed).toBe(true);

    const xpBefore = w.xpCalls.length;
    const badgesBefore = w.badgeAwards.length;
    w.sourceItems = [];
    const again = await w.evaluate(m.id, T(10));

    expect(again).toEqual({ stepsCompleted: [], missionsCompleted: [] });
    expect(w.step(s1.id)?.completedAt).toBe(T(2));
    expect(w.step(s2.id)?.completedAt).toBe(T(3));
    expect(w.missionProgress.get(`${STUDENT}|${m.id}`)?.completed).toBe(true);
    expect(w.xpCalls.length).toBe(xpBefore);
    expect(w.badgeAwards.length).toBe(badgesBefore);
    expect(w.countCalls.filter((c) => c.nowIso === T(10))).toEqual([]); // completed steps are never recounted
    expect(w.participation.setPartialCount).not.toHaveBeenCalled();
  });
});

describe('MissionEvaluator — rewards', () => {
  it('two evaluations of the same completion grant one step reward per step, one mission reward and one badge', async () => {
    const w = new World();
    w.badgesById.set('badge-1', makeBadge({ xpReward: 25 }));
    const m = makeMission({ xpReward: 100, badgeId: 'badge-1' });
    const s1 = submissions(m.id, 1, TOPIC_A, 1, 10);
    const s2 = submissions(m.id, 2, TOPIC_B, 1, 20);
    w.addMission(m, [s1, s2]);
    w.enroll(m.id, STUDENT);
    w.item(s1.id, T(2));
    w.item(s2.id, T(3));

    await w.evaluate(m.id, T(4));
    await w.evaluate(m.id, T(4));

    expect(w.xpOf('mission_step_reward')).toEqual([
      { userId: STUDENT, action: 'mission_step_reward', sourceKind: 'mission_step_reward', sourceId: s1.id, customPoints: 10 },
      { userId: STUDENT, action: 'mission_step_reward', sourceKind: 'mission_step_reward', sourceId: s2.id, customPoints: 20 },
    ]);
    expect(w.xpOf('mission_reward')).toEqual([
      { userId: STUDENT, action: 'mission_reward', sourceKind: 'mission_reward', sourceId: m.id, customPoints: 100 },
    ]);
    expect(w.badgeAwards).toEqual([{ userId: STUDENT, badgeId: 'badge-1' }]);
    expect(w.xpOf('badge_award')).toEqual([
      { userId: STUDENT, action: 'badge_award', sourceKind: 'badge_award', sourceId: 'badge-1', customPoints: 25 },
    ]);
  });

  it('a step with xpReward 0 completes without an XP call; an inactive badge is not granted', async () => {
    const w = new World();
    w.badgesById.set('badge-1', makeBadge({ active: false }));
    const m = makeMission({ xpReward: 0, badgeId: 'badge-1' });
    const s1 = submissions(m.id, 1, TOPIC_A, 1, 0);
    w.addMission(m, [s1]);
    w.enroll(m.id, STUDENT);
    w.item(s1.id, T(2));

    const outcome = await w.evaluate(m.id, T(3));

    expect(outcome.missionsCompleted).toEqual([m.id]);
    expect(w.xpCalls).toEqual([]);
    expect(w.badgeAwards).toEqual([]);
  });

  it('a step already completed by a concurrent call (completeStep → false) grants no step reward', async () => {
    const w = new World();
    const m = makeMission();
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    const s2 = submissions(m.id, 2, TOPIC_B, 1);
    w.addMission(m, [s1, s2]);
    w.enroll(m.id, STUDENT);
    w.item(s1.id, T(2));
    vi.mocked(w.participation.completeStep).mockResolvedValueOnce(false);

    const outcome = await w.evaluate(m.id, T(3));

    expect(outcome.stepsCompleted).toEqual([]);
    expect(w.xpOf('mission_step_reward')).toEqual([]);
  });

  it('keeps mission_progress.current_value equal to the completed steps', async () => {
    const w = new World();
    const m = makeMission();
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    const s2 = submissions(m.id, 2, TOPIC_B, 1);
    const s3 = submissions(m.id, 3, TOPIC_B, 2);
    w.addMission(m, [s1, s2, s3]);
    w.enroll(m.id, STUDENT);

    await w.evaluate(m.id, T(2));
    expect(w.missionProgress.get(`${STUDENT}|${m.id}`)).toBeUndefined(); // nothing completed, nothing written

    w.item(s1.id, T(3));
    await w.evaluate(m.id, T(4));
    expect(w.missionProgress.get(`${STUDENT}|${m.id}`)).toMatchObject({ currentValue: 1, targetValue: 3, completed: false });

    w.item(s2.id, T(5));
    await w.evaluate(m.id, T(6));
    expect(w.missionProgress.get(`${STUDENT}|${m.id}`)).toMatchObject({ currentValue: 2, targetValue: 3, completed: false });
    expect(w.xpOf('mission_reward')).toEqual([]);

    w.item(s3.id, T(7));
    w.item(s3.id, T(8));
    const last = await w.evaluate(m.id, T(9));
    expect(last.missionsCompleted).toEqual([m.id]);
    expect(w.missionProgress.get(`${STUDENT}|${m.id}`)).toMatchObject({ currentValue: 3, targetValue: 3, completed: true });
  });
});

describe('MissionEvaluator — streak', () => {
  it('a step closed by a hook records exactly one streak activity, even across missions', async () => {
    const w = new World();
    w.addStudent();
    const m1 = w.addMission(makeMission({ id: 'm1' }), [visit('m1', 1, TOPIC_A)]);
    const m2 = w.addMission(makeMission({ id: 'm2' }), [visit('m2', 1, TOPIC_A)]);
    const evaluator = w.evaluator();

    const outcome = await evaluator.onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_A }, at(T(5)));

    expect(outcome.stepsCompleted.map((s) => s.missionId).sort()).toEqual([m1.id, m2.id]);
    expect(outcome.missionsCompleted.sort()).toEqual([m1.id, m2.id]);
    expect(w.streakCalls).toEqual([{ userId: STUDENT, now: at(T(5)) }]);

    // A repeat visit closes nothing: no further streak call.
    await evaluator.onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_A }, at(T(6)));
    expect(w.streakCalls).toHaveLength(1);
  });

  it('a step closed by a manual check records exactly one streak activity', async () => {
    const w = new World();
    const m = makeMission({ enrollmentMode: 'open' });
    const r = manual(m.id, 1);
    w.addMission(m, [r]);
    w.enroll(m.id, STUDENT, { source: 'self' });

    const result = await w.evaluator().check(STUDENT, m.id, r.id, at(T(5)));

    expect(result).toMatchObject({ ok: true, alreadyChecked: false });
    expect(w.streakCalls).toEqual([{ userId: STUDENT, now: at(T(5)) }]);
  });

  it('a step closed by the reconciliation records no streak activity', async () => {
    const w = new World();
    const m = makeMission();
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    w.addMission(m, [s1]);
    w.enroll(m.id, STUDENT);
    w.item(s1.id, T(2));

    const stats = await w.evaluator().reconcileMission(m.id, at(T(3)));

    expect(stats).toEqual({
      missionId: m.id,
      enrollmentsEvaluated: 1,
      implicitEnrollmentsCreated: 0,
      stepsCompleted: 1,
      missionsCompleted: 1,
    });
    expect(w.step(s1.id)?.completedBy).toBe('reconcile');
    expect(w.streakCalls).toEqual([]);
  });
});

describe('MissionEvaluator — implicit enrollment policy', () => {
  const autoMission = (w: World, enrollmentMode: Mission['enrollmentMode'] = 'auto') => {
    const m = makeMission({ enrollmentMode });
    w.addMission(m, [visit(m.id, 1, TOPIC_A), submissions(m.id, 2, TOPIC_B, 1)]);
    return m;
  };

  it('auto: enrolls a non-staff user who can access every topic target, counting from startAt', async () => {
    const w = new World();
    w.addStudent();
    const m = autoMission(w);

    const outcome = await w.evaluator().onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_A }, at(T(5)));

    expect(w.participation.ensureEnrollment).toHaveBeenCalledWith(m.id, STUDENT, 'auto', START);
    expect(outcome.stepsCompleted).toHaveLength(1);
  });

  it.each([['admin'], ['content_creator']])('auto: never enrolls staff (%s)', async () => {
    const w = new World();
    w.addStudent(STUDENT, { isStaff: true });
    autoMission(w);

    const outcome = await w.evaluator().onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_A }, at(T(5)));

    expect(w.participation.ensureEnrollment).not.toHaveBeenCalled();
    expect(w.participation.captureEvidence).not.toHaveBeenCalled();
    expect(outcome).toEqual({ stepsCompleted: [], missionsCompleted: [] });
  });

  it('auto: never enrolls a student whose access set lacks one topic target', async () => {
    const w = new World();
    w.addStudent(STUDENT, { accessibleTopicIds: [TOPIC_A] });
    const m = autoMission(w);

    await w.evaluator().onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_A }, at(T(5)));

    expect(w.participation.ensureEnrollment).not.toHaveBeenCalled();
    expect(await w.evaluator().ensureImplicitEnrollment(m, w.requirementsByMission.get(m.id)!, STUDENT, at(T(5)))).toBe(false);
  });

  it('auto: never enrolls an unknown user', async () => {
    const w = new World();
    const m = autoMission(w);
    expect(await w.evaluator().ensureImplicitEnrollment(m, w.requirementsByMission.get(m.id)!, 'ghost', at(T(5)))).toBe(false);
  });

  it('open: never enrolls implicitly', async () => {
    const w = new World();
    w.addStudent();
    const m = autoMission(w, 'open');

    const outcome = await w.evaluator().onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_A }, at(T(5)));

    expect(w.participation.ensureEnrollment).not.toHaveBeenCalled();
    expect(outcome.stepsCompleted).toEqual([]);
    expect(await w.evaluator().ensureImplicitEnrollment(m, w.requirementsByMission.get(m.id)!, STUDENT, at(T(5)))).toBe(false);
  });

  it('assigned: enrolls a user covered by a group (source admin), not an uncovered one', async () => {
    const w = new World();
    w.addStudent(STUDENT, { groupIds: ['g-1'] });
    w.addStudent('student-2', { groupIds: ['g-2'] });
    const m = autoMission(w, 'assigned');
    w.audience.set(m.id, { groupIds: ['g-1'], userIds: [] });

    await w.evaluator().onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_A }, at(T(5)));
    await w.evaluator().onSignal({ kind: 'topic_visit', userId: 'student-2', topicId: TOPIC_A }, at(T(5)));

    expect(w.participation.ensureEnrollment).toHaveBeenCalledTimes(1);
    expect(w.participation.ensureEnrollment).toHaveBeenCalledWith(m.id, STUDENT, 'admin', START);
  });

  it('assigned: enrolls a directly granted user', async () => {
    const w = new World();
    w.addStudent();
    const m = autoMission(w, 'assigned');
    w.audience.set(m.id, { groupIds: [], userIds: [STUDENT] });

    expect(await w.evaluator().ensureImplicitEnrollment(m, w.requirementsByMission.get(m.id)!, STUDENT, at(T(5)))).toBe(true);
  });

  it('skips a left enrollment: no capture, no evaluation, no re-enrollment', async () => {
    const w = new World();
    w.addStudent();
    const m = autoMission(w);
    w.enroll(m.id, STUDENT, { leftAt: T(3) });

    const outcome = await w.evaluator().onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_A }, at(T(5)));

    expect(outcome).toEqual({ stepsCompleted: [], missionsCompleted: [] });
    expect(w.participation.ensureEnrollment).not.toHaveBeenCalled();
    expect(w.participation.captureEvidence).not.toHaveBeenCalled();
    expect(w.countCalls).toEqual([]);
    expect(
      await w.evaluate(m.id, T(5)),
    ).toEqual({ stepsCompleted: [], missionsCompleted: [] });
  });
});

describe('MissionEvaluator — signals and capture', () => {
  it('zero candidates end the hook after the candidate lookup', async () => {
    const w = new World();
    const outcome = await w.evaluator().onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_A }, at(T(5)));
    expect(outcome).toEqual({ stepsCompleted: [], missionsCompleted: [] });
    expect(w.missionRepo.findCandidateRequirements).toHaveBeenCalledTimes(1);
    expect(w.missionRepo.listRequirements).not.toHaveBeenCalled();
    expect(w.participation.findEnrollment).not.toHaveBeenCalled();
  });

  it('video_watch of a media that is not a ready video of the topic: no capture, no evaluation', async () => {
    const w = new World();
    w.addStudent();
    const m = makeMission();
    w.addMission(m, [watch(m.id, 1, TOPIC_A, 1)]);
    w.enroll(m.id, STUDENT);

    const outcome = await w.evaluator().onSignal(
      { kind: 'video_watch', userId: STUDENT, topicId: TOPIC_A, mediaId: 'pdf-1' },
      at(T(5)),
    );

    expect(outcome).toEqual({ stepsCompleted: [], missionsCompleted: [] });
    expect(w.participation.captureEvidence).not.toHaveBeenCalled();
    expect(w.countCalls).toEqual([]);
  });

  it('video_watch of a ready video captures (refId = media id, occurredAt = now) and counts distinct videos', async () => {
    const w = new World();
    w.addStudent();
    w.readyVideos.add(`${TOPIC_A}:vid-1`).add(`${TOPIC_A}:vid-2`);
    const m = makeMission();
    const r = watch(m.id, 1, TOPIC_A, 2);
    w.addMission(m, [r]);
    w.enroll(m.id, STUDENT);
    const evaluator = w.evaluator();

    await evaluator.onSignal({ kind: 'video_watch', userId: STUDENT, topicId: TOPIC_A, mediaId: 'vid-1' }, at(T(5)));
    await evaluator.onSignal({ kind: 'video_watch', userId: STUDENT, topicId: TOPIC_A, mediaId: 'vid-1' }, at(T(6)));
    expect(w.step(r.id)?.currentCount).toBe(1);
    expect(w.captured).toEqual([
      { requirementId: r.id, userId: STUDENT, refId: 'vid-1', at: T(5), source: 'hook' },
    ]);

    const outcome = await evaluator.onSignal(
      { kind: 'video_watch', userId: STUDENT, topicId: TOPIC_A, mediaId: 'vid-2' },
      at(T(7)),
    );
    expect(outcome.stepsCompleted).toEqual([{ missionId: m.id, requirementId: r.id, completedAt: T(7) }]);
  });

  it('captures a visit only for a step open right now (a locked sequential step gets none)', async () => {
    const w = new World();
    w.addStudent();
    const m = makeMission({ mode: 'sequential' });
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    const s2 = visit(m.id, 2, TOPIC_B);
    w.addMission(m, [s1, s2]);
    w.enroll(m.id, STUDENT);
    const evaluator = w.evaluator();

    await evaluator.onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_B }, at(T(3)));
    expect(w.captured).toEqual([]);

    w.item(s1.id, T(4));
    await evaluator.onSignal({ kind: 'submission', userId: STUDENT, topicIds: [TOPIC_A] }, at(T(4)));
    expect(w.step(s1.id)?.completedAt).toBe(T(4));

    const outcome = await evaluator.onSignal({ kind: 'topic_visit', userId: STUDENT, topicId: TOPIC_B }, at(T(5)));
    expect(w.captured.map((c) => c.requirementId)).toEqual([s2.id]);
    expect(outcome.stepsCompleted).toEqual([{ missionId: m.id, requirementId: s2.id, completedAt: T(5) }]);
  });

  it('submission signal looks every topic up once and evaluates each mission once', async () => {
    const w = new World();
    w.addStudent();
    const m = makeMission();
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    const s2 = submissions(m.id, 2, TOPIC_B, 1);
    w.addMission(m, [s1, s2]);
    w.item(s1.id, T(2));
    w.item(s2.id, T(3));

    const outcome = await w.evaluator().onSignal(
      { kind: 'submission', userId: STUDENT, topicIds: [TOPIC_A, TOPIC_B, TOPIC_A] },
      at(T(4)),
    );

    expect(w.missionRepo.findCandidateRequirements).toHaveBeenCalledTimes(2);
    expect(w.missionRepo.listRequirements).toHaveBeenCalledTimes(1);
    expect(outcome.stepsCompleted).toHaveLength(2);
    expect(outcome.missionsCompleted).toEqual([m.id]);
    expect(w.participation.captureEvidence).not.toHaveBeenCalled();
  });

  it('event_charge signal evaluates event_participation steps and passes sharingEnabled through', async () => {
    const w = new World();
    w.addStudent();
    const m = makeMission();
    const r = eventStep(m.id, 1, 'event-1');
    w.addMission(m, [r]);
    w.item(r.id, T(10)); // the event's starts_at

    const outcome = await new MissionEvaluator(
      w.missionRepo, w.participation, w.evidence, w.badges, w.xp, w.streak, w.resolver, { sharingEnabled: false },
    ).onSignal({ kind: 'event_charge', userId: STUDENT, eventId: 'event-1' }, at(T(11)));

    expect(outcome.stepsCompleted).toEqual([{ missionId: m.id, requirementId: r.id, completedAt: T(10) }]);
    expect(w.countCalls[0].sharingEnabled).toBe(false);
  });
});

describe('MissionEvaluator — check', () => {
  const setup = (overrides: Partial<Mission> = {}) => {
    const w = new World();
    w.addStudent();
    const m = makeMission({ enrollmentMode: 'open', mode: 'sequential', ...overrides });
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    const c2 = manual(m.id, 2, 15);
    w.addMission(m, [s1, c2]);
    return { w, m, s1, c2 };
  };

  it('mission_not_found for an unknown or legacy mission', async () => {
    const { w, c2 } = setup();
    expect(await w.evaluator().check(STUDENT, 'nope', c2.id, at(T(5)))).toEqual({ ok: false, reason: 'mission_not_found' });
    w.addMission(makeMission({ id: 'legacy', predicateKind: 'watch_video' }), []);
    expect(await w.evaluator().check(STUDENT, 'legacy', c2.id, at(T(5)))).toEqual({ ok: false, reason: 'mission_not_found' });
  });

  it('mission_closed outside the window or when inactive', async () => {
    const { w, m, c2 } = setup();
    w.enroll(m.id, STUDENT, { source: 'self' });
    expect(await w.evaluator().check(STUDENT, m.id, c2.id, at('2026-02-01T00:00:00Z'))).toEqual({
      ok: false,
      reason: 'mission_closed',
    });
    m.active = false;
    expect(await w.evaluator().check(STUDENT, m.id, c2.id, at(T(5)))).toEqual({ ok: false, reason: 'mission_closed' });
  });

  it('requirement_not_found and not_manual_check', async () => {
    const { w, m, s1 } = setup();
    w.enroll(m.id, STUDENT, { source: 'self' });
    expect(await w.evaluator().check(STUDENT, m.id, 'nope', at(T(5)))).toEqual({ ok: false, reason: 'requirement_not_found' });
    expect(await w.evaluator().check(STUDENT, m.id, s1.id, at(T(5)))).toEqual({ ok: false, reason: 'not_manual_check' });
  });

  it('not_enrolled when the user never joined an open mission or has left it', async () => {
    const { w, m, c2 } = setup();
    expect(await w.evaluator().check(STUDENT, m.id, c2.id, at(T(5)))).toEqual({ ok: false, reason: 'not_enrolled' });
    w.enroll(m.id, STUDENT, { source: 'self', leftAt: T(3) });
    expect(await w.evaluator().check(STUDENT, m.id, c2.id, at(T(5)))).toEqual({ ok: false, reason: 'not_enrolled' });
    expect(w.participation.markChecked).not.toHaveBeenCalled();
  });

  it('step_locked while the sequential predecessor is incomplete', async () => {
    const { w, m, c2 } = setup();
    w.enroll(m.id, STUDENT, { source: 'self' });
    expect(await w.evaluator().check(STUDENT, m.id, c2.id, at(T(5)))).toEqual({ ok: false, reason: 'step_locked' });
    expect(w.participation.markChecked).not.toHaveBeenCalled();
  });

  it('happy path: checks, completes at checkedAt, rewards, then already_completed', async () => {
    const { w, m, s1, c2 } = setup();
    w.enroll(m.id, STUDENT, { source: 'self' });
    w.item(s1.id, T(2));
    await w.evaluate(m.id, T(3));

    const result = await w.evaluator().check(STUDENT, m.id, c2.id, at(T(5)));

    expect(result).toEqual({
      ok: true,
      alreadyChecked: false,
      outcome: {
        stepsCompleted: [{ missionId: m.id, requirementId: c2.id, completedAt: T(5) }],
        missionsCompleted: [m.id],
      },
    });
    expect(w.step(c2.id)).toMatchObject({ checkedAt: T(5), completedAt: T(5), completedBy: 'hook' });
    expect(w.xpOf('mission_step_reward').map((c) => c.sourceId)).toEqual([s1.id, c2.id]);
    expect(await w.evaluator().check(STUDENT, m.id, c2.id, at(T(6)))).toEqual({ ok: false, reason: 'already_completed' });
  });

  it('alreadyChecked is true when checkedAt was set earlier; completion keeps that instant', async () => {
    const { w, m, s1, c2 } = setup({ mode: 'parallel' });
    w.enroll(m.id, STUDENT, { source: 'self' });
    w.stepProgress.set(`${c2.id}|${STUDENT}`, {
      requirementId: c2.id,
      userId: STUDENT,
      missionId: m.id,
      currentCount: 0,
      targetCount: 1,
      checkedAt: T(4),
      completedAt: null,
      completedBy: null,
      recordedAt: null,
      updatedAt: T(4),
    });

    const result = await w.evaluator().check(STUDENT, m.id, c2.id, at(T(5)));

    expect(result).toMatchObject({ ok: true, alreadyChecked: true });
    expect(w.step(c2.id)?.completedAt).toBe(T(4));
    expect(w.step(s1.id)?.completedAt ?? null).toBeNull();
  });

  it('auto mission: a check creates the implicit enrollment first', async () => {
    const w = new World();
    w.addStudent();
    const m = makeMission({ enrollmentMode: 'auto' });
    const c1 = manual(m.id, 1);
    w.addMission(m, [c1]);

    const result = await w.evaluator().check(STUDENT, m.id, c1.id, at(T(5)));

    expect(w.participation.ensureEnrollment).toHaveBeenCalledWith(m.id, STUDENT, 'auto', START);
    expect(result).toMatchObject({ ok: true, alreadyChecked: false });
  });
});

describe('MissionEvaluator — reconcileMission', () => {
  it('counts each requirement once for every active enrollment (userId null) and skips left ones', async () => {
    const w = new World();
    const m = makeMission({ mode: 'sequential' });
    const s1 = submissions(m.id, 1, TOPIC_A, 1);
    const s2 = submissions(m.id, 2, TOPIC_B, 1);
    w.addMission(m, [s1, s2]);
    w.enroll(m.id, 'u1');
    w.enroll(m.id, 'u2');
    w.enroll(m.id, 'u3', { leftAt: T(2) });
    w.item(s1.id, T(2), 'u1');
    w.item(s2.id, T(3), 'u1');
    w.item(s1.id, T(2), 'u2');
    w.item(s1.id, T(2), 'u3');

    const stats = await w.evaluator().reconcileMission(m.id, at(T(5)));

    expect(stats).toEqual({
      missionId: m.id,
      enrollmentsEvaluated: 2,
      implicitEnrollmentsCreated: 0,
      stepsCompleted: 3,
      missionsCompleted: 1,
    });
    expect(w.countCalls.map((c) => [c.requirement.id, c.userId, c.previousRequirementId])).toEqual([
      [s1.id, null, null],
      [s2.id, null, s1.id],
    ]);
    expect(w.step(s1.id, 'u3')).toBeUndefined();
    expect(w.step(s2.id, 'u2')?.currentCount).toBe(0);
    expect(w.streakCalls).toEqual([]);
  });

  it('returns zero stats for an unknown or legacy mission', async () => {
    const w = new World();
    w.addMission(makeMission({ id: 'legacy', predicateKind: 'watch_video' }), []);
    for (const id of ['nope', 'legacy']) {
      expect(await w.evaluator().reconcileMission(id, at(T(5)))).toEqual({
        missionId: id,
        enrollmentsEvaluated: 0,
        implicitEnrollmentsCreated: 0,
        stepsCompleted: 0,
        missionsCompleted: 0,
      });
    }
  });
});
