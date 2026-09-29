/**
 * dataset.mjs — load and validate the demo dataset (RFC 0021 §3.2–3.4).
 *
 * This module says WHAT the demo is; the seed (Task 04), media (Task 05) and
 * gamification (Task 06) writers decide HOW it is written. It does no I/O
 * beyond reading files from the checkout: no wrangler, no SQL, no network.
 *
 *   loadDataset(label, { repoRoot })   base.json + optional label override,
 *                                      merged and validated; throws on any gap.
 *   readSampleTopic() / renderTopicMarkdown(title)
 *                                      the markdown every topic carries.
 *   datasetCounts(dataset)             counts for a quick inspection.
 *
 * Label override: `config/labels/<label>/demo.json` (optional). It may set
 * `language`, rename entries (`title` / `name` / `description` of an existing
 * user, group, tag, topic or mission, matched by `key`) and ADD media: new
 * manifest entries (by `key`, replacing a same-key entry) and extra
 * `media.assign` keys (appended to a topic's list). It can never add a user or
 * a topic — so the baseline user keys are the complete list for every label,
 * which is what the production guard (Task 07) relies on.
 *
 * Validation reads its vocabularies from the files that own them, so there is
 * one source of truth for each:
 *   roles              apps/api/migrations/0002_seed_roles.sql
 *   quest slugs        apps/api/migrations/0019_seed_quests.sql
 *   badge slugs + XP   apps/api/migrations/0021_seed_badges.sql
 *   media types/limits packages/shared/domain/media/limits.ts
 *   mission predicates packages/shared/domain/gamification/quest-evaluator.ts
 *   topic XP           packages/shared/domain/gamification/xp-config.ts
 * (read as text: this is a stdlib-only script with no build step, like the
 * importer's limits parity test).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/demo/..)

export const BASE_DATASET_PATH = join(HERE, 'dataset', 'base.json');
export const SAMPLE_TOPIC_PATH = join(HERE, 'dataset', 'sample-topic.md');

/** Root → module → lesson. */
export const TREE_DEPTH = 3;
export const TOPIC_STATUSES = ['draft', 'published', 'archived'];
export const TOPIC_VISIBILITIES = ['public', 'restricted', 'private'];
/** Only sources nobody can revoke. */
export const MEDIA_LICENSES = ['CC0', 'public-domain'];

/** Fields an override may change on an existing entry. */
const RENAMEABLE_FIELDS = ['title', 'name', 'description'];
/** Array sections an override may rename entries in (matched by `key`). */
const RENAMEABLE_SECTIONS = ['users', 'groups', 'tags', 'topics'];
/** Key names that must never appear anywhere in a dataset file. */
const FORBIDDEN_KEY = /pass(word)?|hash|secret|token/i;

