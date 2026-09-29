/**
 * sql.mjs — the demo dataset as idempotent SQL (RFC 0021 §3).
 *
 * Pure: dataset in, text out. No file, no wrangler, no clock, no randomness —
 * everything run-dependent (the password hash, the markdown sanitiser) arrives
 * through `ctx`, so the same dataset and ctx always yield the same SQL.
 *
 *   buildSeedSql(dataset, ctx, sections = SECTIONS)
 *       → { sql, statements, summary: [{ section, entity, rows }] }
 *
 * The output is a sequence of sections, each a `{ name, build(dataset, ctx) }`
 * whose `build` returns `{ statements: string[], counts: { <entity>: n } }`.
 * Order matters (foreign keys): a section may only reference rows written by an
 * earlier one. Tasks 05 (media), 06 (gamification) and 14 (events, billing, …)
 * extend the seed by appending their section to {@link SECTIONS} — or by
 * passing their own list — and build statements with {@link upsert} /
 * {@link link}, so every write keeps the same convergence rules:
 *
 *   - every row is keyed by a deterministic id (`ctx.id(entity, key)`), and is
 *     written with `INSERT … ON CONFLICT(<pk>) DO UPDATE` — a re-run updates in
 *     place, never duplicates;
 *   - a join row is `INSERT … ON CONFLICT(<composite pk>) DO NOTHING`;
 *   - nothing is ever deleted;
 *   - a `touch` column (`updated_at`) moves only when a value actually changed,
 *     so a no-op re-run writes nothing to those tables.
 *
 * A unique column other than the key (users.email, tags.slug, user_groups.name)
 * that collides with a NON-demo row fails the run loudly rather than taking the
 * foreign row over — the demo never adopts data it did not create.
 *
 * `ctx`:
 *   label             the label (ids are derived from it)
 *   id(entity, key)   deterministic id — see `demoContext`
 *   email(userKey)    demo e-mail
 *   passwordHash      one `pbkdf2:…` hash, shared by every demo user
 *   renderTopic(title) topic markdown, already sanitised
 *   now               the run's clock reading (gamification dates are relative to it)
 *   gamification      the rules the gamification rows follow (readGamificationReference)
 */

import { demoEmail, demoId } from './ids.mjs';
import { buildGamification, ledgerSumExpression } from './gamification.mjs';
import { buildMediaPlan } from './media.mjs';

// ════════════════════════════════════════════════════════════════════════════
// Literals & statement helpers (exported for the sections of later tasks)
// ════════════════════════════════════════════════════════════════════════════

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function ident(name) {
  if (!IDENTIFIER.test(name)) throw new TypeError(`sql: not a plain identifier: ${name}`);
  return name;
}

/** A SQL literal: `NULL`, an integer, or a single-quoted string (`'` doubled). */
export function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`sql: non-finite number ${value}`);
    return String(value);
  }
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('sql: NUL byte in a string literal');
    return `'${value.replaceAll("'", "''")}'`;
  }
  throw new TypeError(`sql: unsupported value of type ${typeof value}`);
}

/** Wrap a raw SQL expression so {@link upsert} emits it verbatim (e.g. a sub-select). */
export function raw(expression) {
  return { raw: String(expression) };
}

const render = (value) => (value && typeof value === 'object' && 'raw' in value ? value.raw : sqlValue(value));

/**
 * `INSERT INTO table (…) VALUES (…) ON CONFLICT(key) DO UPDATE SET …`.
 *
 * - `key` — the conflict target (default `['id']`); never updated.
 * - `insertOnly` — columns written on insert only (e.g. `created_at`).
 * - `touch` — a timestamp column set to `datetime('now')` on insert and on an
 *   update that changed something; the update is guarded by
 *   `WHERE <col> IS NOT excluded.<col> OR …`, so an unchanged row is left
 *   untouched.
 */
export function upsert(table, row, { key = ['id'], insertOnly = [], touch = null } = {}) {
  const columns = Object.keys(row).map(ident);
  for (const column of key) if (!columns.includes(column)) throw new TypeError(`sql: ${table} row lacks key ${column}`);
  const updated = columns.filter((column) => !key.includes(column) && !insertOnly.includes(column));

  const insertColumns = touch ? [...columns, ident(touch)] : columns;
  const values = columns.map((column) => render(row[column]));
  if (touch) values.push("datetime('now')");

  let statement = `INSERT INTO ${ident(table)} (${insertColumns.join(', ')})\nVALUES (${values.join(', ')})\n`;
  if (updated.length === 0) return `${statement}ON CONFLICT(${key.join(', ')}) DO NOTHING;`;

  const sets = updated.map((column) => `${column} = excluded.${column}`);
  if (touch) sets.push(`${touch} = datetime('now')`);
  statement += `ON CONFLICT(${key.join(', ')}) DO UPDATE SET ${sets.join(', ')}`;
  if (touch) statement += `\n  WHERE ${updated.map((column) => `${table}.${column} IS NOT excluded.${column}`).join(' OR ')}`;
  return `${statement};`;
}

