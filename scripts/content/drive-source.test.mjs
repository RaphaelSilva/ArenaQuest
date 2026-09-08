/**
 * scripts/content/drive-source.test.mjs — unit tests for the Drive source.
 *
 * No network and no credential: every Google call goes through an injected
 * `fetchImpl`, and the clock through an injected `now`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DriveError,
  DRIVE_SCOPE,
  FOLDER_MIME,
  GOOGLE_DOC_MIME,
  buildConsentUrl,
  createDriveClient,
  createDriveSource,
  createPkcePair,
  driveClientFromEnv,
  driveRevision,
  exchangeCode,
  explainExchangeFailure,
  extractFolderId,
  isGoogleAppsFile,
  listDrive,
  looksLikePlaceholder,
  parseCallbackInput,
  resolveLoginCredentials,
  startCallbackServer,
} from './drive-source.mjs';

// -- helpers ------------------------------------------------------------------

function jsonResponse(status, body, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text ?? (body === undefined ? '' : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(text ?? '').buffer,
  };
}

const TOKEN_OK = { access_token: 'at-1', expires_in: 3600 };

/**
 * Client whose non-token requests are answered by `handle(url)`. Token requests
 * are counted so refresh behaviour can be asserted.
 */
function clientWith(handle, { now = () => 0, tokenResponses } = {}) {
  const calls = [];
  let tokenCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (url.includes('oauth2.googleapis.com/token')) {
      tokenCalls += 1;
      const scripted = tokenResponses?.[tokenCalls - 1];
      return scripted ?? jsonResponse(200, { ...TOKEN_OK, access_token: `at-${tokenCalls}` });
    }
    return handle(url, init);
  };

  const client = createDriveClient({
    clientId: 'cid',
    clientSecret: 'secret',
    refreshToken: 'rt',
    fetchImpl,
    now,
  });
  return { client, calls, tokenCalls: () => tokenCalls };
}

// -- pure helpers -------------------------------------------------------------