/** Thrown by {@link validateDataset}; `problems` lists every failure found. */
export class DatasetError extends Error {
  constructor(problems) {
    super(`invalid demo dataset:\n  - ${problems.join('\n  - ')}`);
    this.name = 'DatasetError';
    this.problems = problems;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Reference vocabularies (read from the files that own them)
// ════════════════════════════════════════════════════════════════════════════

function read(repoRoot, relPath) {
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

/** The vocabularies {@link validateDataset} checks against. */
export function readReference(repoRoot = ROOT) {
  const roles = [
    ...read(repoRoot, 'apps/api/migrations/0002_seed_roles.sql').matchAll(/\('[0-9a-f-]{36}',\s*'([a-z_]+)'/g),
  ].map((m) => m[1]);

  const quests = [
    ...read(repoRoot, 'apps/api/migrations/0019_seed_quests.sql').matchAll(/^\('([a-z0-9-]+)',\s*'(?:daily|weekly)'/gm),
  ].map((m) => m[1]);

  const badges = {};
  for (const m of read(repoRoot, 'apps/api/migrations/0021_seed_badges.sql').matchAll(
    /\('badge-[a-z0-9-]+',\s*'([a-z0-9-]+)',\s*'(?:[^']|'')*',\s*'[^']*',\s*'(?:[^']|'')*',\s*(\d+),/g,
  )) {
    badges[m[1]] = Number(m[2]);
  }

  const limitsSource = read(repoRoot, 'packages/shared/domain/media/limits.ts');
  const block = limitsSource.match(/MEDIA_SIZE_LIMIT_BYTES[^=]*=\s*\{([\s\S]*?)\n\};/);
  const mediaLimits = {};
  for (const [, type, expression] of (block?.[1] ?? '').matchAll(/'([^']+)':\s*([\d\s*]+?),/g)) {
    mediaLimits[type] = expression.split('*').reduce((product, factor) => product * Number(factor.trim()), 1);
  }

  const predicateBlock = read(repoRoot, 'packages/shared/domain/gamification/quest-evaluator.ts').match(
    /PREDICATE_TO_SOURCE[^=]*=\s*\{([\s\S]*?)\};/,
  );
  const missionPredicates = [...(predicateBlock?.[1] ?? '').matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);

  const topicCompleteXp = Number(
    read(repoRoot, 'packages/shared/domain/gamification/xp-config.ts').match(/topic_complete:\s*(\d+)/)?.[1],
  );

  const reference = { roles, quests, badges, mediaLimits, missionPredicates, topicCompleteXp };
  for (const [name, value] of Object.entries(reference)) {
    const empty = Array.isArray(value) ? value.length === 0 : typeof value === 'object' ? Object.keys(value).length === 0 : !Number.isFinite(value);
    if (empty) throw new Error(`demo dataset: could not read the "${name}" vocabulary from the checkout`);
  }
  return reference;
}

// ════════════════════════════════════════════════════════════════════════════
// Merge
// ════════════════════════════════════════════════════════════════════════════

/**
 * `base` with `override` applied (see the module header for what an override
 * may do). Pure: neither input is mutated. Throws on an override that tries
 * anything else, naming the offending entry.
 */
export function mergeDataset(base, override) {
  const merged = structuredClone(base);
  if (override == null) return merged;
  if (typeof override !== 'object' || Array.isArray(override)) {
    throw new DatasetError(['override: must be a JSON object']);
  }

  const problems = [];
  const allowed = new Set(['$comment', 'language', 'media', 'missions', ...RENAMEABLE_SECTIONS]);
  for (const section of Object.keys(override)) {
    if (!allowed.has(section)) problems.push(`override: section "${section}" cannot be overridden`);
  }

  if (override.language !== undefined) merged.language = override.language;

  const renameIn = (where, list, entries) => {
    if (!Array.isArray(entries)) {
      problems.push(`override.${where}: must be an array`);
      return;
    }
    for (const entry of entries) {
      const target = list.find((item) => item.key === entry?.key);
      if (!target) {
        problems.push(`override.${where}: "${entry?.key}" is not in the baseline (an override cannot add entries)`);
        continue;
      }
      for (const [field, value] of Object.entries(entry)) {
        if (field === 'key') continue;
        if (!RENAMEABLE_FIELDS.includes(field)) {
          problems.push(`override.${where}["${entry.key}"]: field "${field}" cannot be overridden`);
        } else {
          target[field] = value;
        }
      }
    }
  };

  for (const section of RENAMEABLE_SECTIONS) {
    if (override[section] !== undefined) renameIn(section, merged[section], override[section]);
  }
  if (override.missions !== undefined) {
    renameIn('missions', merged.gamification.missions, override.missions);
  }

  if (override.media !== undefined) {
    const { manifest = [], assign = {}, ...rest } = override.media;
    for (const field of Object.keys(rest)) problems.push(`override.media: field "${field}" cannot be overridden`);
    for (const entry of manifest) {
      const at = merged.media.manifest.findIndex((item) => item.key === entry?.key);
      if (at === -1) merged.media.manifest.push(entry);
      else merged.media.manifest[at] = entry;
    }
    for (const [topicKey, keys] of Object.entries(assign)) {
      if (!Object.hasOwn(merged.media.assign, topicKey)) {
        problems.push(`override.media.assign: "${topicKey}" is not a baseline topic`);
        continue;
      }
      merged.media.assign[topicKey] = [...new Set([...merged.media.assign[topicKey], ...keys])];
    }
  }

  if (problems.length > 0) throw new DatasetError(problems);
  return merged;
}

// ════════════════════════════════════════════════════════════════════════════
// Validation
// ════════════════════════════════════════════════════════════════════════════

function indexByKey(list, where, problems) {
  const index = new Map();
  if (!Array.isArray(list)) {
    problems.push(`${where}: must be an array`);
    return index;
  }
  for (const item of list) {
    if (typeof item?.key !== 'string' || item.key.length === 0) {
      problems.push(`${where}: an entry has no "key"`);
    } else if (index.has(item.key)) {
      problems.push(`${where}["${item.key}"]: duplicate key`);
    } else {
      index.set(item.key, item);
    }
  }
  return index;
}

function findForbiddenKeys(value, path, problems) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => findForbiddenKeys(item, `${path}[${i}]`, problems));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) problems.push(`${path}.${key}: no password, hash or secret belongs in the dataset`);
      findForbiddenKeys(child, `${path}.${key}`, problems);
    }
  }
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isNonNegativeInt = (value) => Number.isInteger(value) && value >= 0;

