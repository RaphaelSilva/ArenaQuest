/**
 * Unit tests for scripts/demo/dataset.mjs — the baseline, the override merge
 * and every validation failure. No network, no wrangler.
 * Run with: node --test scripts/demo/dataset.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  BASE_DATASET_PATH,
  DatasetError,
  datasetCounts,
  loadDataset,
  mergeDataset,
  normalizeRequirementParams,
  readReference,
  readSampleTopic,
  renderTopicMarkdown,
  validateDataset,
} from './dataset.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const reference = readReference();
const base = () => JSON.parse(readFileSync(BASE_DATASET_PATH, 'utf8'));
const topic = (dataset, key) => dataset.topics.find((t) => t.key === key);
const mission = (dataset) => dataset.gamification.missions[0];
const step = (dataset, key) => mission(dataset).requirements.find((r) => r.key === key);

/**
 * packages/shared/domain/missions/requirements.ts itself, transpiled (zod
 * resolved from packages/shared) — the schemas the dataset rules mirror. Test
 * only: the scripts never import shared code (no build step).
 */
async function importRequirementsModule() {
  const require = createRequire(join(ROOT, 'packages', 'shared', 'package.json'));
  const ts = require('typescript');
  const source = readFileSync(join(ROOT, 'packages/shared/domain/missions/requirements.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const code = outputText.replace(/from ['"]zod['"]/, `from ${JSON.stringify(pathToFileURL(require.resolve('zod')).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** Asserts `validateDataset` fails with a problem matching `pattern`. */
function assertRejects(dataset, pattern) {
  assert.throws(
    () => validateDataset(dataset, reference),
    (error) => {
      assert.ok(error instanceof DatasetError, error);
      assert.ok(
        error.problems.some((problem) => pattern.test(problem)),
        `no problem matches ${pattern}:\n${error.problems.join('\n')}`,
      );
      return true;
    },
  );
}

// -- reference vocabularies ---------------------------------------------------

test('readReference reads the vocabularies from their owning files', () => {
  assert.deepEqual(reference.roles, ['admin', 'content_creator', 'tutor', 'student']);
  assert.ok(reference.quests.includes('weekly-topic'));
  assert.equal(reference.badges['alicerce-solido'], 250);
  assert.equal(reference.badges['tecnica-afiada'], 400);
  assert.equal(reference.mediaLimits['video/mp4'], 100 * 1024 * 1024);
  assert.deepEqual(reference.missionModes, ['parallel', 'sequential']);
  assert.deepEqual(reference.enrollmentModes, ['auto', 'open', 'assigned']);
  assert.deepEqual(reference.requirementKinds, ['submissions_on_topic', 'topic_visited', 'video_watched', 'manual_check', 'event_participation']);
  assert.deepEqual(reference.topicRequirementKinds, ['submissions_on_topic', 'topic_visited', 'video_watched']);
  assert.deepEqual(reference.requirementLimits, { stepsMax: 20, titleMax: 120, minCountMax: 50, instructionsMax: 500 });
  assert.equal(reference.topicCompleteXp, 100);
});

test('the mission vocabulary read as text is exactly what requirements.ts exports', async () => {
  const shared = await importRequirementsModule();
  assert.deepEqual(reference.requirementKinds, [...shared.REQUIREMENT_KINDS]);
  assert.deepEqual(reference.topicRequirementKinds, [...shared.TOPIC_REQUIREMENT_KINDS]);
  assert.deepEqual(reference.missionModes, shared.MissionMode.options);
  assert.deepEqual(reference.enrollmentModes, shared.MissionEnrollmentMode.options);
  assert.deepEqual(reference.requirementLimits, {
    stepsMax: shared.MISSION_STEPS_MAX,
    titleMax: shared.REQUIREMENT_TITLE_MAX,
    minCountMax: shared.REQUIREMENT_MIN_COUNT_MAX,
    instructionsMax: shared.MANUAL_CHECK_INSTRUCTIONS_MAX,
  });
  assert.deepEqual(Object.keys(shared.RequirementParams), reference.requirementKinds, 'a params rule per kind');
});

test('normalizeRequirementParams accepts, rejects and fills defaults exactly as RequirementParams[kind]', async () => {
  const shared = await importRequirementsModule();
  const cases = [
    ['submissions_on_topic', { minCount: 1 }],
    ['submissions_on_topic', { minCount: 1, requireDescription: true }],
    ['submissions_on_topic', { minCount: 50, visibility: 'shared_only', countModerated: true, requireDescription: false }],
    ['submissions_on_topic', { minCount: 0 }],
    ['submissions_on_topic', { minCount: 51 }],
    ['submissions_on_topic', { minCount: 1.5 }],
    ['submissions_on_topic', { minCount: '1' }],
    ['submissions_on_topic', {}],
    ['submissions_on_topic', { minCount: 1, visibility: 'public' }],
    ['submissions_on_topic', { minCount: 1, requireDescription: 'yes' }],
    ['submissions_on_topic', { minCount: 1, count: 1 }],
    ['topic_visited', {}],
    ['topic_visited', { count: 1 }],
    ['video_watched', { minCount: 3 }],
    ['video_watched', {}],
    ['video_watched', { minCount: 1, requireDescription: true }],
    ['manual_check', {}],
    ['manual_check', { instructions: '  Show your sensei the kata.  ' }],
    ['manual_check', { instructions: 'x'.repeat(500) }],
    ['manual_check', { instructions: 'x'.repeat(501) }],
    ['manual_check', { instructions: 7 }],
    ['event_participation', {}],
    ['event_participation', { eventId: 'x' }],
    ['topic_visited', []],
    ['topic_visited', null],
  ];
  for (const [kind, params] of cases) {
    const parsed = shared.RequirementParams[kind].safeParse(params);
    const ours = normalizeRequirementParams(kind, params, reference.requirementLimits);
    const label = `${kind} ${JSON.stringify(params)}`;
    assert.equal(ours.params !== null, parsed.success, `${label}: ${ours.problems.join('; ')}`);
    if (parsed.success) {
      assert.deepEqual(ours.problems, [], label);
      // Same values in the same key order: the stored JSON is byte-identical to the API's.
      assert.equal(JSON.stringify(ours.params), JSON.stringify(parsed.data), label);
    } else {
      assert.ok(ours.problems.length > 0, label);
    }
  }
  // Absent params are `{}`: valid exactly where the kind's schema defaults them.
  assert.deepEqual(normalizeRequirementParams('topic_visited', undefined, reference.requirementLimits), { params: {}, problems: [] });
  assert.equal(normalizeRequirementParams('video_watched', undefined, reference.requirementLimits).params, null);
});

// -- the baseline ---------------------------------------------------------------

test('loading the baseline for budo yields the RFC 0021 §3.2 counts', () => {
  const dataset = loadDataset('budo');
  assert.equal(dataset.label, 'budo');
  const counts = datasetCounts(dataset);
  assert.equal(counts.users, 6);
  assert.equal(counts.groups, 1);
  assert.equal(counts.topics, 21);
  assert.equal(counts.roots, 3);
  assert.equal(counts.tags, 2);
  assert.equal(counts.topicsWithMedia, 21);
  assert.equal(counts.missions, 1);
  assert.equal(counts.missionRequirements, 2);
});

test('the baseline mission is a parallel auto mission with typed steps on published topics', () => {
  const dataset = loadDataset('budo');
  const m = mission(dataset);
  assert.equal(m.key, 'first-topic');
  assert.equal(m.mode, 'parallel');
  assert.equal(m.enrollmentMode, 'auto');
  assert.equal(m.badge, 'tecnica-afiada');
  assert.equal(m.activeDays, 14);
  assert.ok(!('predicateKind' in m) && !('params' in m), 'no legacy predicate');
  assert.deepEqual(
    m.requirements.map(({ key, kind, topic: t, params, xpReward }) => ({ key, kind, topic: t, params, xpReward })),
    [
      { key: 'visit', kind: 'topic_visited', topic: 'root-1/module-1/lesson-1', params: {}, xpReward: 20 },
      { key: 'demo', kind: 'submissions_on_topic', topic: 'root-1/module-1/lesson-2', params: { minCount: 1, requireDescription: true }, xpReward: 50 },
    ],
  );
  for (const r of m.requirements) assert.equal(topic(dataset, r.topic).status, 'published', r.key);
});

test('every committed label loads', () => {
  for (const label of ['arenaquest', 'budo', 'spaziord']) {
    assert.equal(datasetCounts(loadDataset(label)).topics, 21, label);
  }
});

test('the baseline exercises every visibility path', () => {
  const dataset = base();
  const byRoot = (root) => dataset.topics.filter((t) => t.key === root || t.key.startsWith(`${root}/`));

  // Public does not cascade in the access resolver, so the whole Root 1 subtree is public.
  assert.ok(byRoot('root-1').every((t) => t.visibility === 'public'));
  assert.equal(topic(dataset, 'root-2').visibility, 'restricted');
  assert.equal(topic(dataset, 'root-3').visibility, 'restricted');
  assert.deepEqual(
    dataset.topics.filter((t) => t.visibility === 'private').map((t) => t.key),
    ['root-2/module-2/lesson-2'],
  );
  assert.equal(topic(dataset, 'root-3/module-2').status, 'draft');

  assert.deepEqual(dataset.groups[0].members, ['student-1', 'student-2']);
  assert.deepEqual(
    dataset.enrollments.map(({ topic: t, user, group }) => [t, user ?? group]),
    [['root-2', 'demo-class'], ['root-3', 'student-3']],
  );
});

test('the baseline mixes image, PDF and video, all public-domain and pinned', () => {
  const types = new Set(base().media.manifest.map((file) => file.type.split('/')[0]));
  assert.deepEqual([...types].sort(), ['application', 'image', 'video']);
});

test('the baseline gamification matches the RFC 0021 §3.4 table', () => {
  const [s1, s2, s3] = base().gamification.students;
  assert.equal(s1.expectedTotalXp, 350);
  assert.equal(s2.expectedTotalXp, 950);
  assert.equal(s3.expectedTotalXp, 0);
  assert.deepEqual(s1.quests, [{ slug: 'weekly-topic', current: 1 }]);
  assert.equal(s1.streakDays, 3);
});

// -- sample markdown --------------------------------------------------------------

test('sample-topic.md covers the whole basic syntax', () => {
  const md = readSampleTopic();
  const required = {
    'title slot': /^# \{\{title\}\}$/m,
    h2: /^## \S/m,
    h3: /^### \S/m,
    'hard line break': / {2}\n\S/,
    bold: /\*\*[^*]+\*\*/,
    italic: /(^|[^*])\*[^*\s][^*]*\*(?!\*)/m,
    'bold italic': /\*\*\*[^*]+\*\*\*/,
    blockquote: /^> \S/m,
    'nested blockquote': /^>> \S/m,
    'ordered list': /^1\. \S/m,
    'nested ordered list': /^ {3}1\. \S/m,
    'unordered list': /^- \S/m,
    'nested unordered list': /^ {2}- \S/m,
    'inline code': /`[^`\n]+`/,
    'fenced code block': /^```\w*\n[\s\S]+?\n```$/m,
    'horizontal rule': /^---$/m,
    link: /\[[^\]]+\]\(https:\/\/[^)]+\)/,
    'image link': /\[!\[[^\]]*\]\(https:\/\/[^)]+\)\]\(https:\/\/[^)]+\)/,
  };
  for (const [element, pattern] of Object.entries(required)) assert.match(md, pattern, element);
});

