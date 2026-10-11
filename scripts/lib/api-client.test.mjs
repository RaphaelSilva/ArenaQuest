/**
 * scripts/lib/api-client.test.mjs — focused tests for the shared API client.
 *
 * The exhaustive behaviour of these functions is still asserted by
 * scripts/content/import-media.test.mjs through the importer's re-exports;
 * this suite pins the library's own contract: the retry rule, the login +
 * bearer flow, the media preflight states, the upload lifecycle against a
 * ledger, the loopback rule for `AQ_API_BASE_URL`, and the fact that the
 * importer re-exports the SAME objects (a test that mutates
 * `SIZE_LIMIT_BYTES` in place must see it through both paths).
 *
 * Run: node --test scripts/lib/api-client.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  API_ENVS,
  ApiError,
  CONTENT_TYPE_BY_EXTENSION,
  DEFAULT_ATTEMPTS,
  MAX_FILE_NAME_LENGTH,
  SIZE_LIMIT_BYTES,
  SKIP_STATES,
  appendLedger,
  contentTypeFor,
  createApiClient,
  formatBytes,
  ledgerPathFor,
  nextAction,
  readLedger,
  resolveBaseUrl,
  runPool,
  summariseHtmlError,
  uploadFile,
  validateMediaFile,
  withRetry,
} from './api-client.mjs';
import * as importer from '../content/import-media.mjs';

/** A minimal `fetch` Response stand-in: status, optional headers, body text. */
function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'aq-api-client-test-'));
}

// -- re-exports keep identity -------------------------------------------------

test('the importer re-exports the very same objects and functions', () => {
  // Identity, not equality: import-media.test.mjs patches SIZE_LIMIT_BYTES in
  // place, which only reaches the library when both names point at one object.
  assert.equal(importer.SIZE_LIMIT_BYTES, SIZE_LIMIT_BYTES);
  assert.equal(importer.CONTENT_TYPE_BY_EXTENSION, CONTENT_TYPE_BY_EXTENSION);
  assert.equal(importer.SKIP_STATES, SKIP_STATES);
  assert.equal(importer.ApiError, ApiError);
  assert.equal(importer.withRetry, withRetry);
  assert.equal(importer.createApiClient, createApiClient);
  assert.equal(importer.uploadFile, uploadFile);
  assert.equal(importer.validateMediaFile, validateMediaFile);
  assert.equal(importer.contentTypeFor, contentTypeFor);
  assert.equal(importer.resolveBaseUrl, resolveBaseUrl);
  assert.equal(importer.runPool, runPool);
  assert.equal(importer.formatBytes, formatBytes);
  assert.equal(importer.readLedger, readLedger);
  assert.equal(importer.appendLedger, appendLedger);
  assert.equal(importer.ledgerPathFor, ledgerPathFor);
  assert.equal(importer.nextAction, nextAction);
  assert.equal(importer.summariseHtmlError, summariseHtmlError);
});

test('constants carry the documented defaults', () => {
  assert.deepEqual(API_ENVS, ['staging', 'production']);
  assert.equal(DEFAULT_ATTEMPTS, 3);
  assert.equal(MAX_FILE_NAME_LENGTH, 255);
});

// -- withRetry ----------------------------------------------------------------

test('withRetry retries a 5xx with exponential backoff and then succeeds', async () => {
  const sleeps = [];
  const retries = [];
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new ApiError(503, 'Unavailable', null, null);
      return 'done';
    },
    { sleepImpl: async (ms) => sleeps.push(ms), onRetry: (err, attempt, backoff) => retries.push([err.status, attempt, backoff]) },
  );
  assert.equal(result, 'done');
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [500, 1000]);
  assert.deepEqual(retries, [[503, 1, 500], [503, 2, 1000]]);
});

test('withRetry throws the last error once the attempts are exhausted', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new ApiError(502, 'BadGateway', null, null);
      },
      { attempts: 2, sleepImpl: async () => {} },
    ),
    (err) => err instanceof ApiError && err.status === 502,
  );
  assert.equal(calls, 2);
});