/**
 * Throws a {@link DatasetError} listing every problem in `dataset`, each naming
 * the offending entry. Returns `dataset` when it is valid.
 */
export function validateDataset(dataset, reference) {
  const problems = [];
  findForbiddenKeys(dataset, 'dataset', problems);

  // -- users & groups ---------------------------------------------------------
  const users = indexByKey(dataset.users, 'users', problems);
  for (const [key, user] of users) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) problems.push(`users["${key}"]: key must be lowercase kebab-case`);
    if (!isNonEmptyString(user.name)) problems.push(`users["${key}"]: missing "name"`);
    if (!Array.isArray(user.roles) || user.roles.length === 0) problems.push(`users["${key}"]: needs at least one role`);
    for (const role of user.roles ?? []) {
      if (!reference.roles.includes(role)) {
        problems.push(`users["${key}"]: unknown role "${role}" (known: ${reference.roles.join(', ')})`);
      }
    }
  }

  const groups = indexByKey(dataset.groups, 'groups', problems);
  for (const [key, group] of groups) {
    if (!isNonEmptyString(group.name)) problems.push(`groups["${key}"]: missing "name"`);
    for (const member of group.members ?? []) {
      if (!users.has(member)) problems.push(`groups["${key}"]: member "${member}" is not a user`);
    }
  }

  // -- tags & topics ----------------------------------------------------------
  const tags = indexByKey(dataset.tags, 'tags', problems);
  for (const [key, tag] of tags) {
    if (!isNonEmptyString(tag.name)) problems.push(`tags["${key}"]: missing "name"`);
    if (typeof tag.slug !== 'string' || !/^[a-z0-9-]+$/.test(tag.slug)) problems.push(`tags["${key}"]: invalid "slug"`);
  }

  const topics = indexByKey(dataset.topics, 'topics', problems);
  for (const [key, topic] of topics) {
    if (!isNonEmptyString(topic.title)) problems.push(`topics["${key}"]: missing "title"`);
    if (topic.parent !== null && !topics.has(topic.parent)) {
      problems.push(`topics["${key}"]: parent "${topic.parent}" is not a topic`);
    }
    if (!TOPIC_STATUSES.includes(topic.status)) problems.push(`topics["${key}"]: unknown status "${topic.status}"`);
    if (!TOPIC_VISIBILITIES.includes(topic.visibility)) {
      problems.push(`topics["${key}"]: unknown visibility "${topic.visibility}"`);
    }
    if (!isNonNegativeInt(topic.order)) problems.push(`topics["${key}"]: "order" must be a non-negative integer`);
    if (!Number.isInteger(topic.estimatedMinutes) || topic.estimatedMinutes <= 0) {
      problems.push(`topics["${key}"]: "estimatedMinutes" must be a positive integer`);
    }
    for (const tag of topic.tags ?? []) {
      if (!tags.has(tag)) problems.push(`topics["${key}"]: tag "${tag}" is not a tag`);
    }
  }

  // Depth: every node sits at depth 1..3 and every leaf at exactly 3.
  const children = new Map([...topics.keys()].map((key) => [key, []]));
  for (const [key, topic] of topics) if (children.has(topic.parent)) children.get(topic.parent).push(key);
  const depthOf = (key) => {
    const seen = new Set();
    let depth = 0;
    for (let at = key; at != null && topics.has(at); at = topics.get(at).parent) {
      if (seen.has(at)) return Infinity; // a cycle is never a valid depth
      seen.add(at);
      depth += 1;
    }
    return depth;
  };
  if (topics.size > 0 && ![...topics.values()].some((topic) => topic.parent === null)) {
    problems.push('topics: no root topic (parent null)');
  }
  for (const key of topics.keys()) {
    const depth = depthOf(key);
    if (depth > TREE_DEPTH) {
      problems.push(`topics["${key}"]: depth ${depth === Infinity ? '∞ (cycle)' : depth} exceeds ${TREE_DEPTH}`);
    } else if (children.get(key).length === 0 && depth < TREE_DEPTH) {
      problems.push(`topics["${key}"]: leaf at depth ${depth}, the tree must be exactly ${TREE_DEPTH} levels deep`);
    }
  }

  // -- enrollments --------------------------------------------------------------
  const enrollments = indexByKey(dataset.enrollments, 'enrollments', problems);
  for (const [key, grant] of enrollments) {
    if (!topics.has(grant.topic)) problems.push(`enrollments["${key}"]: topic "${grant.topic}" is not a topic`);
    if ((grant.user === undefined) === (grant.group === undefined)) {
      problems.push(`enrollments["${key}"]: needs exactly one of "user" or "group"`);
    }
    if (grant.user !== undefined && !users.has(grant.user)) problems.push(`enrollments["${key}"]: user "${grant.user}" is not a user`);
    if (grant.group !== undefined && !groups.has(grant.group)) {
      problems.push(`enrollments["${key}"]: group "${grant.group}" is not a group`);
    }
    if (!users.has(grant.grantedBy)) problems.push(`enrollments["${key}"]: grantedBy "${grant.grantedBy}" is not a user`);
  }

  // -- media ----------------------------------------------------------------------
  const media = dataset.media ?? {};
  if (!users.has(media.uploadedBy)) problems.push(`media: uploadedBy "${media.uploadedBy}" is not a user`);
  const manifest = indexByKey(media.manifest, 'media.manifest', problems);
  for (const [key, file] of manifest) {
    const where = `media.manifest["${key}"]`;
    const limit = reference.mediaLimits[file.type];
    if (limit === undefined) {
      problems.push(`${where}: type "${file.type}" is not allowed (allowed: ${Object.keys(reference.mediaLimits).join(', ')})`);
    } else if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0 || file.sizeBytes > limit) {
      problems.push(`${where}: sizeBytes ${file.sizeBytes} is outside 1..${limit} for ${file.type}`);
    }
    if (!isNonEmptyString(file.fileName) || /[/\\]/.test(file.fileName)) problems.push(`${where}: invalid "fileName"`);
    if (typeof file.url !== 'string' || !file.url.startsWith('https://')) problems.push(`${where}: "url" must be https`);
    if (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      problems.push(`${where}: "sha256" must be 64 lowercase hex characters`);
    }
    if (!MEDIA_LICENSES.includes(file.license)) {
      problems.push(`${where}: license "${file.license}" is not accepted (only ${MEDIA_LICENSES.join(', ')})`);
    }
    if (!isNonEmptyString(file.source)) problems.push(`${where}: missing "source" (credit)`);
  }
  const assign = media.assign ?? {};
  for (const [topicKey, keys] of Object.entries(assign)) {
    if (!topics.has(topicKey)) problems.push(`media.assign["${topicKey}"]: not a topic`);
    for (const fileKey of keys) {
      if (!manifest.has(fileKey)) problems.push(`media.assign["${topicKey}"]: "${fileKey}" is not in the manifest`);
    }
  }
  for (const key of topics.keys()) {
    if (!Array.isArray(assign[key]) || assign[key].length === 0) problems.push(`topics["${key}"]: has no media`);
  }

  // -- gamification -------------------------------------------------------------
  const gamification = dataset.gamification ?? {};
  const seenStudents = new Set();
  for (const state of gamification.students ?? []) {
    const where = `gamification.students["${state.user}"]`;
    if (seenStudents.has(state.user)) problems.push(`${where}: duplicate`);
    seenStudents.add(state.user);
    if (!users.get(state.user)?.roles?.includes('student')) problems.push(`${where}: not a student user`);
    for (const topic of state.completedTopics ?? []) {
      if (!topics.has(topic)) problems.push(`${where}: completed topic "${topic}" is not a topic`);
    }
    for (const badge of state.badges ?? []) {
      if (!Object.hasOwn(reference.badges, badge)) problems.push(`${where}: unknown badge slug "${badge}"`);
    }
    for (const quest of state.quests ?? []) {
      if (!reference.quests.includes(quest.slug)) problems.push(`${where}: unknown quest slug "${quest.slug}"`);
      if (!isNonNegativeInt(quest.current)) problems.push(`${where}: quest "${quest.slug}" needs a non-negative "current"`);
    }
    if (!isNonNegativeInt(state.streakDays)) problems.push(`${where}: "streakDays" must be a non-negative integer`);
    const xp =
      (state.completedTopics ?? []).length * reference.topicCompleteXp +
      (state.badges ?? []).reduce((sum, badge) => sum + (reference.badges[badge] ?? 0), 0) +
      (state.adminAdjustments ?? []).reduce((sum, points) => sum + points, 0);
    if (state.expectedTotalXp !== xp) {
      problems.push(`${where}: expectedTotalXp ${state.expectedTotalXp} but its events sum to ${xp}`);
    }
  }

  const missions = indexByKey(gamification.missions ?? [], 'gamification.missions', problems);
  for (const [key, mission] of missions) {
    const where = `gamification.missions["${key}"]`;
    if (!isNonEmptyString(mission.title)) problems.push(`${where}: missing "title"`);
    if (!reference.missionPredicates.includes(mission.predicateKind)) {
      problems.push(`${where}: unknown predicateKind "${mission.predicateKind}" (known: ${reference.missionPredicates.join(', ')})`);
    }
    if (mission.badge != null && !Object.hasOwn(reference.badges, mission.badge)) {
      problems.push(`${where}: unknown badge slug "${mission.badge}"`);
    }
    if (!Number.isInteger(mission.activeDays) || mission.activeDays <= 0) problems.push(`${where}: "activeDays" must be positive`);
    if (!isNonNegativeInt(mission.xpReward)) problems.push(`${where}: "xpReward" must be a non-negative integer`);
  }

  if (problems.length > 0) throw new DatasetError(problems);
  return dataset;
}

