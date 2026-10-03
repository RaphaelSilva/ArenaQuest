import type { Mission, MissionProgress, MissionRequirement } from '../domain/mission';
import type { RequirementInput, RequirementKind } from '../domain/missions/requirements';

/** Mission fields a caller provides on create; `mode` / `enrollmentMode` default to `parallel` / `auto`. */
export type MissionCreateInput = Omit<Mission, 'id' | 'createdAt' | 'updatedAt' | 'mode' | 'enrollmentMode'> &
  Partial<Pick<Mission, 'mode' | 'enrollmentMode'>>;

/** Who is covered by an `assigned` mission: direct users and members of the groups. */
export interface MissionAudience {
  groupIds: string[];
  userIds: string[];
}

/** A requirement whose target matches a signal, with its (active, in-window) mission. */
export interface MissionCandidate {
  requirement: MissionRequirement;
  mission: Mission;
}

export interface IMissionRepository {
  findById(id: string): Promise<Mission | null>;
  /** Creates a mission without requirements (legacy M7 shape). */
  create(mission: MissionCreateInput): Promise<Mission>;
  update(id: string, mission: Partial<Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Mission>;
  listAll(): Promise<Mission[]>;
  listActiveMissions(nowIso: string): Promise<Mission[]>;
  findProgress(userId: string, missionId: string): Promise<MissionProgress | null>;
  upsertProgress(userId: string, missionId: string, increment: number, target: number): Promise<MissionProgress>;
  markCompleted(userId: string, missionId: string): Promise<MissionProgress>;
  countCompletedMissions(userId: string): Promise<number>;

  /**
   * Creates a mission and its ordered requirements atomically; positions follow the
   * array order starting at 1. The mission is stored as a requirements mission
   * (`predicateKind = 'requirements'`, `predicateParams = '{}'`) whatever the input holds.
   */
  createWithRequirements(
    input: MissionCreateInput,
    requirements: RequirementInput[],
  ): Promise<{ mission: Mission; requirements: MissionRequirement[] }>;
  /** The mission's requirements ordered by position (empty for a legacy mission). */
  listRequirements(missionId: string): Promise<MissionRequirement[]>;
  /** Replaces every requirement of the mission atomically; positions follow the array order. */
  replaceRequirements(missionId: string, requirements: RequirementInput[]): Promise<MissionRequirement[]>;
  /**
   * Renames one requirement in place, keeping its id (and so its progress rows).
   * Null when `requirementId` is not a requirement of `missionId`.
   */
  updateRequirementTitle(missionId: string, requirementId: string, title: string): Promise<MissionRequirement | null>;
  /**
   * Requirements of `target.kind` on `target.topicId` / `target.eventId`, restricted to
   * active missions whose window contains `nowIso`.
   */
  findCandidateRequirements(
    target: { kind: RequirementKind; topicId?: string; eventId?: string },
    nowIso: string,
  ): Promise<MissionCandidate[]>;
  /** Group and user grants of the mission (empty lists when none). */
  getAudience(missionId: string): Promise<MissionAudience>;
  /** Replaces the mission's group and user grants (replace-all). */
  replaceAudience(missionId: string, audience: MissionAudience): Promise<void>;
  /** Active, in-window missions still on a legacy M7 predicate (`predicateKind <> 'requirements'`). */
  listActiveLegacyMissions(nowIso: string): Promise<Mission[]>;
  /** Active, in-window missions defined by requirements (`predicateKind = 'requirements'`). */
  listActiveRequirementMissions(nowIso: string): Promise<Mission[]>;
}
