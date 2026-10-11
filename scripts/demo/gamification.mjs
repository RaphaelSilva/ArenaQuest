/**
 * gamification.mjs — the demo's minimal gamification state (RFC 0021 §3.4).
 *
 * No rule changes: the seed writes a state the running engine would itself
 * have produced, so an action the tester repeats in the app is not rewarded
 * twice and a new one is. Pure except {@link readGamificationReference}, which
 * reads the files that own the rules.
 *
 *   buildGamification(dataset, ctx)   → { rows, totals }   (every row, as data)
 *   xpConsistencyQuery(userIds)       read-only SQL for the post-run check
 *   checkXpConsistency(rows, userIds) → problems[] (user_xp vs ledger sum)
 *
 * Engine parity (checked by gamification.test.mjs against the engine source,
 * never assumed):
 *   - idempotency key `<sourceKind>:<sourceId>:v1`   xp-engine.ts
 *   - topic completion: source_kind `topic`          routes/me/progress.ts
 *   - badge reward:     source_kind `badge_award`    badge-engine.ts
 *   - admin grant:      source_kind `admin_adjustment`, source_id = admin id
 *                                                    admin-progression.controller.ts
 *   - weekly period key `YYYY-Wnn` (ISO week, UTC)   quest-evaluator.ts
 *   - timestamps `YYYY-MM-DD HH:MM:SS` (`datetime('now')`), missions ISO-8601
 *
 * Amounts are never literals here: topic XP from xp-config.ts, badge ids,
 * rewards and rules from migration 0021, quest targets from migration 0019.
 *
 * Missions (RFC 0022, migration 0031) are written the way the admin API writes
 * one (admin-missions.controller.ts, d1-mission-repository.ts), never as a
 * legacy M7 predicate:
 *   - missions.predicate_kind      `requirements` (REQUIREMENTS_PREDICATE_KIND),
 *     predicate_params `{}`, mode / enrollment_mode from the dataset;
 *   - one mission_requirements row per step: position = list order (1-based),
 *     kind, title (trimmed), topic_node_id / event_id from the dataset keys,
 *     params = the kind's params with the schema defaults applied
 *     (normalizeRequirementParams, dataset.mjs), xp_reward (default 0).
 * A requirement row's id is derived from `<missionKey>#<position>`, the same
 * key as the table's UNIQUE (mission_id, position), so the id and the conflict
 * target always agree (see sql.mjs). No enrollment or progress is seeded: the
 * evaluator creates them when a demo student acts.
 *
 * Fixed point: the badge engine runs on every login, so a student seeded with
 * a badge still due (e.g. 950 XP without `levantador-bronze`, min 500) would
 * be awarded it — and its XP — the moment they log in. The builder refuses
 * such a dataset ({@link badgesDue}).
 *
 * Convergence (see sql.mjs): every row is keyed by the table's own unique key,
 * so a row the app already wrote for the same fact (same user + topic, same
 * user + badge, same idempotency key) is reused, never duplicated. Dates are
 * recomputed from `ctx.now` on every run so the demo never ages. Two tables
 * are special:
 *   - `user_xp.total_xp` is written as the ledger sum computed IN SQL, so a
 *     re-run after in-app play keeps it equal to `SUM(xp_events.points)`;
 *   - `quest_progress` is insert-only: progress the tester made this period
 *     is never reset under a reward the ledger already holds.
 * Demo users carry the default `UTC` timezone, so "yesterday" is a UTC date.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Functions only (hoisted), so the sql.mjs ↔ gamification.mjs import cycle is safe.
import { sqlValue } from './sql.mjs';
import { normalizeRequirementParams, readMissionVocabulary } from './dataset.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/demo/..)

/** The `version` the engine appends to every idempotency key it writes. */
export const XP_KEY_VERSION = 'v1';
/** `source_kind` values, as the engine writes them (verified by the tests). */
export const SOURCE_KIND = Object.freeze({
  topic: 'topic',
  badge: 'badge_award',
  adminAdjustment: 'admin_adjustment',
});

/** `missions.predicate_kind` of a mission defined by requirements (requirements.ts, verified by the tests). */
export const REQUIREMENTS_PREDICATE_KIND = 'requirements';

const DAY_MS = 86_400_000;

// ════════════════════════════════════════════════════════════════════════════
// Reference (the files that own the rules)
// ════════════════════════════════════════════════════════════════════════════

/**
 * `{ topicCompleteXp, badges: { slug: { id, xpReward, ruleKind, ruleParams } }, quests: { id: { kind, target } }, requirementLimits }`.
 * A quest's target is its `predicate_params.count`; `requirementLimits` are the
 * mission step limits of requirements.ts.
 */
