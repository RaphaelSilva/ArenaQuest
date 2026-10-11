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
 * user, group, tag, topic or mission, and the `title` of a mission's
 * requirement, each matched by `key`) and ADD media: new
 * manifest entries (by `key`, replacing a same-key entry) and extra
 * `media.assign` keys (appended to a topic's list). It can never add a user or
 * a topic — so the baseline user keys are the complete list for every label,
 * which is what the production guard (Task 07) relies on. The Task 14 sections
 * (`events`, `billing`, `tasks`, `comments`) are baseline-only: an override
 * cannot touch them.
 *
 * Validation reads its vocabularies from the files that own them, so there is
 * one source of truth for each:
 *   roles              apps/api/migrations/0002_seed_roles.sql
 *   quest slugs        apps/api/migrations/0019_seed_quests.sql
 *   badge slugs + XP   apps/api/migrations/0021_seed_badges.sql
 *   media types/limits packages/shared/domain/media/limits.ts
 *   mission modes,
 *   requirement kinds,
 *   step limits        packages/shared/domain/missions/requirements.ts
 *   topic XP           packages/shared/domain/gamification/xp-config.ts
 *   active currency,
 *   payment methods    apps/api/migrations/0026_create_billing_tables.sql
 *   billing cycles     apps/api/migrations/0026_create_billing_tables.sql
 *   event audiences    apps/api/migrations/0027_create_events.sql
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
/** Fields an override may change on an existing mission requirement (matched by `key`). */
const RENAMEABLE_REQUIREMENT_FIELDS = ['title'];
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

  const missions = readMissionVocabulary(read(repoRoot, 'packages/shared/domain/missions/requirements.ts'));

  const topicCompleteXp = Number(
    read(repoRoot, 'packages/shared/domain/gamification/xp-config.ts').match(/topic_complete:\s*(\d+)/)?.[1],
  );

  const billing = read(repoRoot, 'apps/api/migrations/0026_create_billing_tables.sql');
  const activeCurrency = [...billing.matchAll(/\('([A-Z]{3})',\s*\d+,\s*'[^']*',\s*'[^']*',\s*1\)/g)].map((m) => m[1]);
  const checkList = (source, column) =>
    [...(source.match(new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`))?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const paymentMethods = checkList(billing, 'method');
  const billingCycles = checkList(billing, 'cycle');
  const eventAudiences = checkList(read(repoRoot, 'apps/api/migrations/0027_create_events.sql'), 'audience');

  const reference = {
    roles,
    quests,
    badges,
    mediaLimits,
    ...missions,
    topicCompleteXp,
    activeCurrency: activeCurrency.length === 1 ? activeCurrency[0] : Number.NaN,
    paymentMethods,
    billingCycles,
    eventAudiences,
  };
  for (const [name, value] of Object.entries(reference)) {
    const empty = Array.isArray(value)
      ? value.length === 0
      : typeof value === 'object'
        ? Object.keys(value).length === 0
        : typeof value === 'string'
          ? value.length === 0
          : !Number.isFinite(value);
    if (empty) throw new Error(`demo dataset: could not read the "${name}" vocabulary from the checkout`);
  }
  for (const [name, value] of Object.entries(reference.requirementLimits)) {
    if (!Number.isInteger(value)) throw new Error(`demo dataset: could not read the "requirementLimits.${name}" limit from the checkout`);
  }
  return reference;
}

/**
 * The mission vocabulary of `requirements.ts` (its source text): the modes, the
 * enrollment modes, the requirement kinds (and which of them target a topic)
 * and the step limits. The per-kind params rules are mirrored in
 * {@link normalizeRequirementParams}; dataset.test.mjs checks both against the
 * schemas themselves, so a change there fails the script tests.
 */
export function readMissionVocabulary(source) {
  const list = (name) =>
    [...(source.match(new RegExp(`export const ${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`))?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
  const enumOf = (name) =>
    [...(source.match(new RegExp(`export const ${name}\\s*=\\s*z\\.enum\\(\\[([^\\]]*)\\]`))?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
  const constant = (name) => Number(source.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+);`))?.[1]);
  return {
    missionModes: enumOf('MissionMode'),
    enrollmentModes: enumOf('MissionEnrollmentMode'),
    requirementKinds: list('REQUIREMENT_KINDS'),
    topicRequirementKinds: list('TOPIC_REQUIREMENT_KINDS'),
    requirementLimits: {
      stepsMax: constant('MISSION_STEPS_MAX'),
      titleMax: constant('REQUIREMENT_TITLE_MAX'),
      minCountMax: constant('REQUIREMENT_MIN_COUNT_MAX'),
      instructionsMax: constant('MANUAL_CHECK_INSTRUCTIONS_MAX'),
    },
  };
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

  // `nested`: a field holding a keyed sub-list that is renamed the same way
  // (a mission's `requirements`), with its own renameable fields.
  const renameIn = (where, list, entries, { fields = RENAMEABLE_FIELDS, nested = {} } = {}) => {
    if (!Array.isArray(entries)) {
      problems.push(`override.${where}: must be an array`);
      return;
    }
    for (const entry of entries) {
      const target = (Array.isArray(list) ? list : []).find((item) => item.key === entry?.key);
      if (!target) {
        problems.push(`override.${where}: "${entry?.key}" is not in the baseline (an override cannot add entries)`);
        continue;
      }
      for (const [field, value] of Object.entries(entry)) {
        if (field === 'key') continue;
        if (Object.hasOwn(nested, field)) {
          renameIn(`${where}["${entry.key}"].${field}`, target[field], value, nested[field]);
        } else if (!fields.includes(field)) {
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
    renameIn('missions', merged.gamification.missions, override.missions, {
      nested: { requirements: { fields: RENAMEABLE_REQUIREMENT_FIELDS } },
    });
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

  validateMissions(dataset, reference, { topics, manifest }, problems);

  validateExtensions(dataset, reference, { users, groups, topics, children }, problems);

  if (problems.length > 0) throw new DatasetError(problems);
  return dataset;
}

// -- missions (M27): typed, windowed missions with ordered requirements ----------

/** Every field a dataset mission may carry. */
const MISSION_FIELDS = ['key', 'title', 'description', 'mode', 'enrollmentMode', 'activeDays', 'xpReward', 'badge', 'requirements'];
/** Every field a mission requirement may carry; `topic` / `event` are dataset keys, resolved to ids by the seed. */
const REQUIREMENT_FIELDS = ['key', 'kind', 'title', 'topic', 'event', 'params', 'xpReward'];
/** The value sets of `submissions_on_topic.visibility` (requirements.ts). */
export const SUBMISSION_VISIBILITIES = ['any', 'shared_only'];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `raw` params of a requirement of `kind`, checked and normalised the way
 * `RequirementParams[kind]` (requirements.ts) parses them: strict keys,
 * defaults applied in the schema's key order, `instructions` trimmed. Returns
 * `{ params, problems }` — `params` is null when a problem was found. Absent
 * params are `{}`, which is valid exactly for the kinds whose schema needs no key.
 */
export function normalizeRequirementParams(kind, raw, limits) {
  const problems = [];
  const input = raw === undefined ? {} : raw;
  if (!isPlainObject(input)) return { params: null, problems: ['"params" must be an object'] };

  const minCount = (value) => {
    if (!Number.isInteger(value) || value < 1 || value > limits.minCountMax) {
      problems.push(`params "minCount" must be an integer 1..${limits.minCountMax} (got ${JSON.stringify(value)})`);
    }
    return value;
  };
  const boolean = (name, fallback) => {
    const value = input[name] ?? fallback;
    if (typeof value !== 'boolean') problems.push(`params "${name}" must be a boolean`);
    return value;
  };

  let allowed;
  let params;
  switch (kind) {
    case 'submissions_on_topic': {
      allowed = ['minCount', 'requireDescription', 'visibility', 'countModerated'];
      const visibility = input.visibility ?? 'any';
      if (!SUBMISSION_VISIBILITIES.includes(visibility)) {
        problems.push(`params "visibility" must be one of ${SUBMISSION_VISIBILITIES.join(', ')} (got ${JSON.stringify(visibility)})`);
      }
      params = {
        minCount: minCount(input.minCount),
        requireDescription: boolean('requireDescription', false),
        visibility,
        countModerated: boolean('countModerated', false),
      };
      break;
    }
    case 'video_watched':
      allowed = ['minCount'];
      params = { minCount: minCount(input.minCount) };
      break;
    case 'manual_check': {
      allowed = ['instructions'];
      const instructions = input.instructions ?? '';
      if (typeof instructions !== 'string') problems.push('params "instructions" must be a string');
      else if (instructions.trim().length > limits.instructionsMax) {
        problems.push(`params "instructions" must be at most ${limits.instructionsMax} characters`);
      }
      params = { instructions: typeof instructions === 'string' ? instructions.trim() : instructions };
      break;
    }
    case 'topic_visited':
    case 'event_participation':
      allowed = [];
      params = {};
      break;
    default:
      return { params: null, problems: [`no params rule for kind "${kind}"`] };
  }
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) problems.push(`params "${key}" is not a parameter of ${kind}`);
  }
  return { params: problems.length > 0 ? null : params, problems };
}

/**
 * Missions: a mode, an enrollment mode, a window and an ordered list of typed
 * requirements whose targets are dataset keys. A requirement must be one the
 * API would accept from an admin (admin-missions.controller.ts): a topic target
 * exists and is published, a `video_watched` topic carries a video, and an
 * `event_participation` event is priced — the demo prices no event, so that
 * kind is refused here rather than failing the seed.
 */
function validateMissions(dataset, reference, { topics, manifest }, problems) {
  const limits = reference.requirementLimits;
  const assign = dataset.media?.assign ?? {};
  const events = new Map((Array.isArray(dataset.events) ? dataset.events : []).map((event) => [event?.key, event]));
  const missions = indexByKey(dataset.gamification?.missions ?? [], 'gamification.missions', problems);

  for (const [key, mission] of missions) {
    const where = `gamification.missions["${key}"]`;
    for (const field of Object.keys(mission)) {
      if (!MISSION_FIELDS.includes(field)) {
        problems.push(`${where}: field "${field}" is not a mission field (a mission is defined by its "requirements")`);
      }
    }
    if (!isNonEmptyString(mission.title)) problems.push(`${where}: missing "title"`);
    if (mission.description !== undefined && typeof mission.description !== 'string') problems.push(`${where}: "description" must be a string`);
    if (!reference.missionModes.includes(mission.mode)) {
      problems.push(`${where}: unknown mode "${mission.mode}" (known: ${reference.missionModes.join(', ')})`);
    }
    if (!reference.enrollmentModes.includes(mission.enrollmentMode)) {
      problems.push(`${where}: unknown enrollmentMode "${mission.enrollmentMode}" (known: ${reference.enrollmentModes.join(', ')})`);
    } else if (mission.enrollmentMode === 'assigned') {
      problems.push(`${where}: enrollmentMode "assigned" needs an audience, which the demo does not seed (use auto or open)`);
    }
    if (mission.badge != null && !Object.hasOwn(reference.badges, mission.badge)) {
      problems.push(`${where}: unknown badge slug "${mission.badge}"`);
    }
    if (!Number.isInteger(mission.activeDays) || mission.activeDays <= 0) problems.push(`${where}: "activeDays" must be positive`);
    if (!isNonNegativeInt(mission.xpReward)) problems.push(`${where}: "xpReward" must be a non-negative integer`);

    const requirements = indexByKey(mission.requirements, `${where}.requirements`, problems);
    if (Array.isArray(mission.requirements) && (mission.requirements.length < 1 || mission.requirements.length > limits.stepsMax)) {
      problems.push(`${where}: needs 1..${limits.stepsMax} requirements (has ${mission.requirements.length})`);
    }
    for (const [stepKey, step] of requirements) {
      const at = `${where}.requirements["${stepKey}"]`;
      for (const field of Object.keys(step)) {
        if (!REQUIREMENT_FIELDS.includes(field)) problems.push(`${at}: field "${field}" is not a requirement field`);
      }
      if (typeof step.title !== 'string' || step.title.trim().length === 0 || step.title.trim().length > limits.titleMax) {
        problems.push(`${at}: "title" must be 1..${limits.titleMax} characters`);
      }
      if (step.xpReward !== undefined && !isNonNegativeInt(step.xpReward)) problems.push(`${at}: "xpReward" must be a non-negative integer`);
      if (!reference.requirementKinds.includes(step.kind)) {
        problems.push(`${at}: unknown kind "${step.kind}" (known: ${reference.requirementKinds.join(', ')})`);
        continue;
      }

      if (reference.topicRequirementKinds.includes(step.kind)) {
        if (step.event !== undefined) problems.push(`${at}: a ${step.kind} step targets a topic, not an event`);
        const topic = topics.get(step.topic);
        if (!topic) problems.push(`${at}: topic "${step.topic}" is not a topic`);
        else if (topic.status !== 'published') problems.push(`${at}: topic "${step.topic}" is ${topic.status} (the API needs a published topic)`);
        else if (step.kind === 'video_watched' && !(assign[step.topic] ?? []).some((file) => manifest.get(file)?.type?.startsWith('video/'))) {
          problems.push(`${at}: topic "${step.topic}" has no video`);
        }
      } else if (step.kind === 'event_participation') {
        if (step.topic !== undefined) problems.push(`${at}: an event_participation step targets an event, not a topic`);
        if (!events.has(step.event)) problems.push(`${at}: event "${step.event}" is not an event`);
        else problems.push(`${at}: event "${step.event}" has no price, and the API only accepts a priced event (EVENT_NOT_CHARGEABLE)`);
      } else if (step.topic !== undefined || step.event !== undefined) {
        problems.push(`${at}: a ${step.kind} step takes no topic or event`);
      }

      for (const problem of normalizeRequirementParams(step.kind, step.params, limits).problems) problems.push(`${at}: ${problem}`);
    }
  }
}

// -- extensions (Task 14): events, billing, tasks, comments -------------------

/** URL slug the events board accepts: lowercase kebab-case, at most 120 characters. */
const EVENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Invoice states a seeded invoice may start in (`void` is an admin action, not a demo state). */
export const SEEDED_INVOICE_STATUSES = ['open', 'paid'];
/** The comment body limit of `CreateCommentSchema` (comments.controller.ts). */
export const COMMENT_BODY_MAX = 2000;

/**
 * The relative-date rules make "past" and "upcoming" hold for ANY run time, not
 * just the day the dataset was written: an event starts `startsInDays` whole
 * UTC days from the run's date, at `startHourUtc`, and lasts `durationHours`
 * (null: open-ended, which the board treats as one day). With |days| ≥ 2 for a
 * past event and ≥ 1 for an upcoming one, `COALESCE(ends_at, starts_at + 1 day)`
 * lands on the intended side of `now` whatever the hour (see extensions.mjs).
 */
function validateEventDates(event, where, problems) {
  if (!Number.isInteger(event.startsInDays) || event.startsInDays === 0 || event.startsInDays === -1) {
    problems.push(`${where}: "startsInDays" must be an integer ≥ 1 (upcoming) or ≤ -2 (past)`);
  }
  if (!Number.isInteger(event.startHourUtc) || event.startHourUtc < 0 || event.startHourUtc > 23) {
    problems.push(`${where}: "startHourUtc" must be an integer 0..23`);
  }
  if (event.durationHours !== null && (!Number.isInteger(event.durationHours) || event.durationHours < 1 || event.durationHours > 24)) {
    problems.push(`${where}: "durationHours" must be null (open-ended) or an integer 1..24`);
  }
}

function validateExtensions(dataset, reference, { users, groups, topics, children }, problems) {
  const hasRole = (userKey, role) => users.get(userKey)?.roles?.includes(role) ?? false;

  // -- events -------------------------------------------------------------------
  const events = indexByKey(dataset.events, 'events', problems);
  const slugs = new Set();
  let past = 0;
  for (const [key, event] of events) {
    const where = `events["${key}"]`;
    if (typeof event.slug !== 'string' || event.slug.length > 120 || !EVENT_SLUG.test(event.slug)) {
      problems.push(`${where}: "slug" must be lowercase kebab-case, at most 120 characters`);
    } else if (slugs.has(event.slug)) {
      problems.push(`${where}: duplicate slug "${event.slug}" (events.slug is UNIQUE)`);
    }
    slugs.add(event.slug);
    if (!isNonEmptyString(event.title)) problems.push(`${where}: missing "title"`);
    for (const field of ['summary', 'content', 'location']) {
      if (event[field] !== undefined && typeof event[field] !== 'string') problems.push(`${where}: "${field}" must be a string`);
    }
    if (!reference.eventAudiences.includes(event.audience)) {
      problems.push(`${where}: unknown audience "${event.audience}" (known: ${reference.eventAudiences.join(', ')})`);
    }
    const grants = event.groups ?? [];
    if (!Array.isArray(grants)) problems.push(`${where}: "groups" must be an array`);
    else {
      for (const group of grants) if (!groups.has(group)) problems.push(`${where}: group "${group}" is not a group`);
      if (event.audience === 'restricted' && grants.length === 0) {
        problems.push(`${where}: a restricted event needs at least one group, or nobody can see it`);
      }
      if (event.audience !== 'restricted' && grants.length > 0) {
        problems.push(`${where}: only a restricted event takes "groups" (the audience already covers everyone else)`);
      }
    }
    validateEventDates(event, where, problems);
    if (event.startsInDays < 0) past += 1;
    if (!users.has(event.createdBy)) problems.push(`${where}: createdBy "${event.createdBy}" is not a user`);
  }
  if (events.size > 0) {
    for (const audience of reference.eventAudiences) {
      if (![...events.values()].some((event) => event.audience === audience)) problems.push(`events: no event with audience "${audience}"`);
    }
    if (past !== 1) problems.push(`events: exactly one event must be in the past (found ${past})`);
  }

  // -- billing --------------------------------------------------------------------
  const billing = dataset.billing ?? {};
  if (billing.currency !== reference.activeCurrency) {
    problems.push(`billing: currency "${billing.currency}" is not the active currency "${reference.activeCurrency}"`);
  }
  if (!hasRole(billing.signedBy, 'admin')) problems.push(`billing: signedBy "${billing.signedBy}" is not an admin user`);
  const plans = indexByKey(billing.plans ?? [], 'billing.plans', problems);
  for (const [key, plan] of plans) {
    const where = `billing.plans["${key}"]`;
    if (!isNonEmptyString(plan.name)) problems.push(`${where}: missing "name"`);
    if (!isNonNegativeInt(plan.amountMinor)) problems.push(`${where}: "amountMinor" must be a non-negative integer (minor units)`);
    if (!reference.billingCycles.includes(plan.cycle)) problems.push(`${where}: unknown cycle "${plan.cycle}"`);
    if (!isNonNegativeInt(plan.graceDays)) problems.push(`${where}: "graceDays" must be a non-negative integer`);
  }
  const subscriptions = indexByKey(billing.subscriptions ?? [], 'billing.subscriptions', problems);
  const subscribed = new Set();
  for (const [key, subscription] of subscriptions) {
    const where = `billing.subscriptions["${key}"]`;
    if (!hasRole(subscription.user, 'student')) problems.push(`${where}: user "${subscription.user}" is not a student user`);
    if (subscribed.has(subscription.user)) {
      problems.push(`${where}: "${subscription.user}" already has an active subscription (one active contract per user)`);
    }
    subscribed.add(subscription.user);
    const plan = plans.get(subscription.plan);
    if (!plan) problems.push(`${where}: plan "${subscription.plan}" is not a plan`);
    // The seed derives periods by whole calendar months from the 1st.
    else if (plan.cycle !== 'monthly') problems.push(`${where}: the demo seeds monthly contracts only (plan "${subscription.plan}" is ${plan.cycle})`);
    if (!Number.isInteger(subscription.dueDay) || subscription.dueDay < 1 || subscription.dueDay > 28) {
      problems.push(`${where}: "dueDay" must be an integer 1..28`);
    }
    if (!isNonNegativeInt(subscription.startMonthsAgo)) problems.push(`${where}: "startMonthsAgo" must be a non-negative integer`);
  }
  const invoices = indexByKey(billing.invoices ?? [], 'billing.invoices', problems);
  const periods = new Set();
  for (const [key, invoice] of invoices) {
    const where = `billing.invoices["${key}"]`;
    const subscription = subscriptions.get(invoice.subscription);
    if (!subscription) {
      problems.push(`${where}: subscription "${invoice.subscription}" is not a subscription`);
      continue;
    }
    if (!isNonNegativeInt(invoice.periodMonthsAgo) || invoice.periodMonthsAgo > subscription.startMonthsAgo) {
      problems.push(`${where}: "periodMonthsAgo" must be an integer 0..${subscription.startMonthsAgo} (not before the contract starts)`);
    }
    const period = `${invoice.subscription}@${invoice.periodMonthsAgo}`;
    if (periods.has(period)) problems.push(`${where}: a second invoice for the same period (invoices are UNIQUE per subscription and period)`);
    periods.add(period);
    if (!SEEDED_INVOICE_STATUSES.includes(invoice.status)) {
      problems.push(`${where}: status "${invoice.status}" (expected ${SEEDED_INVOICE_STATUSES.join(' or ')})`);
    }
    const payment = invoice.payment;
    if (invoice.status === 'paid') {
      if (!payment) problems.push(`${where}: a paid invoice needs its "payment"`);
      else {
        if (!reference.paymentMethods.includes(payment.method)) {
          problems.push(`${where}: unknown payment method "${payment.method}" (known: ${reference.paymentMethods.join(', ')})`);
        }
        // Paid within its own month, on or before the due date, of a past month:
        // never a payment dated in the future, whatever the day of the run.
        if (!(invoice.periodMonthsAgo >= 1)) problems.push(`${where}: a paid invoice must be for a past month ("periodMonthsAgo" ≥ 1)`);
        const earliest = 1 - (subscription.dueDay ?? 1);
        if (!Number.isInteger(payment.paidDaysAfterDue) || payment.paidDaysAfterDue > 0 || payment.paidDaysAfterDue < earliest) {
          problems.push(`${where}: payment "paidDaysAfterDue" must be an integer ${earliest}..0 (on or before the due date, within its month)`);
        }
        if (!(plans.get(subscription.plan)?.amountMinor > 0)) problems.push(`${where}: a payment needs a non-zero amount (payments.amount_minor <> 0)`);
      }
    } else if (payment !== undefined) {
      problems.push(`${where}: only a paid invoice carries a "payment"`);
    }
  }

  // -- tasks ----------------------------------------------------------------------
  const tasks = indexByKey(dataset.tasks, 'tasks', problems);
  for (const [key, task] of tasks) {
    const where = `tasks["${key}"]`;
    if (!isNonEmptyString(task.title)) problems.push(`${where}: missing "title"`);
    if (!users.has(task.createdBy)) problems.push(`${where}: createdBy "${task.createdBy}" is not a user`);
    for (const topic of task.topics ?? []) if (!topics.has(topic)) problems.push(`${where}: topic "${topic}" is not a topic`);
    const stages = indexByKey(task.stages, `${where}.stages`, problems);
    if (stages.size === 0) problems.push(`${where}: needs at least one stage`);
    for (const [stageKey, stage] of stages) {
      const at = `${where}.stages["${stageKey}"]`;
      if (!isNonEmptyString(stage.label)) problems.push(`${at}: missing "label"`);
      if (!topics.has(stage.topic)) problems.push(`${at}: topic "${stage.topic}" is not a topic`);
      else if (children.get(stage.topic).length > 0) problems.push(`${at}: topic "${stage.topic}" is not a lesson (a leaf)`);
    }
  }

  // -- comments -------------------------------------------------------------------
  const comments = dataset.comments ?? {};
  const entries = indexByKey(comments.entries ?? [], 'comments.entries', problems);
  for (const [key, comment] of entries) {
    const where = `comments.entries["${key}"]`;
    if (!topics.has(comment.topic)) problems.push(`${where}: topic "${comment.topic}" is not a topic`);
    if (!users.has(comment.user)) problems.push(`${where}: user "${comment.user}" is not a user`);
    if (!isNonEmptyString(comment.body) || comment.body.length > COMMENT_BODY_MAX || /<[^>]*>/.test(comment.body)) {
      problems.push(`${where}: "body" must be 1..${COMMENT_BODY_MAX} characters with no HTML (the API strips tags)`);
    }
    if (!isNonNegativeInt(comment.postedDaysAgo)) problems.push(`${where}: "postedDaysAgo" must be a non-negative integer`);
    if (comment.parent !== null) {
      const parent = entries.get(comment.parent);
      if (!parent) problems.push(`${where}: parent "${comment.parent}" is not a comment`);
      else {
        if (parent.parent !== null) problems.push(`${where}: a reply to a reply (the API forbids nested replies)`);
        if (parent.topic !== comment.topic) problems.push(`${where}: a reply on another topic than its parent`);
        if (comment.postedDaysAgo > parent.postedDaysAgo) problems.push(`${where}: a reply posted before its parent`);
      }
    }
  }
  const likes = new Set();
  for (const like of comments.likes ?? []) {
    const where = `comments.likes["${like?.comment}" by "${like?.user}"]`;
    const comment = entries.get(like?.comment);
    if (!comment) problems.push(`${where}: not a comment`);
    if (!users.has(like?.user)) problems.push(`${where}: not a user`);
    if (likes.has(`${like?.comment}|${like?.user}`)) problems.push(`${where}: duplicate like`);
    likes.add(`${like?.comment}|${like?.user}`);
    if (!isNonNegativeInt(like?.likedDaysAgo) || (comment && like.likedDaysAgo > comment.postedDaysAgo)) {
      problems.push(`${where}: "likedDaysAgo" must be a non-negative integer, not before the comment`);
    }
  }
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
    missionRequirements: dataset.gamification.missions.reduce((n, mission) => n + mission.requirements.length, 0),
    events: (dataset.events ?? []).length,
    billingPlans: (dataset.billing?.plans ?? []).length,
    subscriptions: (dataset.billing?.subscriptions ?? []).length,
    invoices: (dataset.billing?.invoices ?? []).length,
    tasks: (dataset.tasks ?? []).length,
    comments: (dataset.comments?.entries ?? []).length,
  };
}
