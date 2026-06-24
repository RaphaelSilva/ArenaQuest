import type { HttpTransport } from './api-client';

// ---------------------------------------------------------------------------
// Wire types — string ids/dates mirroring the backend admin gamification API.
// The shared Entities.Gamification.* shapes type some date fields as `Date`;
// over the wire they arrive as ISO strings, so we keep local string-typed
// records here while staying structurally aligned with the shared catalog.
// ---------------------------------------------------------------------------

export type Badge = {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string;
  description: string | null;
  xpReward: number | null;
  ruleKind: string;
  ruleParams: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateBadgeInput = {
  slug: string;
  name: string;
  iconEmoji: string;
  description?: string;
  xpReward?: number;
  ruleKind: string;
  ruleParams?: string;
};

export type UpdateBadgeInput = {
  name?: string;
  iconEmoji?: string;
  description?: string;
  xpReward?: number;
  ruleKind?: string;
  ruleParams?: string;
  active?: boolean;
};

export type Mission = {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  predicateKind: string;
  predicateParams: string;
  xpReward: number;
  badgeId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateMissionInput = {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  predicateKind: string;
  predicateParams: string;
  xpReward: number;
  badgeId?: string | null;
  active?: boolean;
};

export type UpdateMissionInput = {
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  predicateKind?: string;
  predicateParams?: string;
  xpReward?: number;
  badgeId?: string | null;
  active?: boolean;
};

export type QuestKind = 'daily' | 'weekly';

export type Quest = {
  id: string;
  kind: QuestKind;
  title: string;
  description: string;
  predicateKind: string;
  predicateParams: string;
  xpReward: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateQuestInput = {
  kind: QuestKind;
  title: string;
  description: string;
  predicateKind: string;
  predicateParams: string;
  xpReward: number;
  active?: boolean;
};

export type UpdateQuestInput = {
  kind?: QuestKind;
  title?: string;
  description?: string;
  predicateKind?: string;
  predicateParams?: string;
  xpReward?: number;
  active?: boolean;
};

export type LevelDefinition = {
  level: number;
  rankTitle: string;
  minXp: number;
  maxXp: number | null;
};

export type ProgressionBadge = {
  badgeId: string;
  slug: string;
  name: string;
  earnedAt: string;
};

export type RecentXpEvent = {
  id: string;
  sourceKind: string;
  points: number;
  earnedAt: string;
};

export type PlayerProgression = {
  userId: string;
  xp: {
    totalXp: number;
    level: number;
    rankTitle: string;
  };
  badges: ProgressionBadge[];
  recentXpEvents: RecentXpEvent[];
};

export type XpAdjustmentInput = {
  points: number;
  reason: string;
};

export type XpAdjustmentResult = {
  previousTotal: number;
  newTotal: number;
};

export class AdminGamificationApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'AdminGamificationApiError';
  }
}

async function rejectWith(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  throw new AdminGamificationApiError(
    typeof body.error === 'string' ? body.error : fallback,
    res.status,
    body,
  );
}

export function createAdminGamificationApi(http: HttpTransport) {
  return {
    badges: {
      async list(): Promise<Badge[]> {
        const res = await http('GET', '/admin/badges');
        if (!res.ok) await rejectWith(res, 'BADGES_LIST_FAILED');
        const body = (await res.json()) as { data: Badge[] };
        return body.data;
      },

      async create(input: CreateBadgeInput): Promise<Badge> {
        const res = await http('POST', '/admin/badges', { body: JSON.stringify(input) });
        if (!res.ok) await rejectWith(res, 'BADGE_CREATE_FAILED');
        const body = (await res.json()) as { data: Badge };
        return body.data;
      },

      async update(id: string, input: UpdateBadgeInput): Promise<Badge> {
        const res = await http('PATCH', `/admin/badges/${id}`, { body: JSON.stringify(input) });
        if (!res.ok) await rejectWith(res, 'BADGE_UPDATE_FAILED');
        const body = (await res.json()) as { data: Badge };
        return body.data;
      },
    },

    missions: {
      async list(): Promise<Mission[]> {
        const res = await http('GET', '/admin/missions');
        if (!res.ok) await rejectWith(res, 'MISSIONS_LIST_FAILED');
        const body = (await res.json()) as { data: Mission[] };
        return body.data;
      },

      async create(input: CreateMissionInput): Promise<Mission> {
        const res = await http('POST', '/admin/missions', { body: JSON.stringify(input) });
        if (!res.ok) await rejectWith(res, 'MISSION_CREATE_FAILED');
        const body = (await res.json()) as { data: Mission };
        return body.data;
      },

      async update(id: string, input: UpdateMissionInput): Promise<Mission> {
        const res = await http('PATCH', `/admin/missions/${id}`, { body: JSON.stringify(input) });
        if (!res.ok) await rejectWith(res, 'MISSION_UPDATE_FAILED');
        const body = (await res.json()) as { data: Mission };
        return body.data;
      },

      async delete(id: string): Promise<void> {
        const res = await http('DELETE', `/admin/missions/${id}`);
        if (!res.ok) await rejectWith(res, 'MISSION_DELETE_FAILED');
      },
    },

    quests: {
      async list(): Promise<Quest[]> {
        const res = await http('GET', '/admin/quests');
        if (!res.ok) await rejectWith(res, 'QUESTS_LIST_FAILED');
        const body = (await res.json()) as { data: Quest[] };
        return body.data;
      },

      async create(input: CreateQuestInput): Promise<Quest> {
        const res = await http('POST', '/admin/quests', { body: JSON.stringify(input) });
        if (!res.ok) await rejectWith(res, 'QUEST_CREATE_FAILED');
        const body = (await res.json()) as { data: Quest };
        return body.data;
      },

      async update(id: string, input: UpdateQuestInput): Promise<Quest> {
        const res = await http('PATCH', `/admin/quests/${id}`, { body: JSON.stringify(input) });
        if (!res.ok) await rejectWith(res, 'QUEST_UPDATE_FAILED');
        const body = (await res.json()) as { data: Quest };
        return body.data;
      },

      async delete(id: string): Promise<void> {
        const res = await http('DELETE', `/admin/quests/${id}`);
        if (!res.ok) await rejectWith(res, 'QUEST_DELETE_FAILED');
      },
    },

    levels: {
      // The levels endpoint returns the bare array (not a { data } envelope).
      async list(): Promise<LevelDefinition[]> {
        const res = await http('GET', '/admin/levels');
        if (!res.ok) await rejectWith(res, 'LEVELS_LIST_FAILED');
        return (await res.json()) as LevelDefinition[];
      },

      async replaceAll(rows: LevelDefinition[]): Promise<LevelDefinition[]> {
        const res = await http('PUT', '/admin/levels', { body: JSON.stringify(rows) });
        if (!res.ok) await rejectWith(res, 'LEVELS_REPLACE_FAILED');
        return (await res.json()) as LevelDefinition[];
      },
    },

    progression: {
      // All progression endpoints return bare bodies (no { data } envelope).
      async get(userId: string): Promise<PlayerProgression> {
        const res = await http('GET', `/admin/players/${userId}/progression`);
        if (!res.ok) await rejectWith(res, 'PROGRESSION_GET_FAILED');
        return (await res.json()) as PlayerProgression;
      },

      async awardBadge(userId: string, badgeId: string): Promise<void> {
        const res = await http('POST', `/admin/players/${userId}/badges/${badgeId}`);
        if (!res.ok) await rejectWith(res, 'BADGE_AWARD_FAILED');
      },

      async revokeBadge(userId: string, badgeId: string): Promise<void> {
        const res = await http('DELETE', `/admin/players/${userId}/badges/${badgeId}`);
        if (!res.ok) await rejectWith(res, 'BADGE_REVOKE_FAILED');
      },

      async adjustXp(userId: string, input: XpAdjustmentInput): Promise<XpAdjustmentResult> {
        const res = await http('POST', `/admin/players/${userId}/xp-adjustments`, {
          body: JSON.stringify(input),
        });
        if (!res.ok) await rejectWith(res, 'XP_ADJUST_FAILED');
        return (await res.json()) as XpAdjustmentResult;
      },

      async recomputeXp(userId: string): Promise<XpAdjustmentResult> {
        const res = await http('POST', `/admin/players/${userId}/xp-recompute`);
        if (!res.ok) await rejectWith(res, 'XP_RECOMPUTE_FAILED');
        return (await res.json()) as XpAdjustmentResult;
      },
    },
  };
}
