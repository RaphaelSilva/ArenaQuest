import type { EvidenceCount, IMissionEvidenceRepository } from '@arenaquest/shared/ports/i-mission-evidence-repository';
import type { Mission, MissionRequirement } from '@arenaquest/shared/domain/mission';
import { parseRequirementParams, targetCountOf } from '@arenaquest/shared/domain/missions/requirements';

/**
 * Set-based evidence counting (RFC 0022 §3.3–§3.4): one statement per requirement,
 * written for a set of users so the hook (one user) and the reconciliation (every
 * active enrollment) share it. The statement is a `scope` CTE (who is counted and
 * from which instant), a per-kind `ev` CTE (qualifying items numbered per user in
 * instant order) and a final aggregation returning the count and the instant of the
 * target-th item for every scoped user.
 *
 * Instants: `missions` stores ISO-8601 strings and the evidence tables store
 * SQLite's `datetime('now')` form, so every comparison wraps both sides in
 * `datetime()` and the instants returned are SQLite strings.
 *
 * Parameters are numbered (`?N`). The common ones are:
 *   ?1 mission id · ?2 mission start_at · ?3 previous requirement id (or NULL)
 *   ?4 user id (or NULL for every active enrollment) · ?5 mission end_at · ?6 now
 *   ?7 target count
 * and each kind's `ev` source appends its own from ?8 on.
 */

/**
 * Users counted for this requirement and the instant their step opened: the later of
 * the mission start and the enrollment's counts_from, or — in sequential mode — the
 * previous step's completion, in which case a user whose previous step is incomplete
 * is not in scope at all (the step is locked).
 */
const SCOPE_CTE = `
  scope AS (
    SELECT e.user_id,
           CASE WHEN ?3 IS NULL
                THEN MAX(datetime(?2), datetime(e.counts_from))
                ELSE datetime(prev.completed_at) END AS opens_at
      FROM mission_enrollments e
      LEFT JOIN mission_requirement_progress prev
             ON prev.requirement_id = ?3 AND prev.user_id = e.user_id
     WHERE e.mission_id = ?1
       AND e.left_at IS NULL
       AND (?4 IS NULL OR e.user_id = ?4)
       AND (?3 IS NULL OR prev.completed_at IS NOT NULL)
  )`;

/** The interval's upper bound: the earlier of the mission end and now. */
const CLOSES_AT = 'MIN(datetime(?5), datetime(?6))';