/** A join row: `INSERT … ON CONFLICT(<every column>) DO NOTHING`. */
export function link(table, row) {
  const columns = Object.keys(row).map(ident);
  return upsert(table, row, { key: columns });
}

/** The id of the role called `name`, looked up where it lives (`roles` is seeded by migration 0002). */
export function roleIdExpression(name) {
  return raw(`(SELECT id FROM roles WHERE name = ${sqlValue(name)})`);
}

// ════════════════════════════════════════════════════════════════════════════
// Context
// ════════════════════════════════════════════════════════════════════════════

/**
 * The `ctx` of a seed run for `label`. `passwordHash` and `sanitizeMarkdown`
 * are supplied by the caller (the CLI hashes `AQ_DEMO_PASSWORD` and imports the
 * shared sanitiser); `renderMarkdown(title)` renders the sample topic.
 */
export function demoContext({ label, passwordHash, sanitizeMarkdown, renderMarkdown, now = null, gamification = null }) {
  if (typeof passwordHash !== 'string' || passwordHash.length === 0) throw new TypeError('demoContext: passwordHash is required');
  if (typeof sanitizeMarkdown !== 'function') throw new TypeError('demoContext: sanitizeMarkdown is required');
  if (typeof renderMarkdown !== 'function') throw new TypeError('demoContext: renderMarkdown is required');
  return {
    label,
    passwordHash,
    id: (entity, key) => demoId(label, entity, key),
    email: (userKey) => demoEmail(label, userKey),
    renderTopic: (title) => sanitizeMarkdown(renderMarkdown(title)),
    now,
    gamification,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Core sections (Task 04)
// ════════════════════════════════════════════════════════════════════════════

function topicDepth(topics, key) {
  let depth = 0;
  for (let at = key; at != null; at = topics.get(at)?.parent ?? null) depth += 1;
  return depth;
}

/** Topics parents-first (depth, then dataset order), so `parent_id` always points at an existing row. */
export function topicsParentsFirst(dataset) {
  const byKey = new Map(dataset.topics.map((topic) => [topic.key, topic]));
  return dataset.topics
    .map((topic, index) => ({ topic, index, depth: topicDepth(byKey, topic.key) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map(({ topic }) => topic);
}

export const usersSection = {
  name: 'users',
  build(dataset, ctx) {
    const statements = [];
    let roles = 0;
    for (const user of dataset.users) {
      const id = ctx.id('user', user.key);
      statements.push(
        upsert('users', {
          id,
          name: user.name,
          email: ctx.email(user.key),
          password_hash: ctx.passwordHash,
          status: 'active',
        }),
      );
      for (const role of user.roles) {
        statements.push(link('user_roles', { user_id: id, role_id: roleIdExpression(role) }));
        roles += 1;
      }
    }
    return { statements, counts: { users: dataset.users.length, user_roles: roles } };
  },
};

export const groupsSection = {
  name: 'groups',
  build(dataset, ctx) {
    const statements = [];
    let members = 0;
    for (const group of dataset.groups) {
      const id = ctx.id('group', group.key);
      statements.push(
        upsert('user_groups', { id, name: group.name, description: group.description ?? '' }, { touch: 'updated_at' }),
      );
      for (const member of group.members ?? []) {
        statements.push(link('user_group_members', { group_id: id, user_id: ctx.id('user', member) }));
        members += 1;
      }
    }
    return { statements, counts: { user_groups: dataset.groups.length, user_group_members: members } };
  },
};

export const tagsSection = {
  name: 'tags',
  build(dataset, ctx) {
    const statements = dataset.tags.map((tag) => upsert('tags', { id: ctx.id('tag', tag.key), name: tag.name, slug: tag.slug }));
    return { statements, counts: { tags: dataset.tags.length } };
  },
};

export const topicsSection = {
  name: 'topics',
  build(dataset, ctx) {
    const statements = [];
    let topicTags = 0;
    for (const topic of topicsParentsFirst(dataset)) {
      const id = ctx.id('topic', topic.key);
      statements.push(
        upsert(
          'topic_nodes',
          {
            id,
            parent_id: topic.parent === null ? null : ctx.id('topic', topic.parent),
            title: topic.title,
            content: ctx.renderTopic(topic.title),
            status: topic.status,
            visibility: topic.visibility,
            // Explicit, never MAX(sort_order)+1: a re-run must not reorder.
            sort_order: topic.order,
            estimated_minutes: topic.estimatedMinutes,
            archived: topic.status === 'archived' ? 1 : 0,
          },
          { touch: 'updated_at' },
        ),
      );
    }
    for (const topic of dataset.topics) {
      for (const tag of topic.tags ?? []) {
        statements.push(link('topic_node_tags', { topic_node_id: ctx.id('topic', topic.key), tag_id: ctx.id('tag', tag) }));
        topicTags += 1;
      }
    }
    return { statements, counts: { topic_nodes: dataset.topics.length, topic_node_tags: topicTags } };
  },
};

export const enrollmentsSection = {
  name: 'enrollments',
  build(dataset, ctx) {
    const statements = [];
    const counts = { enrollments_user: 0, enrollments_user_group: 0 };
    for (const grant of dataset.enrollments) {
      const common = {
        id: ctx.id('enrollment', grant.key),
        topic_node_id: ctx.id('topic', grant.topic),
        granted_by: ctx.id('user', grant.grantedBy),
      };
      if (grant.group !== undefined) {
        statements.push(upsert('enrollments_user_group', { ...common, group_id: ctx.id('group', grant.group) }));
        counts.enrollments_user_group += 1;
      } else {
        statements.push(upsert('enrollments_user', { ...common, user_id: ctx.id('user', grant.user) }));
        counts.enrollments_user += 1;
      }
    }
    return { statements, counts };
  },
};

/**
 * One `ready` row per (topic, manifest file) — see media.mjs for the id and key.
 * The CLI executes this SQL only after every object was uploaded and confirmed,
 * so `ready` here never describes a missing object.
 */
export const mediaSection = {
  name: 'media',
  build(dataset, ctx) {
    const plan = buildMediaPlan(dataset, ctx);
    const statements = plan.map((entry) =>
      upsert(
        'media',
        {
          id: entry.id,
          topic_node_id: entry.topicId,
          uploaded_by: entry.uploadedBy,
          storage_key: entry.key,
          original_name: entry.file.fileName,
          type: entry.file.type,
          size_bytes: entry.file.sizeBytes,
          status: 'ready',
        },
        { touch: 'updated_at' },
      ),
    );
    return { statements, counts: { media: plan.length } };
  },
};

/**
 * Progress, XP ledger, badges, streak, quest progress and the mission — see
 * gamification.mjs for the rows and why each table is keyed as it is. Needs
 * `ctx.now` and `ctx.gamification`.
 */
export const gamificationSection = {
  name: 'gamification',
  build(dataset, ctx) {
    const { rows } = buildGamification(dataset, ctx);
    const statements = [
      ...rows.topic_progress.map((row) =>
        upsert('topic_progress', row, { key: ['user_id', 'topic_node_id'], insertOnly: ['id'], touch: 'updated_at' }),
      ),
      ...rows.xp_events.map((row) =>
        upsert('xp_events', row, { key: ['user_id', 'source_kind', 'idempotency_key'], insertOnly: ['id'] }),
      ),
      ...rows.user_badges.map((row) => upsert('user_badges', row, { key: ['user_id', 'badge_id'], insertOnly: ['id'] })),
      // After the ledger: the read model is its sum, computed where the ledger is.
      ...rows.user_xp.map((row) =>
        upsert('user_xp', { user_id: row.user_id, total_xp: raw(ledgerSumExpression(row.user_id)) }, { key: ['user_id'], touch: 'updated_at' }),
      ),
      ...rows.user_streak.map((row) => upsert('user_streak', row, { key: ['user_id'], touch: 'updated_at' })),
      ...rows.quest_progress.map((row) =>
        upsert('quest_progress', row, {
          key: ['user_id', 'quest_id', 'period_key'],
          insertOnly: ['current_value', 'target_value', 'completed', 'completed_at'],
        }),
      ),
      ...rows.missions.map((row) => upsert('missions', row, { touch: 'updated_at' })),
    ];
    const counts = Object.fromEntries(Object.entries(rows).map(([table, list]) => [table, list.length]));
    return { statements, counts };
  },
};

/**
 * The seed, in foreign-key order. Later tasks append here:
 * extensions (14) at the end.
 */
export const SECTIONS = [usersSection, groupsSection, tagsSection, topicsSection, mediaSection, enrollmentsSection, gamificationSection];

// ════════════════════════════════════════════════════════════════════════════
// Assembly
// ════════════════════════════════════════════════════════════════════════════

/**
 * The whole seed as one SQL script plus a per-entity summary.
 *
 * No `BEGIN`/`COMMIT`: `wrangler d1 execute --remote --file` rejects explicit
 * transactions (D1 runs the file atomically on its own).
 */
export function buildSeedSql(dataset, ctx, sections = SECTIONS) {
  const names = new Set();
  const summary = [];
  const statements = [];
  const parts = [
    `-- ArenaQuest demo seed — label "${dataset.label ?? ctx.label}" (RFC 0021).`,
    '-- Generated by scripts/demo/seed-demo.mjs. Idempotent: re-running converges.',
    '-- Contains a password HASH only; never commit this file.',
  ];
  for (const section of sections) {
    if (names.has(section.name)) throw new Error(`sql: duplicate section "${section.name}"`);
    names.add(section.name);
    const built = section.build(dataset, ctx);
    parts.push('', `-- ── ${section.name} ${'─'.repeat(Math.max(0, 72 - section.name.length))}`, ...built.statements);
    statements.push(...built.statements);
    const counts = built.counts;
    for (const [entity, rows] of Object.entries(counts ?? {})) summary.push({ section: section.name, entity, rows });
  }
  return { sql: `${parts.join('\n')}\n`, statements, summary };
}
