import { describe, it, expect, vi } from 'vitest';
import {
  AdminMissionsController,
  PARTICIPANTS_PAGE_SIZE,
  type AdminMissionsDeps,
  type MissionCreateBody,
} from '@api/controllers/admin-missions.controller';
import type { Mission, MissionEnrollment, MissionRequirement } from '@arenaquest/shared/domain/mission';
import type { RequirementInput } from '@arenaquest/shared/domain/missions/requirements';
import type { TopicNodeRecord } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-10T12:00:00.000Z');
const TOPIC = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm-1',
    title: 'Kihon month',
    description: 'Steps',
    startAt: '2026-10-20T00:00:00.000Z',
    endAt: '2026-10-31T00:00:00.000Z',
    predicateKind: 'requirements',
    predicateParams: '{}',
    xpReward: 100,
    badgeId: null,
    active: true,
    mode: 'parallel',
    enrollmentMode: 'auto',
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  };
}

function topic(overrides: Partial<TopicNodeRecord> = {}): TopicNodeRecord {
  return {
    id: TOPIC,
    parentId: null,
    title: 'Kihon',
    content: '',
    status: Entities.Config.TopicNodeStatus.PUBLISHED,
    tags: [],
    order: 1,
    estimatedMinutes: 0,
    prerequisiteIds: [],
    archived: false,
    visibility: Entities.Config.TopicVisibility.PUBLIC,
    ...overrides,
  };
}

function enrollment(userId: string, overrides: Partial<MissionEnrollment> = {}): MissionEnrollment {
  return {
    missionId: 'm-1',
    userId,
    source: 'admin',
    joinedAt: '2026-10-01 10:00:00',
    countsFrom: '2026-10-20T00:00:00.000Z',
    leftAt: null,
    ...overrides,
  };
}

interface World {
  deps: AdminMissionsDeps;
  controller: AdminMissionsController;
}

function makeWorld(
  opts: {
    mission?: Mission | null;
    topic?: TopicNodeRecord | null;
    media?: Array<{ type: string; status: Entities.Config.MediaStatus }>;
    event?: { status: Entities.Config.EventStatus } | null;
    price?: boolean;
    sharingEnabled?: boolean | null;
    badge?: boolean;
    enrollments?: MissionEnrollment[];
    groupMembers?: Record<string, string[]>;
    knownUsers?: string[];
  } = {},
): World {
  const current = opts.mission === undefined ? mission() : opts.mission;
  const enrollments = opts.enrollments ?? [];
  const groupMembers = opts.groupMembers ?? {};
  const knownUsers = new Set(opts.knownUsers ?? []);

  const deps: AdminMissionsDeps = {
    missions: {
      findById: vi.fn(async () => current),
      listAll: vi.fn(async () => (current ? [current] : [])),
      update: vi.fn(async (_id: string, patch: Partial<Mission>) => ({ ...current!, ...patch })),
      listRequirements: vi.fn(async () => []),
      replaceRequirements: vi.fn(async () => []),
      updateRequirementTitle: vi.fn(async () => null),
      getAudience: vi.fn(async () => ({ groupIds: [], userIds: [] })),
      replaceAudience: vi.fn(async () => undefined),
      findProgress: vi.fn(async () => null),
      createWithRequirements: vi.fn(async (input, requirements: RequirementInput[]) => ({
        mission: mission({ ...input, id: 'm-new' }),
        requirements: requirements.map((r, i) => ({ id: `r-${i}`, position: i + 1, kind: r.kind }) as MissionRequirement),
      })),
    } as unknown as AdminMissionsDeps['missions'],
    participation: {
      listEnrollments: vi.fn(async (_m: string, o?: { activeOnly?: boolean }) =>
        o?.activeOnly ? enrollments.filter((e) => e.leftAt === null) : enrollments,
      ),
      findEnrollment: vi.fn(async (_m: string, userId: string) => enrollments.find((e) => e.userId === userId) ?? null),
      ensureEnrollment: vi.fn(async () => true),
      join: vi.fn(async () => enrollment('x')),
      leave: vi.fn(async () => true),
      listStepProgress: vi.fn(async () => []),
    } as unknown as AdminMissionsDeps['participation'],
    topics: {
      findById: vi.fn(async () => (opts.topic === undefined ? topic() : opts.topic)),
    } as unknown as AdminMissionsDeps['topics'],
    media: {
      listByTopic: vi.fn(async () => opts.media ?? []),
    } as unknown as AdminMissionsDeps['media'],
    events: {
      findById: vi.fn(async () =>
        opts.event === undefined ? { status: Entities.Config.EventStatus.PUBLISHED } : opts.event,
      ),
    } as unknown as AdminMissionsDeps['events'],
    eventCharges: {
      getPrice: vi.fn(async () => (opts.price === false ? null : { eventId: EVENT })),
    } as unknown as AdminMissionsDeps['eventCharges'],
    userGroups: {
      getById: vi.fn(async (id: string) => (id in groupMembers ? { id } : null)),
      listMembers: vi.fn(async (id: string) => (groupMembers[id] ?? []).map((userId) => ({ userId }))),
    } as unknown as AdminMissionsDeps['userGroups'],
    users: {
      findById: vi.fn(async (id: string) => (knownUsers.has(id) ? { id, name: `N-${id}`, email: `${id}@x` } : null)),
    } as unknown as AdminMissionsDeps['users'],
    badges: {
      findById: vi.fn(async () => (opts.badge === false ? null : { id: 'b-1' })),
    } as unknown as AdminMissionsDeps['badges'],
    sharingEnabled: opts.sharingEnabled === undefined ? true : opts.sharingEnabled,
    now: () => NOW,
  };
  return { deps, controller: new AdminMissionsController(deps) };
}