export function readGamificationReference(repoRoot = ROOT) {
  const read = (relPath) => readFileSync(join(repoRoot, relPath), 'utf8');

  const topicCompleteXp = Number(read('packages/shared/domain/gamification/xp-config.ts').match(/topic_complete:\s*(\d+)/)?.[1]);

  const badges = {};
  for (const m of read('apps/api/migrations/0021_seed_badges.sql').matchAll(
    /\('(badge-[a-z0-9-]+)',\s*'([a-z0-9-]+)',\s*'(?:[^']|'')*',\s*'[^']*',\s*'(?:[^']|'')*',\s*(\d+),\s*'([a-z_]+)',\s*'(\{[^']*\})'\)/g,
  )) {
    badges[m[2]] = { id: m[1], xpReward: Number(m[3]), ruleKind: m[4], ruleParams: JSON.parse(m[5]) };
  }

  const quests = {};
  for (const m of read('apps/api/migrations/0019_seed_quests.sql').matchAll(
    /^\('([a-z0-9-]+)',\s*'(daily|weekly)',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*'[a-z_]+',\s*'(\{[^']*\})'/gm,
  )) {
    quests[m[1]] = { kind: m[2], target: Number(JSON.parse(m[3]).count ?? 1) };
  }

  if (!Number.isFinite(topicCompleteXp)) throw new Error('gamification: could not read topic_complete XP from xp-config.ts');
  if (Object.keys(badges).length === 0) throw new Error('gamification: could not read the badges of migration 0021');
  if (Object.keys(quests).length === 0) throw new Error('gamification: could not read the quests of migration 0019');
  const { requirementLimits } = readMissionVocabulary(read('packages/shared/domain/missions/requirements.ts'));
  return { topicCompleteXp, badges, quests, requirementLimits };
}

// ════════════════════════════════════════════════════════════════════════════
// Keys & dates
// ════════════════════════════════════════════════════════════════════════════

/** The engine's idempotency key: `<sourceKind>:<sourceId>:v1`. */
export function xpIdempotencyKey(sourceKind, sourceId, version = XP_KEY_VERSION) {
  return `${sourceKind}:${sourceId ?? 'none'}:${version}`;
}

/** ISO-8601 week of `date` (UTC) as `YYYY-Wnn` — the weekly quest period key. */
export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week owns it
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The quest period key of `kind` at `now`: `YYYY-MM-DD` (daily) or `YYYY-Wnn` (weekly). */
export function questPeriodKey(kind, now) {
  if (kind === 'daily') return utcDate(now);
  if (kind === 'weekly') return isoWeekKey(now);
  throw new Error(`gamification: unknown quest kind "${kind}"`);
}

/** `YYYY-MM-DD` of `date` in UTC. */
export function utcDate(date) {
  return date.toISOString().slice(0, 10);
}

/** SQLite `datetime('now')` format: `YYYY-MM-DD HH:MM:SS` (UTC). */
export function sqliteDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Noon UTC, `daysAgo` days before `now`'s UTC date. */
function noonDaysAgo(now, daysAgo) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, 12));
}

const plusMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000);

// ════════════════════════════════════════════════════════════════════════════
// Badge rules
// ════════════════════════════════════════════════════════════════════════════

/** The badge rule kinds {@link badgesDue} evaluates — every `case` of badge-engine.ts (tested). */
export const BADGE_RULE_KINDS = ['streak_days', 'topic_completed', 'videos_watched_in_period', 'total_xp', 'mission_completed'];

/**
 * Slugs of the badges the engine would award a student in `stats` who does not
 * hold them yet — the same thresholds as BadgeEngine.evaluate. The engine runs
 * on every login and completion, so a seeded state that leaves a badge due is
 * not a state the engine could have produced: the first login would award it
 * (and its XP) behind the tester's back.
 *
 * `stats`: `{ totalXp, completedTopics, streakDays, completedMissions, videosThisWeek, held: slug[] }`.
 */
export function badgesDue(stats, reference) {
  const held = new Set(stats.held ?? []);
  const due = [];
  for (const [slug, badge] of Object.entries(reference.badges)) {
    if (held.has(slug)) continue;
    const rule = badge.ruleParams ?? {};
    let met;
    switch (badge.ruleKind) {
      case 'streak_days':
        met = stats.streakDays >= (rule.days ?? 0);
        break;
      case 'topic_completed':
        met = stats.completedTopics >= (rule.count ?? 1);
        break;
      case 'videos_watched_in_period':
        met = (stats.videosThisWeek ?? 0) >= (rule.count ?? 1);
        break;
      case 'total_xp':
        met = stats.totalXp >= (rule.min_xp ?? 0);
        break;
      case 'mission_completed':
        met = (stats.completedMissions ?? 0) >= (rule.count ?? 1);
        break;
      default:
        throw new Error(`gamification: badge "${slug}" has rule kind "${badge.ruleKind}" the seed does not know`);
    }
    if (met) due.push(slug);
  }
  return due;
}

