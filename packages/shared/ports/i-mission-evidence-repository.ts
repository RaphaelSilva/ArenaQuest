import type { Mission, MissionRequirement } from '../domain/mission';

/** Qualifying evidence of one user for one requirement. */
export interface EvidenceCount {
  userId: string;
  /** Qualifying items inside the step's open interval. */
  count: number;
  /** Instant of the `targetCountOf(requirement)`-th qualifying item, or null when not reached. */
  kthAt: string | null;
}

/**
 * Set-based evidence counting over the source records (RFC 0022 §3.3–§3.4): one
 * statement per requirement, shared by the hook (one user) and the reconciliation
 * (every enrollment).
 */
export interface IMissionEvidenceRepository {
  /**
   * Counts qualifying items per active enrollment of `mission` (`userId: null`) or for one
   * user. An item counts when its instant lies between the step's opening — the later of
   * `mission.startAt` and the enrollment's `countsFrom`, or the `completedAt` of
   * `previousRequirementId` in sequential mode (users whose previous step is incomplete are
   * omitted) — and the earlier of `mission.endAt` and `nowIso`. `sharingEnabled` gates
   * `shared_only` submission requirements.
   */
  countForRequirement(args: {
    mission: Pick<Mission, 'id' | 'startAt' | 'endAt' | 'mode'>;
    requirement: MissionRequirement;
    previousRequirementId: string | null;
    userId: string | null;
    nowIso: string;
    sharingEnabled: boolean;
  }): Promise<EvidenceCount[]>;
}