function createBody(requirements: RequirementInput[], overrides: Partial<MissionCreateBody> = {}): MissionCreateBody {
  return {
    title: 'Kihon month',
    description: 'Steps',
    startAt: '2026-10-20T00:00:00.000Z',
    endAt: '2026-10-31T00:00:00.000Z',
    mode: 'parallel',
    enrollmentMode: 'auto',
    xpReward: 0,
    badgeId: null,
    requirements,
    ...overrides,
  };
}

const manual: RequirementInput = { kind: 'manual_check', title: 'Tick', xpReward: 0, params: { instructions: '' } };
const visit: RequirementInput = { kind: 'topic_visited', title: 'Visit', xpReward: 0, topicId: TOPIC, params: {} };
const watch: RequirementInput = { kind: 'video_watched', title: 'Watch', xpReward: 0, topicId: TOPIC, params: { minCount: 1 } };
const seminar: RequirementInput = { kind: 'event_participation', title: 'Seminar', xpReward: 0, eventId: EVENT, params: {} };
const sharedDemo: RequirementInput = {
  kind: 'submissions_on_topic',
  title: 'Shared demo',
  xpReward: 0,
  topicId: TOPIC,
  params: { minCount: 1, requireDescription: false, visibility: 'shared_only', countModerated: false },
};

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

describe('AdminMissionsController — target validation', () => {
  const cases: Array<[string, Parameters<typeof makeWorld>[0], RequirementInput, string, string]> = [
    ['missing topic', { topic: null }, visit, 'INVALID_REQUIREMENT_TARGET', 'TOPIC_NOT_FOUND'],
    ['draft topic', { topic: topic({ status: Entities.Config.TopicNodeStatus.DRAFT }) }, visit, 'INVALID_REQUIREMENT_TARGET', 'TOPIC_NOT_PUBLISHED'],
    ['archived topic', { topic: topic({ archived: true }) }, visit, 'INVALID_REQUIREMENT_TARGET', 'TOPIC_ARCHIVED'],
    [
      'topic with only a pending video',
      { media: [{ type: 'video/mp4', status: Entities.Config.MediaStatus.PENDING }, { type: 'application/pdf', status: Entities.Config.MediaStatus.READY }] },
      watch,
      'INVALID_REQUIREMENT_TARGET',
      'TOPIC_HAS_NO_VIDEO',
    ],
    ['missing event', { event: null }, seminar, 'INVALID_REQUIREMENT_TARGET', 'EVENT_NOT_FOUND'],
    ['draft event', { event: { status: Entities.Config.EventStatus.DRAFT } }, seminar, 'INVALID_REQUIREMENT_TARGET', 'EVENT_NOT_PUBLISHED'],
    ['unpriced event', { price: false }, seminar, 'EVENT_NOT_CHARGEABLE', 'EVENT_NOT_CHARGEABLE'],
    ['shared_only with sharing off', { sharingEnabled: false }, sharedDemo, 'REQUIREMENT_SHARING_DISABLED', 'REQUIREMENT_SHARING_DISABLED'],
  ];

  for (const [name, world, requirement, error, reason] of cases) {
    it(`refuses a ${name} with the requirement index`, async () => {
      const { controller, deps } = makeWorld(world);
      const result = await controller.create(createBody([manual, requirement]));
      expect(result).toEqual({ ok: false, status: 400, error, meta: { index: 1, reason } });
      expect(deps.missions.createWithRequirements).not.toHaveBeenCalled();
    });
  }

  it('answers 500 SUBMISSION_CONFIG_INVALID for shared_only when the submission config is invalid', async () => {
    const { controller } = makeWorld({ sharingEnabled: null });
    const result = await controller.create(createBody([sharedDemo]));
    expect(result).toMatchObject({ ok: false, status: 500, error: 'SUBMISSION_CONFIG_INVALID' });
  });

  it('accepts a ready video and reads each topic once', async () => {
    const { controller, deps } = makeWorld({ media: [{ type: 'video/mp4', status: Entities.Config.MediaStatus.READY }] });
    const result = await controller.create(createBody([watch, visit, manual, seminar]));
    expect(result.ok).toBe(true);
    expect(deps.topics.findById).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown badge', async () => {
    const { controller } = makeWorld({ badge: false });
    const result = await controller.create(createBody([manual], { badgeId: '33333333-3333-4333-8333-333333333333' }));
    expect(result).toMatchObject({ ok: false, status: 400, error: 'BADGE_NOT_FOUND' });
  });

  it('replaceRequirements validates targets too', async () => {
    const { controller, deps } = makeWorld({ topic: topic({ archived: true }) });
    const result = await controller.replaceRequirements('m-1', [visit]);
    expect(result).toMatchObject({ ok: false, status: 400, meta: { index: 0, reason: 'TOPIC_ARCHIVED' } });
    expect(deps.missions.replaceRequirements).not.toHaveBeenCalled();
  });

  it('replaceRequirements refuses a legacy predicate mission', async () => {
    const { controller } = makeWorld({ mission: mission({ predicateKind: 'topics_completed' }) });
    expect(await controller.replaceRequirements('m-1', [manual])).toMatchObject({ status: 409, error: 'MISSION_LEGACY' });
  });
});