/** Builds the per-kind `ev` CTE and the parameters it appends after the common ones. */
function evidenceSource(
  requirement: MissionRequirement,
  sharingEnabled: boolean,
): { sql: string; params: (string | number)[] } {
  switch (requirement.kind) {
    case 'submissions_on_topic': {
      const params = parseRequirementParams('submissions_on_topic', requirement.params);
      // created_at is the evidence instant (the table has no ready_at): editing or
      // moving a submission later does not re-date it.
      return {
        sql: `
  ev AS (
    SELECT s.author_id AS user_id, datetime(s.created_at) AS at,
           ROW_NUMBER() OVER (PARTITION BY s.author_id ORDER BY datetime(s.created_at), s.id) AS n
      FROM topic_submissions s
      JOIN scope ON scope.user_id = s.author_id
     WHERE s.topic_node_id = ?8
       AND s.status = 'ready'
       AND datetime(s.created_at) >= scope.opens_at
       AND datetime(s.created_at) <= ${CLOSES_AT}
       AND (?9 = 0 OR TRIM(s.description) <> '')
       AND (?10 = 0 OR (s.visibility = 'shared' AND ?11 = 1))
       AND (?12 = 1 OR s.moderated_at IS NULL)
  )`,
        params: [
          requirement.topicId ?? '',
          params.requireDescription ? 1 : 0,
          params.visibility === 'shared_only' ? 1 : 0,
          sharingEnabled ? 1 : 0,
          params.countModerated ? 1 : 0,
        ],
      };
    }

    case 'topic_visited':
      // One captured row per (requirement, user, topic): the first visit that could count.
      return {
        sql: `
  ev AS (
    SELECT x.user_id, datetime(x.occurred_at) AS at,
           ROW_NUMBER() OVER (PARTITION BY x.user_id ORDER BY datetime(x.occurred_at), x.ref_id) AS n
      FROM mission_evidence x
      JOIN scope ON scope.user_id = x.user_id
     WHERE x.requirement_id = ?8
       AND x.ref_id = ?9
       AND datetime(x.occurred_at) >= scope.opens_at
       AND datetime(x.occurred_at) <= ${CLOSES_AT}
  )`,
        params: [requirement.id, requirement.topicId ?? ''],
      };

    case 'video_watched':
      // Distinct videos by the evidence primary key; only ready video media still on
      // the target topic count.
      return {
        sql: `
  ev AS (
    SELECT x.user_id, datetime(x.occurred_at) AS at,
           ROW_NUMBER() OVER (PARTITION BY x.user_id ORDER BY datetime(x.occurred_at), x.ref_id) AS n
      FROM mission_evidence x
      JOIN scope ON scope.user_id = x.user_id
      JOIN media md ON md.id = x.ref_id
     WHERE x.requirement_id = ?8
       AND md.topic_node_id = ?9
       AND md.status = 'ready'
       AND md.type LIKE 'video/%'
       AND datetime(x.occurred_at) >= scope.opens_at
       AND datetime(x.occurred_at) <= ${CLOSES_AT}
  )`,
        params: [requirement.id, requirement.topicId ?? ''],
      };

    case 'event_participation':
      // A paid charge qualifies at the event's start, which must lie in the interval —
      // so paying early never disqualifies and a future event does not count yet.
      return {
        sql: `
  ev AS (
    SELECT c.user_id, datetime(v.starts_at) AS at,
           ROW_NUMBER() OVER (PARTITION BY c.user_id ORDER BY datetime(v.starts_at), c.id) AS n
      FROM event_charges c
      JOIN events v ON v.id = c.event_id
      JOIN scope ON scope.user_id = c.user_id
     WHERE c.event_id = ?8
       AND c.status = 'paid'
       AND datetime(v.starts_at) >= scope.opens_at
       AND datetime(v.starts_at) <= ${CLOSES_AT}
  )`,
        params: [requirement.eventId ?? ''],
      };

    case 'manual_check':
      // The student's tick on the step's own progress row.
      return {
        sql: `
  ev AS (
    SELECT p.user_id, datetime(p.checked_at) AS at,
           ROW_NUMBER() OVER (PARTITION BY p.user_id ORDER BY datetime(p.checked_at)) AS n
      FROM mission_requirement_progress p
      JOIN scope ON scope.user_id = p.user_id
     WHERE p.requirement_id = ?8
       AND p.checked_at IS NOT NULL
       AND datetime(p.checked_at) >= scope.opens_at
       AND datetime(p.checked_at) <= ${CLOSES_AT}
  )`,
        params: [requirement.id],
      };
  }
}

type CountRow = { user_id: string; qualifying: number; kth_at: string | null };

export class D1MissionEvidenceRepository implements IMissionEvidenceRepository {
  constructor(private readonly db: D1Database) {}

  async countForRequirement(args: {
    mission: Pick<Mission, 'id' | 'startAt' | 'endAt' | 'mode'>;
    requirement: MissionRequirement;
    previousRequirementId: string | null;
    userId: string | null;
    nowIso: string;
    sharingEnabled: boolean;
  }): Promise<EvidenceCount[]> {
    const { mission, requirement } = args;
    const source = evidenceSource(requirement, args.sharingEnabled);
    const common: (string | number | null)[] = [
      mission.id,
      mission.startAt,
      args.previousRequirementId,
      args.userId,
      mission.endAt,
      args.nowIso,
      targetCountOf(requirement),
    ];

    const { results } = await this.db
      .prepare(
        `WITH ${SCOPE_CTE},${source.sql}
         SELECT scope.user_id AS user_id,
                COUNT(ev.at) AS qualifying,
                MAX(CASE WHEN ev.n = ?7 THEN ev.at END) AS kth_at
           FROM scope
           LEFT JOIN ev ON ev.user_id = scope.user_id
          GROUP BY scope.user_id
          ORDER BY scope.user_id`,
      )
      .bind(...common, ...source.params)
      .all<CountRow>();

    return results.map((row) => ({ userId: row.user_id, count: row.qualifying, kthAt: row.kth_at ?? null }));
  }
}