test('renderTopicMarkdown fills every {{title}} slot', () => {
  const rendered = renderTopicMarkdown('Lesson 1.1.1', 'a {{title}} b {{title}}');
  assert.equal(rendered, 'a Lesson 1.1.1 b Lesson 1.1.1');
  assert.ok(!renderTopicMarkdown('X').includes('{{title}}'));
});

// -- validation failures ----------------------------------------------------------

test('rejects an unknown role, naming the user', () => {
  const dataset = base();
  dataset.users[2].roles = ['sensei'];
  assertRejects(dataset, /users\["tutor"\]: unknown role "sensei"/);
});

test('rejects an unknown badge slug, naming the student', () => {
  const dataset = base();
  dataset.gamification.students[0].badges = ['golden-belt'];
  assertRejects(dataset, /students\["student-1"\]: unknown badge slug "golden-belt"/);
});

test('rejects an unknown mission badge slug, naming the mission', () => {
  const dataset = base();
  dataset.gamification.missions[0].badge = 'golden-belt';
  assertRejects(dataset, /missions\["first-topic"\]: unknown badge slug "golden-belt"/);
});

test('rejects an unknown quest slug, naming the student', () => {
  const dataset = base();
  dataset.gamification.students[0].quests = [{ slug: 'monthly-topic', current: 1 }];
  assertRejects(dataset, /students\["student-1"\]: unknown quest slug "monthly-topic"/);
});

