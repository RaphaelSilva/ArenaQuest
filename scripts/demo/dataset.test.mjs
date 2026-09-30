/**
 * Unit tests for scripts/demo/dataset.mjs — the baseline, the override merge
 * and every validation failure. No network, no wrangler.
 * Run with: node --test scripts/demo/dataset.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BASE_DATASET_PATH,
  DatasetError,
  datasetCounts,
  loadDataset,
  mergeDataset,
  readReference,
  readSampleTopic,
  renderTopicMarkdown,
  validateDataset,
} from './dataset.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const reference = readReference();
const base = () => JSON.parse(readFileSync(BASE_DATASET_PATH, 'utf8'));
const topic = (dataset, key) => dataset.topics.find((t) => t.key === key);

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
  assert.ok(reference.missionPredicates.includes('complete_topic'));
  assert.equal(reference.topicCompleteXp, 100);
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

test('rejects an unknown mission predicate', () => {
  const dataset = base();
  dataset.gamification.missions[0].predicateKind = 'topic_completed';
  assertRejects(dataset, /missions\["first-topic"\]: unknown predicateKind "topic_completed"/);
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
    missions: [{ key: 'first-topic', title: 'Primeiro tópico' }],
    media: {
      manifest: [{ ...original.media.manifest[0], key: 'label-image', fileName: 'label.jpg' }],
      assign: { 'root-1': ['label-image'] },
    },
  });
  assert.equal(merged.language, 'pt');
  assert.equal(topic(merged, 'root-1').title, 'Fundamentos');
  assert.equal(merged.users.find((u) => u.key === 'student-1').name, 'Aluno Um');
  assert.equal(merged.gamification.missions[0].title, 'Primeiro tópico');
  assert.deepEqual(merged.media.assign['root-1'], ['sample-image', 'label-image']);
  assert.equal(merged.media.manifest.length, 4);
  assert.equal(topic(original, 'root-1').title, base().topics[0].title, 'base is not mutated');
  validateDataset(merged, reference);
});

test('mergeDataset refuses to add users or topics, or to change structure', () => {
  assert.throws(() => mergeDataset(base(), { users: [{ key: 'student-4', name: 'X' }] }), /"student-4" is not in the baseline/);
  assert.throws(() => mergeDataset(base(), { topics: [{ key: 'root-1', visibility: 'private' }] }), /field "visibility" cannot be overridden/);
  assert.throws(() => mergeDataset(base(), { gamification: {} }), /section "gamification" cannot be overridden/);
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
    'packages/shared/domain/gamification/quest-evaluator.ts',
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