test('extractFolderId accepts a bare id or any Drive URL', () => {
  const id = '1FNH1WasCrrJQTz_HI7vl6atutarl0FC6';
  assert.equal(extractFolderId(id), id);
  assert.equal(extractFolderId(`https://drive.google.com/drive/folders/${id}`), id);
  assert.equal(extractFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`), id);
  assert.equal(extractFolderId(`  https://drive.google.com/file/d/${id}/view  `), id);
});

test('extractFolderId rejects anything it cannot read an id from', () => {
  assert.throws(() => extractFolderId(''), /folder id or URL is required/);
  assert.throws(() => extractFolderId('short'), /could not read a Drive folder id/);
  assert.throws(() => extractFolderId('https://example.com/nothing'), /could not read a Drive folder id/);
});

test('isGoogleAppsFile spots native Google editor documents', () => {
  assert.ok(isGoogleAppsFile(GOOGLE_DOC_MIME));
  assert.ok(isGoogleAppsFile(FOLDER_MIME));
  assert.ok(!isGoogleAppsFile('video/mp4'));
  assert.ok(!isGoogleAppsFile(undefined));
});

test('driveRevision prefers the checksum and falls back to size and mtime', () => {
  assert.equal(driveRevision({ md5Checksum: 'abc', size: '10' }), 'abc');
  assert.equal(driveRevision({ size: '10', modifiedTime: '2025-04-17T03:57:00Z' }), '10:2025-04-17T03:57:00Z');
  assert.equal(driveRevision({}), '0:');
});

test('looksLikePlaceholder spots a value copied straight out of the docs', () => {
  assert.ok(looksLikePlaceholder('GOCSPX-...'));
  assert.ok(looksLikePlaceholder('1//0...'));
  assert.ok(looksLikePlaceholder('<fill after create>'));
  // The negative cases are deliberately not credential-shaped: a literal in the
  // Google client id or secret format trips GitHub's push protection even in a
  // test, and the detector only ever looks for an elision marker anyway.
  assert.ok(!looksLikePlaceholder('a-secret-that-is-not-elided'));
  assert.ok(!looksLikePlaceholder('a-refresh-token-that-is-not-elided'));
});

test('driveClientFromEnv refuses a pasted placeholder rather than calling Google', () => {
  const result = driveClientFromEnv({
    AQ_GDRIVE_CLIENT_ID: 'a-client-id',
    AQ_GDRIVE_CLIENT_SECRET: 'GOCSPX-...',
    AQ_GDRIVE_REFRESH_TOKEN: '1//0...',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.placeholders, ['AQ_GDRIVE_CLIENT_SECRET', 'AQ_GDRIVE_REFRESH_TOKEN']);
  assert.deepEqual(result.missing, [], 'a placeholder is set, just not real — that is a different fault');
});

test('driveClientFromEnv names exactly what is missing and leaks no value', () => {
  const partial = driveClientFromEnv({ AQ_GDRIVE_CLIENT_ID: 'cid' });
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.missing, ['AQ_GDRIVE_CLIENT_SECRET', 'AQ_GDRIVE_REFRESH_TOKEN']);

  const complete = driveClientFromEnv({
    AQ_GDRIVE_CLIENT_ID: 'cid',
    AQ_GDRIVE_CLIENT_SECRET: 'secret',
    AQ_GDRIVE_REFRESH_TOKEN: 'rt',
  });
  assert.equal(complete.ok, true);
  assert.equal(typeof complete.client.listChildren, 'function');
});

// -- auth ---------------------------------------------------------------------

test('the client exchanges the refresh token and reuses the access token', async () => {
  const { client, calls, tokenCalls } = clientWith(async () => jsonResponse(200, { files: [] }));

  await client.listChildren('folder-1');
  await client.listChildren('folder-2');

  assert.equal(tokenCalls(), 1, 'the access token is cached across calls');

  const tokenCall = calls.find((c) => c.url.includes('/token'));
  const form = new URLSearchParams(tokenCall.body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'rt');
  assert.equal(form.get('client_id'), 'cid');
  assert.equal(form.get('client_secret'), 'secret');
});

test('the client refreshes proactively before the token can expire', async () => {
  let clock = 0;
  const { client, tokenCalls } = clientWith(async () => jsonResponse(200, { files: [] }), { now: () => clock });

  await client.listChildren('f');
  assert.equal(tokenCalls(), 1);

  clock += 3_000_000; // 50 min — inside the hour and short of the 5-min margin
  await client.listChildren('f');
  assert.equal(tokenCalls(), 1, 'no needless refresh while the token is comfortably valid');

  clock += 400_000; // ~57 min — the token is still valid, but within the margin
  await client.listChildren('f');
  assert.equal(tokenCalls(), 2, 'refreshed before it could expire mid-flight');
});

test('the client refreshes once on a 401 and retries the call', async () => {
  let listCalls = 0;
  const { client, tokenCalls } = clientWith(async () => {
    listCalls += 1;
    if (listCalls === 1) return jsonResponse(401, undefined, 'expired');
    return jsonResponse(200, { files: [] });
  });

  await client.listChildren('f');
  assert.equal(tokenCalls(), 2);
  assert.equal(listCalls, 2);
});

test('a failed refresh surfaces Google error_description, not the credential', async () => {
  const { client } = clientWith(async () => jsonResponse(200, { files: [] }), {
    tokenResponses: [jsonResponse(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })],
  });

  await assert.rejects(client.listChildren('f'), (err) => {
    assert.ok(err instanceof DriveError);
    assert.equal(err.status, 400);
    assert.match(err.message, /Token has been expired or revoked/);
    assert.ok(!err.message.includes('rt'), 'the refresh token never appears in the error');
    return true;
  });
});

// -- listing ------------------------------------------------------------------

test('listChildren follows nextPageToken to exhaustion', async () => {
  const pages = [
    { files: [{ id: 'a', name: 'a.mp4', mimeType: 'video/mp4', size: '1' }], nextPageToken: 'p2' },
    { files: [{ id: 'b', name: 'b.mp4', mimeType: 'video/mp4', size: '2' }], nextPageToken: 'p3' },
    { files: [{ id: 'c', name: 'c.mp4', mimeType: 'video/mp4', size: '3' }] },
  ];
  let page = 0;
  const { client, calls } = clientWith(async () => jsonResponse(200, pages[page++]));

  const files = await client.listChildren('folder-1');
  assert.deepEqual(files.map((f) => f.id), ['a', 'b', 'c']);

  const listCalls = calls.filter((c) => c.url.includes('/drive/v3/files?'));
  assert.equal(listCalls.length, 3);
  // The query is scoped to the parent, skips the trash, and spans shared drives.
  const first = new URL(listCalls[0].url);
  assert.equal(first.searchParams.get('q'), "'folder-1' in parents and trashed = false");
  assert.equal(first.searchParams.get('supportsAllDrives'), 'true');
  assert.equal(first.searchParams.get('includeItemsFromAllDrives'), 'true');
  assert.equal(first.searchParams.has('pageToken'), false);
  assert.equal(new URL(listCalls[1].url).searchParams.get('pageToken'), 'p2');
});