// ════════════════════════════════════════════════════════════════════════════
// Builder
// ════════════════════════════════════════════════════════════════════════════

function requireNow(ctx) {
  if (!(ctx.now instanceof Date) || Number.isNaN(ctx.now.getTime())) {
    throw new TypeError('gamification: ctx.now (a valid Date) is required — the seed dates are relative to it');
  }
  return ctx.now;
}

/**
 * Every gamification row of the demo, as plain data, plus the XP total each
 * student's ledger sums to (`totals: { userKey: xp }`, every listed student).
 *
 * Timeline (all relative to `ctx.now`): a student's N completions land at noon
 * UTC on the N days ending yesterday, oldest first; each badge is earned one
 * minute after the last completion; an admin adjustment one hour after it.
 */
export function buildGamification(dataset, ctx) {
  const now = requireNow(ctx);
  const reference = ctx.gamification;
  if (!reference) throw new TypeError('gamification: ctx.gamification (readGamificationReference()) is required');

  const rows = {
    topic_progress: [],
    xp_events: [],
    user_badges: [],
    user_xp: [],
    user_streak: [],
    quest_progress: [],
    missions: [],
    mission_requirements: [],
  };
  const totals = {};
  const adminId = ctx.id('user', 'admin');

  for (const state of dataset.gamification.students) {
    const userId = ctx.id('user', state.user);
    const events = [];
    const event = (sourceKind, sourceId, points, earnedAt) => {
      const idempotencyKey = xpIdempotencyKey(sourceKind, sourceId);
      events.push({
        id: ctx.id('xp-event', `${state.user}:${idempotencyKey}`),
        user_id: userId,
        source_kind: sourceKind,
        source_id: sourceId,
        points,
        idempotency_key: idempotencyKey,
        earned_at: sqliteDateTime(earnedAt),
      });
    };

    const completed = state.completedTopics ?? [];
    let last = noonDaysAgo(now, 1);
    completed.forEach((topicKey, index) => {
      const at = noonDaysAgo(now, completed.length - index);
      last = at;
      const topicId = ctx.id('topic', topicKey);
      rows.topic_progress.push({
        id: ctx.id('topic-progress', `${state.user}@${topicKey}`),
        user_id: userId,
        topic_node_id: topicId,
        status: 'completed',
        completed_at: sqliteDateTime(at),
      });
      event(SOURCE_KIND.topic, topicId, reference.topicCompleteXp, at);
    });

    for (const slug of state.badges ?? []) {
      const badge = reference.badges[slug];
      if (!badge) throw new Error(`gamification: unknown badge "${slug}"`);
      const earnedAt = plusMinutes(last, 1);
      rows.user_badges.push({
        id: ctx.id('user-badge', `${state.user}@${slug}`),
        user_id: userId,
        badge_id: badge.id,
        earned_at: sqliteDateTime(earnedAt),
      });
      if (badge.xpReward > 0) event(SOURCE_KIND.badge, badge.id, badge.xpReward, earnedAt);
    }

    (state.adminAdjustments ?? []).forEach((points, index) => {
      // The controller keys an adjustment by a random UUID; the seed's must be
      // stable, so it is a demo id in the engine's `<kind>:<sourceId>:v1` shape.
      const adjustmentId = ctx.id('xp-adjustment', `${state.user}#${index}`);
      const idempotencyKey = xpIdempotencyKey(SOURCE_KIND.adminAdjustment, adjustmentId);
      events.push({
        id: ctx.id('xp-event', `${state.user}:${idempotencyKey}`),
        user_id: userId,
        source_kind: SOURCE_KIND.adminAdjustment,
        source_id: adminId,
        points,
        idempotency_key: idempotencyKey,
        earned_at: sqliteDateTime(plusMinutes(last, 60)),
      });
    });

    rows.xp_events.push(...events);
    const total = Math.max(0, events.reduce((sum, row) => sum + row.points, 0));
    totals[state.user] = total;

    const due = badgesDue(
      { totalXp: total, completedTopics: completed.length, streakDays: state.streakDays, held: state.badges ?? [] },
      reference,
    );
    if (due.length > 0) {
      throw new Error(
        `gamification: ${state.user} (${total} XP, ${completed.length} topics, ${state.streakDays}-day streak) is due badge(s) ` +
          `${due.join(', ')} under the current rules — list them in the dataset, or the first login would award them`,
      );
    }
    if (events.length > 0) rows.user_xp.push({ user_id: userId, total_xp: total });

    if (state.streakDays > 0) {
      rows.user_streak.push({
        user_id: userId,
        current_streak: state.streakDays,
        longest_streak: state.streakDays,
        last_activity_date: utcDate(noonDaysAgo(now, 1)),
      });
    }

    for (const quest of state.quests ?? []) {
      const definition = reference.quests[quest.slug];
      if (!definition) throw new Error(`gamification: unknown quest "${quest.slug}"`);
      const done = quest.current >= definition.target;
      rows.quest_progress.push({
        user_id: userId,
        quest_id: quest.slug,
        period_key: questPeriodKey(definition.kind, now),
        current_value: quest.current,
        target_value: definition.target,
        completed: done ? 1 : 0,
        completed_at: done ? sqliteDateTime(now) : null,
      });
    }
  }

  for (const mission of dataset.gamification.missions) {
    const badge = mission.badge == null ? null : reference.badges[mission.badge];
    if (mission.badge != null && !badge) throw new Error(`gamification: unknown badge "${mission.badge}"`);
    const missionId = ctx.id('mission', mission.key);
    rows.missions.push({
      id: missionId,
      title: mission.title,
      description: mission.description ?? '',
      start_at: now.toISOString(),
      end_at: new Date(now.getTime() + mission.activeDays * DAY_MS).toISOString(),
      predicate_kind: REQUIREMENTS_PREDICATE_KIND,
      predicate_params: '{}',
      xp_reward: mission.xpReward,
      badge_id: badge?.id ?? null,
      active: 1,
      mode: mission.mode,
      enrollment_mode: mission.enrollmentMode,
    });

    (mission.requirements ?? []).forEach((step, index) => {
      const position = index + 1;
      const { params, problems } = normalizeRequirementParams(step.kind, step.params, reference.requirementLimits);
      if (!params) throw new Error(`gamification: mission "${mission.key}" requirement "${step.key}": ${problems.join('; ')}`);
      rows.mission_requirements.push({
        id: ctx.id('mission-requirement', `${mission.key}#${position}`),
        mission_id: missionId,
        position,
        kind: step.kind,
        title: step.title.trim(),
        topic_node_id: step.topic == null ? null : ctx.id('topic', step.topic),
        event_id: step.event == null ? null : ctx.id('event', step.event),
        params: JSON.stringify(params),
        xp_reward: step.xpReward ?? 0,
      });
    });
  }

  return { rows, totals };
}

