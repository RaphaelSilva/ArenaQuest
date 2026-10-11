/**
 * scripts/mcp/audit.test.mjs — the audit trail's contract: one line per
 * record, bodies replaced by their byte length, credential-looking keys gone.
 *
 * Run: node --test scripts/mcp/audit.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BODY_KEYS, OUTCOMES, createAudit, redact } from './audit.mjs';

test('redact keeps ids, titles, paths and tags, and replaces bodies with their byte length', () => {
  const out = redact({
    id: 't1',
    title: 'Chūdan',
    path: '/home/op/video.mov',
    tags: ['Kata'],
    markdown: 'héllo', // 6 bytes in UTF-8
    content: '',
    body: 12,
  });
  assert.deepEqual(out, {
    id: 't1',
    title: 'Chūdan',
    path: '/home/op/video.mov',
    tags: ['Kata'],
    markdownBytes: 6,
    contentBytes: 0,
    bodyBytes: 0,
  });
  for (const key of BODY_KEYS) assert.equal(key in out, false, `${key} must not be written`);
});

test('redact drops any credential-looking key and never mutates its input', () => {
  const args = { id: 'x', password: 'hunter2', accessToken: 'abc', apiKey: 'k', Authorization: 'Bearer y', secretNote: 'z' };
  const out = redact(args);
  assert.deepEqual(out, { id: 'x' });
  assert.equal(args.password, 'hunter2');
});

test('redact answers {} for a non-object', () => {
  assert.deepEqual(redact(undefined), {});
  assert.deepEqual(redact(null), {});
  assert.deepEqual(redact('text'), {});
  assert.deepEqual(redact([1, 2]), {});
});

test('createAudit appends exactly one JSON line per record, with the redacted args and the error first line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-audit-'));
  const path = join(dir, 'nested', 'mcp-audit-budo-staging.jsonl');
  try {
    let tick = 0;
    const audit = createAudit(path, { now: () => new Date(Date.UTC(2026, 9, 11, 12, 0, tick++)) });
    assert.equal(existsSync(path), false);

    audit.record({ tool: 'create_topic_draft', args: { title: 'A', markdown: 'body text', password: 'nope' }, outcome: 'ok', durationMs: 12.6 });
    audit.record({ tool: 'update_topic_draft', args: { id: 't1' }, outcome: 'refused', durationMs: 3 });
    audit.record({ tool: 'read_topic', args: { id: 't2' }, outcome: 'error', durationMs: -1, error: 'HTTP 500 Boom: first line\nsecond line' });

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(lines.length, 3);
    const [first, second, third] = lines.map((line) => JSON.parse(line));

    assert.deepEqual(first, {
      at: '2026-10-11T12:00:00.000Z',
      tool: 'create_topic_draft',
      args: { title: 'A', markdownBytes: 9 },
      outcome: 'ok',
      durationMs: 13,
    });
    assert.equal(second.outcome, 'refused');
    assert.equal(second.durationMs, 3);
    assert.equal(third.outcome, 'error');
    assert.equal(third.durationMs, 0);
    assert.equal(third.error, 'HTTP 500 Boom: first line');

    // Nothing credential-shaped survives anywhere in the file.
    const raw = readFileSync(path, 'utf8');
    assert.equal(raw.includes('nope'), false);
    assert.equal(raw.includes('password'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createAudit rejects an unknown outcome and reports (does not throw) a write failure', () => {
  const errors = [];
  const audit = createAudit('/nowhere/audit.jsonl', {
    append: () => {
      throw new Error('disk full');
    },
    onError: (err) => errors.push(err.message),
  });
  assert.throws(() => audit.record({ tool: 'x', args: {}, outcome: 'maybe', durationMs: 1 }), /audit outcome must be one of/);
  const line = audit.record({ tool: 'x', args: {}, outcome: 'ok', durationMs: 1 });
  assert.equal(line.tool, 'x');
  assert.deepEqual(errors, ['disk full']);
  assert.deepEqual(OUTCOMES, ['ok', 'refused', 'error']);
});