test('rejects a legacy predicate on a mission', () => {
  const dataset = base();
  mission(dataset).predicateKind = 'complete_topic';
  assertRejects(dataset, /missions\["first-topic"\]: field "predicateKind" is not a mission field/);
});

test('rejects an unknown mode, an unknown enrollment mode and an assigned mission', () => {
  let dataset = base();
  mission(dataset).mode = 'random';
  assertRejects(dataset, /missions\["first-topic"\]: unknown mode "random"/);
  dataset = base();
  delete mission(dataset).enrollmentMode;
  assertRejects(dataset, /missions\["first-topic"\]: unknown enrollmentMode "undefined"/);
  dataset = base();
  mission(dataset).enrollmentMode = 'assigned';
  assertRejects(dataset, /missions\["first-topic"\]: enrollmentMode "assigned" needs an audience/);
  dataset = base();
  mission(dataset).enrollmentMode = 'open';
  mission(dataset).mode = 'sequential';
  validateDataset(dataset, reference);
});

test('rejects a mission with no requirement, or more than the step limit', () => {
  let dataset = base();
  mission(dataset).requirements = [];
  assertRejects(dataset, /missions\["first-topic"\]: needs 1\.\.20 requirements \(has 0\)/);
  dataset = base();
  mission(dataset).requirements = Array.from({ length: 21 }, (_, i) => ({ ...step(dataset, 'visit'), key: `visit-${i}` }));
  assertRejects(dataset, /needs 1\.\.20 requirements \(has 21\)/);
  dataset = base();
  delete mission(dataset).requirements;
  assertRejects(dataset, /missions\["first-topic"\]\.requirements: must be an array/);
});