test('listDrive recurses into subfolders and emits the shared listing shape', async () => {
  const byParent = {
    root: [
      { id: 'doc', name: 'README.md', mimeType: GOOGLE_DOC_MIME, size: '900' },
      { id: 'sub', name: 'Shoden No Kata', mimeType: FOLDER_MIME },
      { id: 'v1', name: 'Taka no Mai.mp4', mimeType: 'video/mp4', size: '4055353', md5Checksum: 'md5-1' },
    ],
    sub: [{ id: 'v2', name: 'Kakko (1).mp4', mimeType: 'video/mp4', size: '1067376', md5Checksum: 'md5-2' }],
  };
  const { client } = clientWith(async (url) => {
    const q = new URL(url).searchParams.get('q');
    const parent = /'([^']+)' in parents/.exec(q)[1];
    return jsonResponse(200, { files: byParent[parent] ?? [] });
  });

  const visited = [];
  const listing = await listDrive(client, 'root', { onFolder: (path) => visited.push(path) });

  assert.deepEqual(listing.map((n) => n.name), ['README.md', 'Shoden No Kata', 'Taka no Mai.mp4']);

  const [readme, folder, video] = listing;
  assert.equal(readme.type, 'file');
  assert.equal(readme.mimeType, GOOGLE_DOC_MIME);
  assert.equal(video.type, 'file');
  assert.equal(video.sizeBytes, 4055353, 'Drive returns size as a string; it is normalised to a number');
  assert.equal(video.revision, 'md5-1');

  assert.equal(folder.type, 'dir');
  assert.equal(folder.children.length, 1);
  assert.equal(folder.children[0].id, 'v2');

  assert.deepEqual(visited, ['', 'Shoden No Kata']);
});

// -- reading ------------------------------------------------------------------

test('the source downloads binary files and exports Google Docs as markdown', async () => {
  const requested = [];
  const { client } = clientWith(async (url) => {
    requested.push(url);
    if (url.includes('/export')) return jsonResponse(200, undefined, '# Guia\n');
    return jsonResponse(200, undefined, 'video-bytes');
  });
  const source = createDriveSource({ client, folderId: 'root' });

  const bytes = await source.readBytes({ id: 'v1' });
  assert.ok(Buffer.isBuffer(bytes));
  assert.equal(bytes.toString(), 'video-bytes');
  assert.equal(new URL(requested[0]).searchParams.get('alt'), 'media');

  const text = await source.readText({ id: 'doc', mimeType: GOOGLE_DOC_MIME });
  assert.equal(text, '# Guia\n');
  assert.equal(new URL(requested[1]).searchParams.get('mimeType'), 'text/markdown');
});

test('a real .md file is read as a plain download, not an export', async () => {
  const requested = [];
  const { client } = clientWith(async (url) => {
    requested.push(url);
    return jsonResponse(200, undefined, '# Local readme');
  });
  const source = createDriveSource({ client, folderId: 'root' });

  assert.equal(await source.readText({ id: 'f1', mimeType: 'text/markdown' }), '# Local readme');
  assert.ok(!requested[0].includes('/export'));
});

test('a Doc that refuses markdown falls back to plain text', async () => {
  const attempted = [];
  const { client } = clientWith(async (url) => {
    const mimeType = new URL(url).searchParams.get('mimeType');
    attempted.push(mimeType);
    if (mimeType === 'text/markdown') return jsonResponse(400, undefined, 'unsupported export');
    return jsonResponse(200, undefined, 'plain guia');
  });

  assert.equal(await client.exportDoc('doc'), 'plain guia');
  assert.deepEqual(attempted, ['text/markdown', 'text/plain']);
});