/** `MAX(0, SUM(points))` of `userId`'s ledger — the engine's recompute rule. */
export function ledgerSumExpression(userId) {
  return `(SELECT MAX(0, COALESCE(SUM(points), 0)) FROM xp_events WHERE user_id = ${sqlValue(userId)})`;
}

// ════════════════════════════════════════════════════════════════════════════
// Post-run assertion
// ════════════════════════════════════════════════════════════════════════════

/** Read-only: `user_id`, `total_xp` (the read model, 0 when absent) and `ledger_xp` per user. */
export function xpConsistencyQuery(userIds) {
  if (userIds.length === 0) throw new Error('xpConsistencyQuery: no users');
  return [
    'SELECT u.id AS user_id,',
    'COALESCE(x.total_xp, 0) AS total_xp,',
    '(SELECT MAX(0, COALESCE(SUM(e.points), 0)) FROM xp_events e WHERE e.user_id = u.id) AS ledger_xp',
    'FROM users u LEFT JOIN user_xp x ON x.user_id = u.id',
    `WHERE u.id IN (${userIds.map(sqlValue).join(', ')})`,
  ].join(' ');
}

/**
 * Problems found in the rows of {@link xpConsistencyQuery}: a user missing
 * from the database, or a `user_xp.total_xp` that differs from its ledger sum.
 * `names` maps an id to a readable key for the message.
 */
export function checkXpConsistency(rows, userIds, names = {}) {
  const byId = new Map(rows.map((row) => [row.user_id, row]));
  const problems = [];
  for (const id of userIds) {
    const name = names[id] ?? id;
    const row = byId.get(id);
    if (!row) {
      problems.push(`${name}: user not found`);
    } else if (Number(row.total_xp) !== Number(row.ledger_xp)) {
      problems.push(`${name}: user_xp.total_xp ${row.total_xp} but the xp_events ledger sums to ${row.ledger_xp}`);
    }
  }
  return problems;
}