test('rejects an unknown requirement kind, naming the step', () => {
  const dataset = base();
  step(dataset, 'demo').kind = 'complete_topic';
  assertRejects(dataset, /missions\["first-topic"\]\.requirements\["demo"\]: unknown kind "complete_topic"/);
});

test('rejects invalid requirement params: minCount 0, an extra key, a bad visibility', () => {
  let dataset = base();
  step(dataset, 'demo').params.minCount = 0;
  assertRejects(dataset, /requirements\["demo"\]: params "minCount" must be an integer 1\.\.50 \(got 0\)/);
  dataset = base();
  step(dataset, 'demo').params.count = 1;
  assertRejects(dataset, /requirements\["demo"\]: params "count" is not a parameter of submissions_on_topic/);
  dataset = base();
  step(dataset, 'visit').params = { count: 1 };
  assertRejects(dataset, /requirements\["visit"\]: params "count" is not a parameter of topic_visited/);
  dataset = base();
  step(dataset, 'demo').params.visibility = 'public';
  assertRejects(dataset, /requirements\["demo"\]: params "visibility" must be one of any, shared_only/);
});

test('rejects an unknown, unpublished or video-less topic target, naming the step', () => {
  let dataset = base();
  step(dataset, 'demo').topic = 'root-9/module-1/lesson-1';
  assertRejects(dataset, /requirements\["demo"\]: topic "root-9\/module-1\/lesson-1" is not a topic/);
  dataset = base();
  step(dataset, 'visit').topic = 'root-3/module-2/lesson-1';
  assertRejects(dataset, /requirements\["visit"\]: topic "root-3\/module-2\/lesson-1" is draft/);
  dataset = base();
  Object.assign(step(dataset, 'visit'), { kind: 'video_watched', topic: 'root-1/module-1/lesson-2', params: { minCount: 1 } });
  assertRejects(dataset, /requirements\["visit"\]: topic "root-1\/module-1\/lesson-2" has no video/);
  dataset = base();
  Object.assign(step(dataset, 'visit'), { kind: 'video_watched', topic: 'root-1/module-1/lesson-1', params: { minCount: 1 } });
  validateDataset(dataset, reference);
});

