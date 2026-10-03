import { targetCountOf } from '@arenaquest/shared/domain/missions/requirements';
import type {
  MissionMode,
  MissionParticipantStep,
  MissionRequirement,
} from '@web/lib/admin-gamification-api';

/** What a step chip shows. Derived from the payload, never recomputed from evidence. */
export type StepChipState =
  | { kind: 'locked' }
  | { kind: 'open'; current: number; required: number }
  | { kind: 'completed'; completedAt: string; completedBy: MissionParticipantStep['completedBy'] };

export type StepChipModel = {
  requirementId: string;
  /** 1-based position, as stored. */
  position: number;
  title: string;
  state: StepChipState;
};

/**
 * One chip per requirement, in position order:
 * - **completed** when the step's progress row carries `completedAt`;
 * - **open** `currentCount/targetCount` when a progress row exists without `completedAt`;
 * - **locked** when there is no row, the mission is sequential and an earlier step is not completed;
 * - otherwise **open** `0/<target of the requirement>` (a step the API has not evaluated yet).
 */
export function deriveStepChips(
  requirements: MissionRequirement[],
  steps: MissionParticipantStep[],
  mode: MissionMode,
): StepChipModel[] {
  const rowOf = new Map(steps.map((s) => [s.requirementId, s]));
  const ordered = requirements.slice().sort((a, b) => a.position - b.position);
  let earlierIncomplete = false;

  return ordered.map((requirement) => {
    const row = rowOf.get(requirement.id);
    let state: StepChipState;
    if (row?.completedAt) {
      state = { kind: 'completed', completedAt: row.completedAt, completedBy: row.completedBy };
    } else if (row) {
      state = { kind: 'open', current: row.currentCount, required: row.targetCount };
    } else if (mode === 'sequential' && earlierIncomplete) {
      state = { kind: 'locked' };
    } else {
      state = { kind: 'open', current: 0, required: targetCountOf(requirement) };
    }
    if (state.kind !== 'completed') earlierIncomplete = true;
    return { requirementId: requirement.id, position: requirement.position, title: requirement.title, state };
  });
}

/**
 * The calendar day of an API timestamp (`2026-10-01 12:00:00` or an ISO string), as
 * `YYYY-MM-DD`. Locale-agnostic on purpose: the i18n spec defers `Intl` formatting.
 */
export function dayOf(value: string): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : value;
}
