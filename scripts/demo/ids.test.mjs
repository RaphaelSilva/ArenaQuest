/**
 * Unit tests for scripts/demo/ids.mjs — pure id derivation, no network.
 * Run with: node --test scripts/demo/ids.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEMO_NAMESPACE,
  UUID_V5_PATTERN,
  uuidV5,
  demoName,
  demoId,
  demoMediaKey,
  demoEmail,
  isDemoEmail,
  baseUserKeys,
  demoUserIds,
  listLabels,
} from './ids.mjs';

test('uuidV5 matches the published RFC 4122 test vector', () => {
  // DNS namespace + "www.example.com" — the value every UUID library agrees on.
  assert.equal(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
});

test('the demo namespace is a committed, fixed UUID', () => {
  assert.equal(DEMO_NAMESPACE, 'c3ad3071-4fc4-4d1f-aa84-8b6f71f9b0e1');
});

test('the same <label>:<entity>:<key> always yields the same id', () => {
  const a = demoId('budo', 'topic', 'root-2/module-1/lesson-2');
  const b = demoId('budo', 'topic', 'root-2/module-1/lesson-2');
  assert.equal(a, b);
  assert.equal(a, uuidV5(DEMO_NAMESPACE, 'budo:topic:root-2/module-1/lesson-2'));
});

test('different labels, entities or keys yield different ids', () => {
  const ids = new Set([
    demoId('budo', 'user', 'student-1'),
    demoId('spaziord', 'user', 'student-1'),
    demoId('arenaquest', 'user', 'student-1'),
    demoId('budo', 'group', 'student-1'),
    demoId('budo', 'user', 'student-2'),
  ]);
  assert.equal(ids.size, 5);
});

test('every id matches the UUID v5 format', () => {
  for (const label of ['budo', 'spaziord', 'arenaquest']) {
    for (const key of ['admin', 'root-1', 'root-3/module-2/lesson-1', 'ä unicode key']) {
      assert.match(demoId(label, 'topic', key), UUID_V5_PATTERN);
    }
  }
});

test('demoName rejects labels or entities that would make the name ambiguous', () => {
  assert.equal(demoName('budo', 'topic', 'a:b'), 'budo:topic:a:b');
  assert.throws(() => demoName('bu:do', 'topic', 'x'), /invalid label/);
  assert.throws(() => demoName('Budo', 'topic', 'x'), /invalid label/);
  assert.throws(() => demoName('budo', 'top:ic', 'x'), /invalid entity/);
  assert.throws(() => demoName('budo', 'topic', ''), /invalid key/);
  assert.throws(() => uuidV5('not-a-uuid', 'x'), /namespace/);
});

test('demoMediaKey ties a manifest file to one topic', () => {
  assert.equal(demoMediaKey('root-1/module-1', 'sample-pdf'), 'root-1/module-1@sample-pdf');
  assert.notEqual(
    demoId('budo', 'media', demoMediaKey('root-1', 'sample-image')),
    demoId('budo', 'media', demoMediaKey('root-2', 'sample-image')),
  );
});

test('demoEmail follows demo.<key>@<label>.demo.invalid', () => {
  assert.equal(demoEmail('budo', 'student-1'), 'demo.student-1@budo.demo.invalid');
  assert.equal(demoEmail('spaziord', 'admin'), 'demo.admin@spaziord.demo.invalid');
  assert.throws(() => demoEmail('budo', 'Bad Key'), /invalid demo user key/);
});

test('isDemoEmail matches any *.demo.invalid domain and nothing else', () => {
  assert.ok(isDemoEmail('demo.admin@budo.demo.invalid'));
  assert.ok(isDemoEmail('Demo.Admin@BUDO.DEMO.INVALID'));
  assert.ok(!isDemoEmail('admin@demo.invalid'));
  assert.ok(!isDemoEmail('demo.admin@budo.demo.invalid.example.com'));
  assert.ok(!isDemoEmail('someone@example.com'));
  assert.ok(!isDemoEmail(null));
});

test('demoUserIds covers every baseline user of a label', () => {
  const keys = baseUserKeys();
  assert.deepEqual(keys, ['admin', 'creator', 'tutor', 'student-1', 'student-2', 'student-3']);
  const ids = demoUserIds('budo');
  assert.equal(ids.length, 6);
  assert.deepEqual(ids, keys.map((key) => demoId('budo', 'user', key)));
  assert.equal(new Set([...ids, ...demoUserIds('spaziord')]).size, 12);
});

test('listLabels reads config/labels/*.jsonc only', () => {
  const root = mkdtempSync(join(tmpdir(), 'demo-ids-'));
  mkdirSync(join(root, 'config', 'labels', 'budo'), { recursive: true });
  writeFileSync(join(root, 'config', 'labels', 'budo.jsonc'), '{}');
  writeFileSync(join(root, 'config', 'labels', 'arenaquest.jsonc'), '{}');
  writeFileSync(join(root, 'config', 'labels', 'budo', 'demo.json'), '{}');
  writeFileSync(join(root, 'config', 'labels', 'README.md'), '');
  assert.deepEqual(listLabels(root), ['arenaquest', 'budo']);
});

test('listLabels finds the committed labels', () => {
  const labels = listLabels();
  for (const label of ['arenaquest', 'budo', 'spaziord']) assert.ok(labels.includes(label), label);
});