test('rejects a target that does not fit the kind, and an event step the demo cannot price', () => {
  let dataset = base();
  Object.assign(step(dataset, 'visit'), { kind: 'manual_check', params: { instructions: 'Ask your tutor' } });
  assertRejects(dataset, /requirements\["visit"\]: a manual_check step takes no topic or event/);
  dataset = base();
  step(dataset, 'visit').event = 'open-class';
  assertRejects(dataset, /requirements\["visit"\]: a topic_visited step targets a topic, not an event/);
  dataset = base();
  step(dataset, 'visit').kind = 'event_participation';
  delete step(dataset, 'visit').topic;
  step(dataset, 'visit').event = 'ghost-event';
  assertRejects(dataset, /requirements\["visit"\]: event "ghost-event" is not an event/);
  step(dataset, 'visit').event = 'open-class';
  assertRejects(dataset, /requirements\["visit"\]: event "open-class" has no price/);
  dataset = base();
  const manual = { key: 'check', kind: 'manual_check', title: 'Bow to the dojo', params: {} };
  mission(dataset).requirements.push(manual);
  validateDataset(dataset, reference);
});

test('rejects a requirement title out of bounds, an unknown field, a negative XP and a duplicate key', () => {
  let dataset = base();
  step(dataset, 'demo').title = '   ';
  assertRejects(dataset, /requirements\["demo"\]: "title" must be 1\.\.120 characters/);
  dataset = base();
  step(dataset, 'demo').title = 'x'.repeat(121);
  assertRejects(dataset, /requirements\["demo"\]: "title" must be 1\.\.120 characters/);
  dataset = base();
  step(dataset, 'demo').topicId = 'x';
  assertRejects(dataset, /requirements\["demo"\]: field "topicId" is not a requirement field/);
  dataset = base();
  step(dataset, 'demo').xpReward = -1;
  assertRejects(dataset, /requirements\["demo"\]: "xpReward" must be a non-negative integer/);
  dataset = base();
  mission(dataset).requirements.push({ ...step(dataset, 'demo') });
  assertRejects(dataset, /missions\["first-topic"\]\.requirements\["demo"\]: duplicate key/);
});

test('rejects a disallowed MIME type, naming the manifest entry', () => {
  const dataset = base();
  dataset.media.manifest[0].type = 'image/gif';
  assertRejects(dataset, /media\.manifest\["sample-image"\]: type "image\/gif" is not allowed/);
});

test('rejects a file over its type limit', () => {
  const dataset = base();
  dataset.media.manifest[0].sizeBytes = 6 * 1024 * 1024;
  assertRejects(dataset, /media\.manifest\["sample-image"\]: sizeBytes/);
});

test('rejects a license that is not CC0 or public domain', () => {
  const dataset = base();
  dataset.media.manifest[1].license = 'CC-BY-4.0';
  assertRejects(dataset, /media\.manifest\["sample-pdf"\]: license "CC-BY-4.0"/);
});

test('rejects an unpinned sha256', () => {
  const dataset = base();
  dataset.media.manifest[2].sha256 = null;
  assertRejects(dataset, /media\.manifest\["sample-video"\]: "sha256"/);
});