test('withRetry never retries a 4xx: that is a decision, not a glitch', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new ApiError(400, 'BadRequest', 'nope', null);
      },
      { sleepImpl: async () => assert.fail('must not sleep') },
    ),
    /HTTP 400 BadRequest: nope/,
  );
  assert.equal(calls, 1);
});

test('withRetry honours Retry-After on a 429', async () => {
  const sleeps = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls += 1;
      if (calls === 1) {
        const err = new ApiError(429, 'RateLimited', null, null);
        err.retryAfterMs = 7000;
        throw err;
      }
      return null;
    },
    { sleepImpl: async (ms) => sleeps.push(ms) },
  );
  assert.deepEqual(sleeps, [7000]);
});

// -- createApiClient ----------------------------------------------------------

test('createApiClient logs in once and sends the bearer token on every call', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/auth/login')) {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { email: 'ops@example.invalid', password: 'pw' });
      return jsonResponse(200, { accessToken: 'tok-1', user: { email: 'ops@example.invalid' } });
    }
    return jsonResponse(200, { data: [] });
  };

  const client = createApiClient({ baseUrl: 'https://api.example.invalid', email: 'ops@example.invalid', password: 'pw', fetchImpl });
  const user = await client.login();
  assert.equal(user.email, 'ops@example.invalid');

  const listed = await client.request('GET', '/v1/admin/topics');
  assert.deepEqual(listed, { data: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api.example.invalid/v1/admin/topics');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tok-1');
  assert.equal(calls[1].init.body, undefined, 'a GET carries no body');
});

test('createApiClient re-authenticates once on a 401 and surfaces the API error envelope', async () => {
  let logins = 0;
  const tokensSeen = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/v1/auth/login')) {
      logins += 1;
      return jsonResponse(200, { accessToken: `tok-${logins}` });
    }
    tokensSeen.push(init.headers.Authorization);
    if (tokensSeen.length === 1) return jsonResponse(401, { error: 'Unauthorized' });
    if (url.endsWith('/boom')) return jsonResponse(422, { error: 'UploadMismatch', detail: 'size differs' });
    return jsonResponse(201, { id: 'new' });
  };
  const client = createApiClient({ baseUrl: 'https://api.example.invalid', email: 'e', password: 'p', fetchImpl });

  const created = await client.request('POST', '/v1/admin/topics', { body: { title: 'x' }, expectStatus: 201 });
  assert.deepEqual(created, { id: 'new' });
  assert.equal(logins, 2, 'the 401 triggered exactly one re-login');
  assert.deepEqual(tokensSeen, ['Bearer tok-1', 'Bearer tok-2']);

  await assert.rejects(client.request('POST', '/boom'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 422);
    assert.equal(err.code, 'UploadMismatch');
    assert.equal(err.message, 'HTTP 422 UploadMismatch: size differs');
    return true;
  });
});

test('createApiClient condenses an HTML error page into one line', async () => {
  const html = '<!DOCTYPE html><html><head><title>Worker threw exception | api</title></head><body>error code: 1101</body></html>';
  const fetchImpl = async (url) =>
    url.endsWith('/v1/auth/login')
      ? jsonResponse(200, { accessToken: 't' })
      : { ok: false, status: 500, headers: { get: () => null }, text: async () => html };
  const client = createApiClient({ baseUrl: 'https://api.example.invalid', email: 'e', password: 'p', fetchImpl });
  await assert.rejects(client.request('GET', '/x'), /NonJsonResponse: Worker threw exception \| api — Cloudflare error 1101/);
  assert.equal(summariseHtmlError('<p>plain</p>'), 'an HTML error page (not JSON)');
});

// -- validateMediaFile --------------------------------------------------------