// ---------------------------------------------------------------------------
// Start lock
// ---------------------------------------------------------------------------

describe('AdminMissionsController — start lock', () => {
  const started = mission({ startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-31T00:00:00.000Z', badgeId: 'b-1' });

  it.each([
    ['startAt', { startAt: '2026-10-02T00:00:00.000Z' }],
    ['mode', { mode: 'sequential' as const }],
    ['enrollmentMode', { enrollmentMode: 'open' as const }],
    ['xpReward', { xpReward: 5 }],
    ['badgeId', { badgeId: null }],
    ['endAt', { endAt: '2026-10-30T00:00:00.000Z' }],
  ])('refuses a change of %s once started', async (field, patch) => {
    const { controller, deps } = makeWorld({ mission: started });
    const result = await controller.update('m-1', patch);
    expect(result).toEqual({ ok: false, status: 409, error: 'MISSION_STARTED', meta: { fields: [field] } });
    expect(deps.missions.update).not.toHaveBeenCalled();
  });

  it('names every locked field at once', async () => {
    const { controller } = makeWorld({ mission: started });
    const result = await controller.update('m-1', { mode: 'sequential', xpReward: 1, title: 'Ok' });
    expect(result).toMatchObject({ status: 409, meta: { fields: ['mode', 'xpReward'] } });
  });

  it('accepts the stored value of a locked field (a full form resubmitted)', async () => {
    const { controller } = makeWorld({ mission: started });
    const result = await controller.update('m-1', {
      title: 'Renamed',
      startAt: '2026-10-01T00:00:00Z',
      mode: 'parallel',
      enrollmentMode: 'auto',
      xpReward: 100,
      badgeId: 'b-1',
      endAt: '2026-11-15T00:00:00.000Z',
      active: false,
    });
    expect(result.ok).toBe(true);
  });

  it('allows every field before start', async () => {
    const { controller, deps } = makeWorld();
    const result = await controller.update('m-1', { mode: 'sequential', xpReward: 5, startAt: '2026-10-21T00:00:00.000Z' });
    expect(result.ok).toBe(true);
    expect(deps.missions.update).toHaveBeenCalledWith('m-1', { mode: 'sequential', xpReward: 5, startAt: '2026-10-21T00:00:00.000Z' });
  });

  it('locks requirements once started', async () => {
    const { controller } = makeWorld({ mission: started });
    expect(await controller.replaceRequirements('m-1', [manual])).toMatchObject({
      status: 409,
      error: 'MISSION_STARTED',
      meta: { fields: ['requirements'] },
    });
  });

  it('updateRequirementTitle answers 404 when the requirement is not on the mission', async () => {
    const { controller } = makeWorld();
    expect(await controller.updateRequirementTitle('m-1', 'r-x', 'New')).toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

describe('AdminMissionsController — audience', () => {
  const assigned = mission({ enrollmentMode: 'assigned' });

  it('refuses a non-assigned mission', async () => {
    const { controller } = makeWorld();
    expect(await controller.replaceAudience('m-1', { groupIds: [], userIds: [] })).toMatchObject({
      status: 409,
      error: 'MISSION_NOT_ASSIGNED',
    });
  });

  it('names unknown groups and users', async () => {
    const { controller, deps } = makeWorld({ mission: assigned, knownUsers: ['u-1'] });
    const result = await controller.replaceAudience('m-1', { groupIds: ['g-x'], userIds: ['u-1', 'u-x'] });
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'UNKNOWN_AUDIENCE_TARGET',
      meta: { groupIds: ['g-x'], userIds: ['u-x'] },
    });
    expect(deps.missions.replaceAudience).not.toHaveBeenCalled();
  });

  it('enrolls new users, re-activates left ones and leaves the uncovered', async () => {
    const { controller, deps } = makeWorld({
      mission: assigned,
      knownUsers: ['u-new', 'u-back'],
      groupMembers: { 'g-1': ['u-member'] },
      enrollments: [
        enrollment('u-back', { leftAt: '2026-10-05 10:00:00' }),
        enrollment('u-member'),
        enrollment('u-gone'),
      ],
    });
    const result = await controller.replaceAudience('m-1', { groupIds: ['g-1', 'g-1'], userIds: ['u-new', 'u-back'] });
    expect(result).toEqual({ ok: true, data: { groupIds: ['g-1'], userIds: ['u-new', 'u-back'] } });

    expect(deps.participation.ensureEnrollment).toHaveBeenCalledTimes(1);
    expect(deps.participation.ensureEnrollment).toHaveBeenCalledWith('m-1', 'u-new', 'admin', assigned.startAt);
    expect(deps.participation.join).toHaveBeenCalledWith('m-1', 'u-back', NOW.toISOString());
    expect(deps.participation.leave).toHaveBeenCalledTimes(1);
    expect(deps.participation.leave).toHaveBeenCalledWith('m-1', 'u-gone', NOW.toISOString());
  });

  it('create refuses an audience unless enrollmentMode is assigned', async () => {
    const { controller } = makeWorld();
    const result = await controller.create(createBody([manual], { audience: { groupIds: [], userIds: [] } }));
    expect(result).toMatchObject({ status: 400, error: 'AUDIENCE_NOT_ALLOWED' });
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('AdminMissionsController — reads', () => {
  it('list counts active enrollments and completed progress', async () => {
    const { controller, deps } = makeWorld({
      enrollments: [enrollment('a'), enrollment('b', { leftAt: '2026-10-05 10:00:00' }), enrollment('c')],
    });
    vi.mocked(deps.missions.listRequirements).mockResolvedValue([{ id: 'r-1' }, { id: 'r-2' }] as MissionRequirement[]);
    vi.mocked(deps.missions.findProgress).mockImplementation(async (userId: string) =>
      userId === 'c' ? null : ({ completed: true } as never),
    );
    const result = await controller.list();
    expect(result).toMatchObject({ ok: true, data: [{ id: 'm-1', requirementCount: 2, enrolledCount: 2, completedCount: 2 }] });
  });

  it('get answers 404 for an unknown mission', async () => {
    const { controller } = makeWorld({ mission: null });
    expect(await controller.get('m-x')).toMatchObject({ status: 404 });
  });

  it('participants page on (joinedAt, userId) and resume after the cursor', async () => {
    const enrollments = Array.from({ length: PARTICIPANTS_PAGE_SIZE + 2 }, (_, i) =>
      enrollment(`u-${String(i).padStart(3, '0')}`, { joinedAt: i < 2 ? '2026-10-01 09:00:00' : '2026-10-01 10:00:00' }),
    );
    const { controller } = makeWorld({ enrollments });

    const first = await controller.listParticipants('m-1', null);
    if (!first.ok) throw new Error('expected ok');
    expect(first.data.data).toHaveLength(PARTICIPANTS_PAGE_SIZE);
    expect(first.data.nextCursor).toEqual({ sortKey: '2026-10-01 10:00:00', id: 'u-049' });

    const second = await controller.listParticipants('m-1', first.data.nextCursor);
    if (!second.ok) throw new Error('expected ok');
    expect(second.data.data.map((p) => p.userId)).toEqual(['u-050', 'u-051']);
    expect(second.data.nextCursor).toBeNull();
  });
});
