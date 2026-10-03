import type { DashboardMissionEntry, MissionStepView } from '@web/lib/missions-api';

export const TOPIC = '11111111-1111-4111-8111-111111111111';

export function step(overrides: Partial<MissionStepView> & Pick<MissionStepView, 'id' | 'position'>): MissionStepView {
  return {
    kind: 'manual_check',
    title: `Step ${overrides.position}`,
    xpReward: 10,
    target: null,
    instructions: null,
    current: 0,
    required: 1,
    state: 'open',
    completedAt: null,
    ...overrides,
  };
}

export function entry(
  id: string,
  title: string,
  overrides: Partial<Omit<DashboardMissionEntry, 'mission'>> & { mission?: Partial<DashboardMissionEntry['mission']> } = {},
): DashboardMissionEntry {
  const { mission, ...rest } = overrides;
  return {
    mission: {
      id,
      title,
      description: `${title} description`,
      startAt: '2026-10-01T00:00:00.000Z',
      endAt: '2026-10-31T23:59:59.000Z',
      predicateKind: 'requirements',
      predicateParams: '{}',
      xpReward: 300,
      badgeId: null,
      active: true,
      mode: 'parallel',
      enrollmentMode: 'auto',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      ...mission,
    },
    progress: null,
    enrollment: null,
    joinable: false,
    locked: null,
    steps: [],
    ...rest,
  };
}