test('rejects a tree deeper than 3, naming the topic', () => {
  const dataset = base();
  dataset.topics.push({ ...topic(dataset, 'root-1/module-1/lesson-1'), key: 'root-1/module-1/lesson-1/extra', parent: 'root-1/module-1/lesson-1' });
  dataset.media.assign['root-1/module-1/lesson-1/extra'] = ['sample-image'];
  assertRejects(dataset, /topics\["root-1\/module-1\/lesson-1\/extra"\]: depth 4 exceeds 3/);
});

test('rejects a tree shallower than 3, naming the leaf', () => {
  const dataset = base();
  dataset.topics = dataset.topics.filter((t) => !t.key.startsWith('root-1/module-2/'));
  assertRejects(dataset, /topics\["root-1\/module-2"\]: leaf at depth 2/);
});

test('rejects a parent cycle', () => {
  const dataset = base();
  topic(dataset, 'root-1').parent = 'root-1/module-1/lesson-1';
  assertRejects(dataset, /cycle|no root topic/);
});

test('rejects a topic with no media, naming the topic', () => {
  const dataset = base();
  delete dataset.media.assign['root-2/module-1/lesson-2'];
  assertRejects(dataset, /topics\["root-2\/module-1\/lesson-2"\]: has no media/);
});

test('rejects a media assignment to an unknown manifest key', () => {
  const dataset = base();
  dataset.media.assign['root-1'] = ['sample-audio'];
  assertRejects(dataset, /media\.assign\["root-1"\]: "sample-audio" is not in the manifest/);
});

test('rejects dangling user, group and topic references', () => {
  const dataset = base();
  dataset.groups[0].members.push('student-9');
  dataset.enrollments[0].group = 'ghost-class';
  dataset.enrollments[1].topic = 'root-9';
  const error = (() => {
    try {
      validateDataset(dataset, reference);
    } catch (caught) {
      return caught;
    }
    return null;
  })();
  assert.ok(error instanceof DatasetError);
  const text = error.problems.join('\n');
  assert.match(text, /groups\["demo-class"\]: member "student-9"/);
  assert.match(text, /enrollments\["root-2@demo-class"\]: group "ghost-class"/);
  assert.match(text, /enrollments\["root-3@student-3"\]: topic "root-9"/);
});

test('rejects an expectedTotalXp that disagrees with the events', () => {
  const dataset = base();
  dataset.gamification.students[1].expectedTotalXp = 1000;
  assertRejects(dataset, /students\["student-2"\]: expectedTotalXp 1000 but its events sum to 950/);
});

test('rejects a password, hash or secret anywhere in the dataset', () => {
  const dataset = base();
  dataset.users[0].passwordHash = 'pbkdf2:100000:aa:bb';
  assertRejects(dataset, /users\[0\]\.passwordHash: no password/);
});

test('rejects duplicate keys', () => {
  const dataset = base();
  dataset.users.push({ ...dataset.users[0] });
  assertRejects(dataset, /users\["admin"\]: duplicate key/);
});

// -- label override ---------------------------------------------------------------

test('mergeDataset renames entries and adds media without touching the base', () => {
  const original = base();
  const merged = mergeDataset(original, {
    language: 'pt',
    topics: [{ key: 'root-1', title: 'Fundamentos' }],
    users: [{ key: 'student-1', name: 'Aluno Um' }],
    missions: [{ key: 'first-topic', title: 'Primeiros passos', requirements: [{ key: 'demo', title: 'Compartilhe uma demonstração' }] }],
    media: {
      manifest: [{ ...original.media.manifest[0], key: 'label-image', fileName: 'label.jpg' }],
      assign: { 'root-1': ['label-image'] },
    },
  });
  assert.equal(merged.language, 'pt');
  assert.equal(topic(merged, 'root-1').title, 'Fundamentos');
  assert.equal(merged.users.find((u) => u.key === 'student-1').name, 'Aluno Um');
  assert.equal(merged.gamification.missions[0].title, 'Primeiros passos');
  assert.equal(step(merged, 'demo').title, 'Compartilhe uma demonstração');
  assert.equal(step(merged, 'visit').title, step(original, 'visit').title);
  assert.equal(step(original, 'demo').title, 'Share one demonstration', 'base is not mutated');
  assert.deepEqual(merged.media.assign['root-1'], ['sample-image', 'label-image']);
  assert.equal(merged.media.manifest.length, 4);
  assert.equal(topic(original, 'root-1').title, base().topics[0].title, 'base is not mutated');
  validateDataset(merged, reference);
});

