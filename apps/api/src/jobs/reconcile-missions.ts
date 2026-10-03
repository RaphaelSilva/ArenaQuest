import type { IMissionParticipationRepository, IMissionRepository } from '@arenaquest/shared/ports';
import type { Mission } from '@arenaquest/shared/domain/mission';
import { REQUIREMENTS_PREDICATE_KIND } from '@arenaquest/shared/domain/missions/requirements';
import { instantMs, type MissionEvaluator } from '@arenaquest/shared/domain/gamification/mission-evaluator';

/** A mission stays in the daily scope this long after its `endAt` (RFC 0022 §4 step 1). */
export const RECONCILE_GRACE_HOURS = 48;

const HOUR_MS = 3_600_000;

export interface ReconcileMissionsDeps {
  missions: IMissionRepository;
  participation: IMissionParticipationRepository;
  /** The container's evaluator; when absent, steps 2–3 still run and nothing is evaluated. */
  evaluator: MissionEvaluator | undefined;
  now?: () => Date;
}

export interface ReconcileRunReport {
  /** Missions reconciled (failed ones included). */
  missions: number;
  /** Implicit enrollments materialised by this run. */
  enrollmentsCreated: number;
  /** Evidence rows captured with `source = 'backfill'`. */
  evidenceBackfilled: number;
  /** Active enrollments evaluated. */
  enrollmentsEvaluated: number;
  /** Steps this run completed (`completed_by = 'reconcile'`). */
  stepsClosed: number;
  /** Missions this run completed. */
  missionsClosed: number;
  /** Missions whose reconciliation threw; the others still ran. */
  failed: number;
}

const emptyReport = (): ReconcileRunReport => ({
  missions: 0,
  enrollmentsCreated: 0,
  evidenceBackfilled: 0,
  enrollmentsEvaluated: 0,
  stepsClosed: 0,
  missionsClosed: 0,
  failed: 0,
});

/**
 * Daily scope (RFC 0022 §4 step 1): active requirements missions that have started
 * and ended no more than 48 h ago, so a hook that failed in a mission's last hours
 * is still repaired by the next run.
 */
export function isInReconcileScope(mission: Mission, now: Date): boolean {
  const nowMs = now.getTime();
  return (
    mission.active &&
    mission.predicateKind === REQUIREMENTS_PREDICATE_KIND &&
    instantMs(mission.startAt) <= nowMs &&
    instantMs(mission.endAt) >= nowMs - RECONCILE_GRACE_HOURS * HOUR_MS
  );
}

/**
 * Steps 2–5 of RFC 0022 §4 for one mission: materialise the implicit enrollments
 * (one statement), backfill the captured evidence the sources still prove (one
 * statement per `video_watched` / `topic_visited` requirement), then recompute every
 * requirement in position order for all active enrollments through the evaluator,
 * which counts set-based (one evidence query per requirement) and writes only rows
 * that change. Monotonic by construction: every write it reaches is write-once or
 * `ON CONFLICT DO NOTHING`, and the `reconcile` origin records no streak activity.
 */
async function reconcileMissionRow(
  deps: ReconcileMissionsDeps,
  mission: Mission,
  now: Date,
  report: ReconcileRunReport,
): Promise<void> {
  const requirements = await deps.missions.listRequirements(mission.id);
  if (requirements.length === 0) return;

  // The hook path's policy gate: an implicit enrollment exists only once the mission is live.
  if (mission.active && instantMs(mission.startAt) <= now.getTime()) {
    const topicTargets = [
      ...new Set(requirements.map((r) => r.topicId).filter((id): id is string => id !== null)),
    ];
    report.enrollmentsCreated += await deps.participation.materializeImplicitEnrollments(mission, topicTargets);
  }

  for (const requirement of requirements) {
    if (requirement.kind !== 'video_watched' && requirement.kind !== 'topic_visited') continue;
    report.evidenceBackfilled += await deps.participation.backfillEvidence(mission, requirement);
  }

  if (!deps.evaluator) return;
  const stats = await deps.evaluator.reconcileMission(mission.id, now);
  report.enrollmentsEvaluated += stats.enrollmentsEvaluated;
  report.stepsClosed += stats.stepsCompleted;
  report.missionsClosed += stats.missionsCompleted;
}

/** Runs one mission into `report`, turning a thrown error into `failed++`. */
async function reconcileGuarded(
  deps: ReconcileMissionsDeps,
  mission: Mission,
  now: Date,
  report: ReconcileRunReport,
): Promise<void> {
  report.missions++;
  try {
    await reconcileMissionRow(deps, mission, now, report);
  } catch {
    report.failed++;
  }
}

/** One JSON line with counts only — never a user id, a title or a name. */
function logRun(trigger: 'scheduled' | 'admin', report: ReconcileRunReport, now: Date): void {
  const line = JSON.stringify({ event: 'missions.reconcile', trigger, ...report, at: now.toISOString() });
  if (report.failed > 0) console.error(line);
  else console.log(line);
}

/**
 * The daily reconciliation (RFC 0022 §4; M27 Task 08), called from `scheduled()`
 * after the submission sweep. A failing mission is counted and skipped; the run
 * never throws, so it can affect neither billing nor the sweep.
 */
export async function reconcileMissions(deps: ReconcileMissionsDeps): Promise<ReconcileRunReport> {
  const now = deps.now?.() ?? new Date();
  const report = emptyReport();
  try {
    const missions = (await deps.missions.listAll()).filter((mission) => isInReconcileScope(mission, now));
    for (const mission of missions) {
      await reconcileGuarded(deps, mission, now, report);
    }
  } catch {
    report.failed++;
  }
  logRun('scheduled', report, now);
  return report;
}

/**
 * The same routine for one mission, on demand (`POST /v1/admin/missions/{id}/reconcile`).
 * Null when the mission does not exist or is a legacy predicate mission. The daily
 * scope's window is not applied: an admin may reconcile any requirements mission.
 */
export async function reconcileOneMission(
  deps: ReconcileMissionsDeps,
  missionId: string,
  now: Date,
): Promise<ReconcileRunReport | null> {
  const mission = await deps.missions.findById(missionId);
  if (!mission || mission.predicateKind !== REQUIREMENTS_PREDICATE_KIND) return null;
  const report = emptyReport();
  await reconcileGuarded(deps, mission, now, report);
  logRun('admin', report, now);
  return report;
}