test('validateMediaFile answers one stable state per refusal', () => {
  assert.deepEqual(validateMediaFile({ fileName: 'clip.MP4', sizeBytes: 10 }), { ok: true, contentType: 'video/mp4' });

  assert.equal(validateMediaFile({ fileName: 'notes.txt', sizeBytes: 10 }).state, SKIP_STATES.INVALID_TYPE);
  assert.match(validateMediaFile({ fileName: 'notes.txt', sizeBytes: 10 }).reason, /unsupported extension "\.txt"/);
  assert.equal(validateMediaFile({ fileName: 'noext', sizeBytes: 10 }).reason.includes('"(none)"'), true);

  assert.equal(
    validateMediaFile({ fileName: 'Doc', sizeBytes: 10, mimeType: 'application/vnd.google-apps.document' }).state,
    SKIP_STATES.GOOGLE_DOC,
  );

  assert.equal(validateMediaFile({ fileName: 'empty.pdf', sizeBytes: 0 }).state, SKIP_STATES.EMPTY);

  const tooLarge = validateMediaFile({ fileName: 'big.pdf', sizeBytes: SIZE_LIMIT_BYTES['application/pdf'] + 1 });
  assert.equal(tooLarge.state, SKIP_STATES.TOO_LARGE);
  assert.match(tooLarge.reason, /exceeds the API limit of 25 MB for application\/pdf/);

  const longName = `${'a'.repeat(MAX_FILE_NAME_LENGTH)}.png`;
  assert.equal(validateMediaFile({ fileName: longName, sizeBytes: 10 }).state, SKIP_STATES.NAME_TOO_LONG);

  // NO_TOPIC and MISSING are decided by the plan builders, not by the preflight.
  assert.deepEqual(Object.values(SKIP_STATES).sort(), [
    'empty', 'google-doc', 'invalid-type', 'missing', 'name-too-long', 'no-topic', 'too-large',
  ]);
});

test('contentTypeFor and formatBytes follow the API wording', () => {
  assert.equal(contentTypeFor('a/b/Photo.JPEG'), 'image/jpeg');
  assert.equal(contentTypeFor('a.mov'), null);
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(100 * 1024 * 1024), '100 MB');
});

// -- ledger -------------------------------------------------------------------