// ════════════════════════════════════════════════════════════════════════════
// Loading
// ════════════════════════════════════════════════════════════════════════════

/** The path of `label`'s optional override. */
export function overridePath(label, repoRoot = ROOT) {
  return join(repoRoot, 'config', 'labels', label, 'demo.json');
}

/**
 * The validated demo dataset of `label`: `base.json`, merged with
 * `config/labels/<label>/demo.json` when it exists. The result carries `label`.
 */
export function loadDataset(label, { repoRoot = ROOT, basePath = BASE_DATASET_PATH } = {}) {
  if (typeof label !== 'string' || !/^[a-z][a-z0-9-]*$/.test(label)) throw new TypeError(`invalid label "${label}"`);
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  const path = overridePath(label, repoRoot);
  let override = null;
  if (existsSync(path)) {
    try {
      override = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new DatasetError([`${path}: ${error.message}`]);
    }
  }
  const dataset = validateDataset(mergeDataset(base, override), readReference(repoRoot));
  delete dataset.$comment;
  return { label, ...dataset };
}

/** The raw sample markdown, with its `{{title}}` slot. */
export function readSampleTopic(path = SAMPLE_TOPIC_PATH) {
  return readFileSync(path, 'utf8');
}

/** The sample markdown with `title` in every `{{title}}` slot. */
export function renderTopicMarkdown(title, template = readSampleTopic()) {
  return template.replaceAll('{{title}}', title);
}

/** Entity counts, for inspection and tests. */
export function datasetCounts(dataset) {
  return {
    users: dataset.users.length,
    groups: dataset.groups.length,
    topics: dataset.topics.length,
    roots: dataset.topics.filter((topic) => topic.parent === null).length,
    tags: dataset.tags.length,
    mediaFiles: dataset.media.manifest.length,
    topicsWithMedia: dataset.topics.filter((topic) => (dataset.media.assign[topic.key] ?? []).length > 0).length,
    enrollments: dataset.enrollments.length,
    missions: dataset.gamification.missions.length,
  };
}