test('mergeDataset refuses to add users or topics, or to change structure', () => {
  assert.throws(() => mergeDataset(base(), { users: [{ key: 'student-4', name: 'X' }] }), /"student-4" is not in the baseline/);
  assert.throws(() => mergeDataset(base(), { topics: [{ key: 'root-1', visibility: 'private' }] }), /field "visibility" cannot be overridden/);
  assert.throws(() => mergeDataset(base(), { gamification: {} }), /section "gamification" cannot be overridden/);
  assert.throws(
    () => mergeDataset(base(), { missions: [{ key: 'first-topic', requirements: [{ key: 'demo', kind: 'manual_check' }] }] }),
    /override\.missions\["first-topic"\]\.requirements\["demo"\]: field "kind" cannot be overridden/,
  );
  assert.throws(
    () => mergeDataset(base(), { missions: [{ key: 'first-topic', requirements: [{ key: 'extra', title: 'X' }] }] }),
    /override\.missions\["first-topic"\]\.requirements: "extra" is not in the baseline/,
  );
  assert.throws(() => mergeDataset(base(), { missions: [{ key: 'first-topic', mode: 'sequential' }] }), /field "mode" cannot be overridden/);
  assert.throws(() => mergeDataset(base(), { media: { assign: { 'root-9': ['sample-image'] } } }), /"root-9" is not a baseline topic/);
});

/** A throwaway checkout holding just what the loader reads. */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'demo-dataset-'));
  for (const rel of [
    'apps/api/migrations/0002_seed_roles.sql',
    'apps/api/migrations/0019_seed_quests.sql',
    'apps/api/migrations/0021_seed_badges.sql',
    'apps/api/migrations/0026_create_billing_tables.sql',
    'apps/api/migrations/0027_create_events.sql',
    'packages/shared/domain/media/limits.ts',
    'packages/shared/domain/missions/requirements.ts',
    'packages/shared/domain/gamification/xp-config.ts',
  ]) {
    cpSync(join(ROOT, rel), join(root, rel));
  }
  mkdirSync(join(root, 'config', 'labels', 'budo'), { recursive: true });
  return root;
}

test('loadDataset merges config/labels/<label>/demo.json and validates the result', () => {
  const root = fixtureRoot();
  writeFileSync(join(root, 'config/labels/budo/demo.json'), JSON.stringify({ language: 'pt', topics: [{ key: 'root-1', title: 'Kihon' }] }));
  const dataset = loadDataset('budo', { repoRoot: root });
  assert.equal(dataset.language, 'pt');
  assert.equal(topic(dataset, 'root-1').title, 'Kihon');
  assert.equal(loadDataset('spaziord', { repoRoot: root }).language, 'en', 'no override → baseline');
});

test('loadDataset rejects an override that breaks validation, naming the entry', () => {
  const root = fixtureRoot();
  const bad = base().media.manifest[0];
  writeFileSync(
    join(root, 'config/labels/budo/demo.json'),
    JSON.stringify({ media: { manifest: [{ ...bad, key: 'gif', type: 'image/gif' }], assign: { 'root-1': ['gif'] } } }),
  );
  assert.throws(() => loadDataset('budo', { repoRoot: root }), /media\.manifest\["gif"\]: type "image\/gif"/);
});

test('loadDataset reports a malformed override file', () => {
  const root = fixtureRoot();
  writeFileSync(join(root, 'config/labels/budo/demo.json'), '{ nope');
  assert.throws(() => loadDataset('budo', { repoRoot: root }), /demo\.json/);
});