test('an export failure that is not about the format is not retried away', async () => {
  const { client } = clientWith(async () => jsonResponse(403, undefined, 'insufficient permissions'));
  await assert.rejects(client.exportDoc('doc'), /Drive 403/);
});

// -- consent flow -------------------------------------------------------------

test('createPkcePair derives an S256 challenge from the verifier', () => {
  const { verifier, challenge } = createPkcePair(() => Buffer.alloc(32, 7));
  assert.match(verifier, /^[A-Za-z0-9_-]+$/, 'base64url, no padding');
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(verifier, challenge);
  // Deterministic for a fixed random source, so the pair is reproducible.
  assert.deepEqual(createPkcePair(() => Buffer.alloc(32, 7)), { verifier, challenge });
});

test('buildConsentUrl asks for offline read-only access with PKCE', () => {
  const url = new URL(
    buildConsentUrl({
      clientId: 'cid',
      redirectUri: 'http://127.0.0.1:5000/callback',
      challenge: 'chal',
      state: 'st',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), DRIVE_SCOPE);
  assert.equal(url.searchParams.get('access_type'), 'offline', 'without this Google returns no refresh token');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge'), 'chal');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'st');
});

test('exchangeCode posts the code with its verifier and returns the tokens', async () => {
  let sent;
  const tokens = await exchangeCode({
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'http://127.0.0.1:5000/callback',
    code: 'the-code',
    verifier: 'the-verifier',
    fetchImpl: async (url, init) => {
      sent = { url, form: new URLSearchParams(init.body) };
      return jsonResponse(200, { access_token: 'at', refresh_token: 'rt' });
    },
  });

  assert.equal(sent.url, 'https://oauth2.googleapis.com/token');
  assert.equal(sent.form.get('grant_type'), 'authorization_code');
  assert.equal(sent.form.get('code'), 'the-code');
  assert.equal(sent.form.get('code_verifier'), 'the-verifier');
  assert.equal(tokens.refresh_token, 'rt');
});

test('resolveLoginCredentials prefers the environment and asks for nothing', async () => {
  let asked = 0;
  const creds = await resolveLoginCredentials({
    env: { AQ_GDRIVE_CLIENT_ID: 'cid', AQ_GDRIVE_CLIENT_SECRET: 'secret' },
    isTTY: true,
    askVisible: async () => (asked += 1, 'x'),
    askHidden: async () => (asked += 1, 'x'),
  });
  assert.deepEqual(creds, { clientId: 'cid', clientSecret: 'secret' });
  assert.equal(asked, 0);
});

test('resolveLoginCredentials takes the client id from --client-id, over the env', async () => {
  const creds = await resolveLoginCredentials({
    argClientId: 'from-flag',
    env: { AQ_GDRIVE_CLIENT_ID: 'from-env', AQ_GDRIVE_CLIENT_SECRET: 'secret' },
    isTTY: true,
  });
  assert.equal(creds.clientId, 'from-flag');
});

test('resolveLoginCredentials asks for whatever is missing, secret hidden', async () => {
  const prompts = [];
  const creds = await resolveLoginCredentials({
    env: {},
    isTTY: true,
    askVisible: async (q) => (prompts.push(['visible', q]), 'asked-id'),
    askHidden: async (q) => (prompts.push(['hidden', q]), 'asked-secret'),
  });

  assert.deepEqual(creds, { clientId: 'asked-id', clientSecret: 'asked-secret' });
  assert.equal(prompts[0][0], 'visible', 'the client id is not a secret');
  assert.equal(prompts[1][0], 'hidden', 'the client secret must never echo');
  assert.match(prompts[1][1], /hidden/i);
});

test('resolveLoginCredentials fails closed with no TTY instead of hanging', async () => {
  await assert.rejects(
    resolveLoginCredentials({ env: {}, isTTY: false }),
    /no client id: set AQ_GDRIVE_CLIENT_ID or pass --client-id/,
  );
  await assert.rejects(
    resolveLoginCredentials({ env: { AQ_GDRIVE_CLIENT_ID: 'cid' }, isTTY: false }),
    /no flag for it — a secret in argv leaks/,
  );
});

test('resolveLoginCredentials rejects an empty answer rather than proceeding', async () => {
  await assert.rejects(
    resolveLoginCredentials({ env: { AQ_GDRIVE_CLIENT_ID: 'cid' }, isTTY: true, askHidden: async () => '   ' }),
    /no client secret given/,
  );
});

test('parseCallbackInput accepts the pasted callback URL', () => {
  const state = 'st-123';
  assert.equal(
    parseCallbackInput(`http://127.0.0.1:5555/callback?state=${state}&code=4/0Ab_the-code&scope=drive.readonly`, state),
    '4/0Ab_the-code',
  );
  // Whitespace from a terminal paste is forgiven.
  assert.equal(parseCallbackInput(`  http://127.0.0.1:5555/callback?code=abc&state=${state}  `, state), 'abc');
});

test('parseCallbackInput accepts a bare code when only that was copied', () => {
  assert.equal(parseCallbackInput('4/0AbCd_efg-hij', 'st'), '4/0AbCd_efg-hij');
});

test('parseCallbackInput refuses a callback from a different run or a failed consent', () => {
  assert.throws(() => parseCallbackInput('http://127.0.0.1:1/callback?code=x&state=other', 'mine'), /state mismatch/);
  assert.throws(() => parseCallbackInput('http://127.0.0.1:1/callback?error=access_denied', 'st'), /access_denied/);
  assert.throws(() => parseCallbackInput('http://127.0.0.1:1/callback?scope=drive', 'st'), /no \?code=/);
  assert.throws(() => parseCallbackInput('   ', 'st'), /nothing pasted/);
  assert.throws(() => parseCallbackInput('not a url or code!!', 'st'), /neither a callback URL nor/);
});

test('startCallbackServer honours a pinned port and catches the redirect', async () => {
  const state = 'st-abc';
  const { port, code, server } = await startCallbackServer(state, 0);

  const response = await fetch(`http://127.0.0.1:${port}/callback?state=${state}&code=served-code`);
  assert.equal(response.status, 200);
  assert.equal(await code, 'served-code');
  server.close();
});

test('startCallbackServer rejects a callback whose state does not match', async () => {
  const { port, code, server } = await startCallbackServer('mine', 0);
  const settled = assert.rejects(code, /state mismatch/);

  const response = await fetch(`http://127.0.0.1:${port}/callback?state=someone-else&code=x`);
  assert.equal(response.status, 400);
  await settled;
  server.close();
});

test('explainExchangeFailure turns a bare invalid_client into something actionable', () => {
  const hints = explainExchangeFailure('Drive 401: {"error":"invalid_client","error_description":"The provided client secret is invalid."}');
  assert.match(hints.join('\n'), /client secret does not match the client id/);
  assert.match(hints.join('\n'), /GOCSPX-/);
  assert.match(hints.at(-1), /code is now spent/);
});

test('explainExchangeFailure calls out the env var that silently won', () => {
  const withEnv = explainExchangeFailure('invalid_client', { secretFromEnv: true }).join('\n');
  assert.match(withEnv, /AQ_GDRIVE_CLIENT_SECRET is set and takes precedence/);
  assert.match(withEnv, /unset AQ_GDRIVE_CLIENT_SECRET/);

  const withoutEnv = explainExchangeFailure('invalid_client', { secretFromEnv: false }).join('\n');
  assert.ok(!withoutEnv.includes('takes precedence'), 'no misleading hint when it was typed');
});

test('explainExchangeFailure names the wrong client type and a spent code', () => {
  assert.match(explainExchangeFailure('redirect_uri_mismatch').join('\n'), /must be type "Desktop app"/);
  assert.match(explainExchangeFailure('invalid_grant').join('\n'), /already used or has expired/);
  // Even an unrecognised failure says the code has to be re-minted.
  assert.match(explainExchangeFailure('something else entirely').join('\n'), /run the login again/);
});

test('exchangeCode surfaces a rejected code as a DriveError', async () => {
  await assert.rejects(
    exchangeCode({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'http://127.0.0.1:5000/callback',
      code: 'bad',
      verifier: 'v',
      fetchImpl: async () => jsonResponse(400, undefined, '{"error":"invalid_grant"}'),
    }),
    /Drive 400/,
  );
});
