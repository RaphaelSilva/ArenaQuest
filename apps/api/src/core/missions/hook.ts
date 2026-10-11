import type { MissionSignal } from '@arenaquest/shared/domain/gamification/mission-evaluator';
import type { BillingContext, EngagementContext, GamificationContext } from '@api/container';

/**
 * Mission hooks (RFC 0022 §3.1–§3.2, §8; M27 Task 06).
 *
 * One `runMissionHook` call sits in each route that produces mission evidence,
 * **after** the originating write succeeded and before the response is built,
 * so a step closes in the same request that produced its last qualifying item.
 *
 * The runner is best-effort, exactly like the `questEvaluator.evaluate` calls
 * next to it: it never throws and never changes the caller's response. Any
 * failure is logged with ids only (never a description, title or file name)
 * and the daily reconciliation (Task 08) repairs what a failed hook missed.
 *
 * The evaluator records the streak activity itself when a hook closes a step,
 * so the runner does not; it only runs the badge engine (the `mission_completed`
 * rule) when the evaluation completed a mission.
 */

/**
 * What a route reports. The evaluator's own signals pass through unchanged; the
 * three extra kinds carry only what the route has in hand and are resolved here:
 *
 * - `submission_move` — the moved rows already sit on the target topic, so their
 *   source topics are no longer readable. The runner re-evaluates the target
 *   plus every `submissions_on_topic` topic of the missions the user is actively
 *   enrolled in: a move can only lower a count on a topic the user is enrolled
 *   for, so this superset covers every source topic that matters.
 * - `submission_by_id` — staff moderation and removal name only the submission;
 *   the row (or its tombstone) gives the author and the topic.
 * - `event_charge_by_id` — the ledger writes name only the charge (or carry its
 *   id); the charge gives the user and the event.
 */
export type MissionHookSignal =
  | MissionSignal
  | { kind: 'submission_move'; userId: string; targetTopicId: string }
  | { kind: 'submission_by_id'; submissionId: string }
  | { kind: 'event_charge_by_id'; chargeId: string };

/**
 * The slice of the container the runner reads. `AppContainer` and every router
 * slice that carries `gamification` satisfy it structurally; the engagement and
 * billing repositories are needed only by the signals that resolve through them.
 */
export interface MissionHookDeps {
  gamification: Pick<GamificationContext, 'missionEvaluator' | 'badgeEngine' | 'missionRepo' | 'missionParticipationRepo'>;
  engagement?: Pick<EngagementContext, 'submissionRepo'>;
  billing?: Pick<BillingContext, 'eventChargeRepo'>;
}

/** Ids of a signal, for the failure log. Never anything but ids. */
function logIds(signal: MissionHookSignal): Record<string, unknown> {
  switch (signal.kind) {
    case 'submission':
      return { userId: signal.userId, topicIds: signal.topicIds };
    case 'topic_visit':
      return { userId: signal.userId, topicId: signal.topicId };
    case 'video_watch':
      return { userId: signal.userId, topicId: signal.topicId, mediaId: signal.mediaId };
    case 'event_charge':
      return { userId: signal.userId, eventId: signal.eventId };
    case 'submission_move':
      return { userId: signal.userId, topicId: signal.targetTopicId };
    case 'submission_by_id':
      return { submissionId: signal.submissionId };
    case 'event_charge_by_id':
      return { chargeId: signal.chargeId };
  }
}

/** Turns a route signal into an evaluator signal; null when there is nothing to evaluate. */
async function resolveSignal(deps: MissionHookDeps, signal: MissionHookSignal): Promise<MissionSignal | null> {
  switch (signal.kind) {
    case 'submission_move': {
      const { missionRepo, missionParticipationRepo } = deps.gamification;
      const topicIds = new Set<string>([signal.targetTopicId]);
      const enrollments = await missionParticipationRepo.listUserEnrollments(signal.userId, { activeOnly: true });
      for (const enrollment of enrollments) {
        for (const requirement of await missionRepo.listRequirements(enrollment.missionId)) {
          if (requirement.kind === 'submissions_on_topic' && requirement.topicId) topicIds.add(requirement.topicId);
        }
      }
      return { kind: 'submission', userId: signal.userId, topicIds: [...topicIds] };
    }
    case 'submission_by_id': {
      const row = await deps.engagement?.submissionRepo.findById(signal.submissionId);
      if (!row) return null;
      return { kind: 'submission', userId: row.authorId, topicIds: [row.topicNodeId] };
    }
    case 'event_charge_by_id': {
      const charge = await deps.billing?.eventChargeRepo.getCharge(signal.chargeId);
      if (!charge) return null;
      return { kind: 'event_charge', userId: charge.userId, eventId: charge.eventId };
    }
    default:
      return signal;
  }
}

/**
 * Best-effort: evaluates the missions `signal` can affect. Never throws, never
 * changes the caller's response; logs ids only. A no-op when the container has
 * no mission evaluator.
 */
export async function runMissionHook(
  deps: MissionHookDeps,
  signal: MissionHookSignal,
  now: Date = new Date(),
): Promise<void> {
  const { missionEvaluator, badgeEngine } = deps.gamification;
  if (!missionEvaluator) return;
  try {
    const resolved = await resolveSignal(deps, signal);
    if (!resolved) return;
    const outcome = await missionEvaluator.onSignal(resolved, now);
    if (outcome.missionsCompleted.length > 0 && badgeEngine) {
      await badgeEngine.evaluate(resolved.userId, now);
    }
  } catch (err) {
    console.error('[mission] hook failed', {
      signal: signal.kind,
      ...logIds(signal),
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
}