test('the ledger is append-only, last write wins, and tolerates a torn line', () => {
  const dir = tempDir();
  try {
    const path = ledgerPathFor('budo', 'staging', join(dir, 'nested', 'ledger.jsonl'));
    assert.equal(readLedger(path).size, 0, 'a missing ledger reads as empty');
    appendLedger(path, { key: 'a', state: 'presigned', revision: 'r1' });
    appendLedger(path, { key: 'a', state: 'ready', revision: 'r1' });
    appendLedger(path, { relPath: 'legacy.mp4', state: 'ready', sizeBytes: 5, mtimeMs: 7 });
    const entries = readLedger(path);
    assert.equal(entries.get('a').state, 'ready');
    assert.equal(entries.get('legacy.mp4').state, 'ready', 'relPath is accepted as the key for pre-Drive ledgers');
    assert.equal(nextAction(entries.get('a'), { revision: 'r1' }), 'skip');
    assert.equal(nextAction(entries.get('a'), { revision: 'r2' }), 'replace');
    assert.equal(nextAction(entries.get('legacy.mp4'), { revision: '5:7' }), 'skip');
    assert.equal(nextAction(undefined, { revision: 'r1' }), 'presign');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(ledgerPathFor('budo', 'staging'), join('.arenaquest', 'import-budo-staging.jsonl'));
});

// -- uploadFile ---------------------------------------------------------------

test('uploadFile runs presign -> PUT -> finalize and writes the ledger after each step', async () => {
  const dir = tempDir();
  try {
    const ledgerPath = join(dir, 'ledger.jsonl');
    const requests = [];
    const client = {
      request: async (method, path, options) => {
        requests.push({ method, path, options });
        if (path.endsWith('/media/presign')) {
          return { media: { id: 'm1', storageKey: 'topics/t1/m1.mp4' }, uploadUrl: 'https://r2.example.invalid/signed' };
        }
        if (path.endsWith('/finalize')) return { id: 'm1', status: 'ready' };
        throw new Error(`unexpected ${method} ${path}`);
      },
    };
    const puts = [];
    const fetchImpl = async (url, init) => {
      puts.push({ url, init });
      return { ok: true, status: 200, text: async () => '' };
    };
    const bytes = Buffer.from('abcdef');
    const file = { key: 'k1', relPath: 'Kata/clip.mp4', fileName: 'clip.mp4', contentType: 'video/mp4', sizeBytes: 6, revision: 'r1' };

    const outcome = await uploadFile(client, { file, topicId: 't1', ledgerPath, entry: undefined, readBytes: async () => bytes, fetchImpl });

    assert.equal(outcome.outcome, 'uploaded');
    assert.deepEqual(outcome.media, { id: 'm1', status: 'ready' });
    assert.deepEqual(
      requests.map((r) => `${r.method} ${r.path}`),
      ['POST /v1/admin/topics/t1/media/presign', 'POST /v1/admin/topics/t1/media/m1/finalize'],
    );
    assert.deepEqual(requests[0].options.body, { fileName: 'clip.mp4', contentType: 'video/mp4', sizeBytes: 6 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].url, 'https://r2.example.invalid/signed');
    assert.equal(puts[0].init.method, 'PUT');
    assert.deepEqual(puts[0].init.headers, { 'Content-Type': 'video/mp4', 'Content-Length': '6' });
    assert.equal(puts[0].init.body, bytes, 'the PUT body is the exact buffer, never a stream');

    const states = [...readLedger(ledgerPath).values()].map((entry) => entry.state);
    assert.deepEqual(states, ['ready'], 'last write wins');
    const lines = (await import('node:fs')).readFileSync(ledgerPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.state), ['presigned', 'uploaded', 'ready']);
    assert.equal(lines[0].storageKey, 'topics/t1/m1.mp4');
    assert.ok(lines.every((line) => line.key === 'k1' && line.mediaId === 'm1' && line.topicId === 't1'));

    // A second run over the same ledger entry is a no-op.
    const again = await uploadFile(client, { file, topicId: 't1', ledgerPath, entry: readLedger(ledgerPath).get('k1'), readBytes: async () => bytes, fetchImpl });
    assert.deepEqual(again, { relPath: 'Kata/clip.mp4', outcome: 'skipped' });
    assert.equal(requests.length, 2, 'no further API call');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uploadFile refuses a file that changed between the scan and the read', async () => {
  const dir = tempDir();
  try {
    const client = {
      request: async (method, path) => {
        if (path.endsWith('/media/presign')) return { media: { id: 'm1', storageKey: 'k' }, uploadUrl: 'https://r2.example.invalid/s' };
        throw new Error(`unexpected ${method} ${path}`);
      },
    };
    const file = { key: 'k', relPath: 'a.pdf', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 3, revision: 'r' };
    await assert.rejects(
      uploadFile(client, { file, topicId: 't', ledgerPath: join(dir, 'l.jsonl'), readBytes: async () => Buffer.from('abcd'), fetchImpl: async () => assert.fail('no PUT') }),
      /changed at the source during the run \(3 -> 4 bytes\)/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -- runPool ------------------------------------------------------------------

test('runPool bounds concurrency, keeps order and never rejects', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await runPool([1, 2, 3, 4, 5], 2, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((done) => setTimeout(done, 2));
    inFlight -= 1;
    if (item === 3) throw new Error('three');
    return item * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results.map((r) => (r.ok ? r.value : r.error.message)), [10, 20, 'three', 40, 50]);
  assert.deepEqual(results.map((r) => r.item), [1, 2, 3, 4, 5]);
});

// -- resolveBaseUrl -----------------------------------------------------------

test('resolveBaseUrl accepts AQ_API_BASE_URL only on loopback and otherwise reads the profile', () => {
  assert.equal(resolveBaseUrl('budo', 'staging', { override: 'http://localhost:8787/' }), 'http://localhost:8787');
  assert.equal(resolveBaseUrl('budo', 'staging', { override: 'http://127.0.0.1:8787' }), 'http://127.0.0.1:8787');
  assert.throws(
    () => resolveBaseUrl('budo', 'staging', { override: 'https://api-budo.example.invalid' }),
    /AQ_API_BASE_URL may only point at localhost \(got "api-budo.example.invalid"\)/,
  );
  const fromProfile = resolveBaseUrl('budo', 'staging', { override: undefined });
  assert.match(fromProfile, /^https:\/\/[^/]+$/, 'the committed profile yields a bare https origin');
  assert.throws(() => resolveBaseUrl('no-such-label', 'staging', { override: undefined }));
});
