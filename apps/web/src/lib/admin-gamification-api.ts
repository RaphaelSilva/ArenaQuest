import type {
  MissionEnrollmentMode as SharedMissionEnrollmentMode,
  MissionMode as SharedMissionMode,
  RequirementInput,
  RequirementKind,
} from '@arenaquest/shared/domain/missions/requirements';
import type { HttpTransport } from './api-client';
import type { components } from './api-types.gen';

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

/**
 * Missions (RFC 0022 §6). Step kinds and params are defined once in
 * `@arenaquest/shared/domain/missions/requirements`; the wire shapes below
 * mirror `MissionListItem`, `MissionDetail` and `MissionCreateBody`. The
 * deprecated `predicateKind` / `predicateParams` response fields are not read.
 */
export type MissionMode = SharedMissionMode;
export type MissionEnrollmentMode = SharedMissionEnrollmentMode;
/** One step as the admin submits it, discriminated on `kind`. */
export type MissionRequirementInput = RequirementInput;

export type Mission = {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  xpReward: number;
  badgeId: string | null;
  active: boolean;
  mode: MissionMode;
  enrollmentMode: MissionEnrollmentMode;
  createdAt: string;
  updatedAt: string;
};

export type MissionListItem = Mission & {
  /** Steps of the mission; `0` for a legacy predicate mission. */
  requirementCount: number;
  enrolledCount: number;
  completedCount: number;
};

export type MissionRequirement = {
  id: string;
  missionId: string;
  /** 1-based order inside the mission. */
  position: number;
  kind: RequirementKind;
  title: string;
  topicId: string | null;
  eventId: string | null;
  /** The kind's params, defaults applied. */
  params: Record<string, unknown>;
  xpReward: number;
  createdAt: string;
  updatedAt: string;
};

export type MissionAudience = {
  groupIds: string[];
  userIds: string[];
};

export type MissionDetail = {
  mission: Mission;
  requirements: MissionRequirement[];
  audience: MissionAudience;
};

/** One step of a participant, as evaluated by the API (no `state`: the UI derives its chip). */
export type MissionParticipantStep = components['schemas']['MissionParticipantStep'];

/** One enrollment (active or left) with its aggregate and per-step progress. */
export type MissionParticipant = components['schemas']['MissionParticipant'];

/** A cursor-paginated page of participants; `nextCursor` is `null` on the last page. */
export type MissionParticipantPage = { data: MissionParticipant[]; nextCursor: string | null };

/** The counts of one `Reconcile now` run. */
export type MissionReconcileReport = components['schemas']['MissionReconcileReport'];

export type CreateMissionInput = {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  mode: MissionMode;
  enrollmentMode: MissionEnrollmentMode;
  xpReward: number;
  badgeId: string | null;
  requirements: MissionRequirementInput[];
  /** Only with `enrollmentMode = 'assigned'`. */
  audience?: MissionAudience;
};

/** After `startAt` only `title`, `description`, `active` and an extended `endAt` are accepted. */
export type UpdateMissionInput = {
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  mode?: MissionMode;
  enrollmentMode?: MissionEnrollmentMode;
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
    /** The whole error body, so a caller can read `index`, `reason`, `field`, `fields`, `issues`. */
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'AdminGamificationApiError';
  }

  /** Index of the offending item in `requirements`, when the API named one. */
  get index(): number | undefined {
    return typeof this.details.index === 'number' ? this.details.index : undefined;
  }

  /** Target refusal (`TOPIC_ARCHIVED`, …) or schema reason (`TOO_SMALL`, …). */
  get reason(): string | undefined {
    return typeof this.details.reason === 'string' ? this.details.reason : undefined;
  }

  /** Schema errors: the path inside the requirement, e.g. `params.minCount`. */
  get field(): string | undefined {
    return typeof this.details.field === 'string' ? this.details.field : undefined;
  }

  /** `MISSION_STARTED`: the fields locked by the start. */
  get fields(): string[] {
    return Array.isArray(this.details.fields)
      ? this.details.fields.filter((f): f is string => typeof f === 'string')
      : [];
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
      async list(): Promise<MissionListItem[]> {
        const res = await http('GET', '/admin/missions');
        if (!res.ok) await rejectWith(res, 'MISSIONS_LIST_FAILED');
        const body = (await res.json()) as { data: MissionListItem[] };
        return body.data;
      },

      async get(id: string): Promise<MissionDetail> {
        const res = await http('GET', `/admin/missions/${id}`);
        if (!res.ok) await rejectWith(res, 'MISSION_GET_FAILED');
        const body = (await res.json()) as { data: MissionDetail };
        return body.data;
      },

      async create(input: CreateMissionInput): Promise<MissionDetail> {
        const res = await http('POST', '/admin/missions', { body: JSON.stringify(input) });
        if (!res.ok) await rejectWith(res, 'MISSION_CREATE_FAILED');
        const body = (await res.json()) as { data: MissionDetail };
        return body.data;
      },

      async update(id: string, input: UpdateMissionInput): Promise<Mission> {
        const res = await http('PATCH', `/admin/missions/${id}`, { body: JSON.stringify(input) });
        if (!res.ok) await rejectWith(res, 'MISSION_UPDATE_FAILED');
        const body = (await res.json()) as { data: Mission };
        return body.data;
      },

      /** Replaces the ordered list; positions follow the array order. Refused once started. */
      async replaceRequirements(
        id: string,
        requirements: MissionRequirementInput[],
      ): Promise<MissionRequirement[]> {
        const res = await http('PUT', `/admin/missions/${id}/requirements`, {
          body: JSON.stringify({ requirements }),
        });
        if (!res.ok) await rejectWith(res, 'MISSION_REQUIREMENTS_FAILED');
        const body = (await res.json()) as { data: MissionRequirement[] };
        return body.data;
      },

      /** The one requirement field editable after start; the step keeps its id and progress. */
      async updateRequirementTitle(id: string, requirementId: string, title: string): Promise<MissionRequirement> {
        const res = await http('PATCH', `/admin/missions/${id}/requirements/${requirementId}`, {
          body: JSON.stringify({ title }),
        });
        if (!res.ok) await rejectWith(res, 'MISSION_REQUIREMENT_TITLE_FAILED');
        const body = (await res.json()) as { data: MissionRequirement };
        return body.data;
      },

      async replaceAudience(id: string, audience: MissionAudience): Promise<MissionAudience> {
        const res = await http('PUT', `/admin/missions/${id}/audience`, { body: JSON.stringify(audience) });
        if (!res.ok) await rejectWith(res, 'MISSION_AUDIENCE_FAILED');
        const body = (await res.json()) as { data: MissionAudience };
        return body.data;
      },

      /** One page of participants (50 per page); a malformed cursor answers `400 InvalidCursor`. */
      async listParticipants(id: string, cursor?: string | null): Promise<MissionParticipantPage> {
        const path = `/admin/missions/${id}/participants`;
        const res = await http('GET', cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path);
        if (!res.ok) await rejectWith(res, 'MISSION_PARTICIPANTS_FAILED');
        return (await res.json()) as MissionParticipantPage;
      },

      /** Admin only: runs the daily reconciliation for this mission now and returns its counts. */
      async reconcile(id: string): Promise<MissionReconcileReport> {
        const res = await http('POST', `/admin/missions/${id}/reconcile`);
        if (!res.ok) await rejectWith(res, 'MISSION_RECONCILE_FAILED');
        const body = (await res.json()) as { data: MissionReconcileReport };
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
