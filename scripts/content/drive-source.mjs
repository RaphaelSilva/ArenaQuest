#!/usr/bin/env node
/**
 * scripts/content/drive-source.mjs — Google Drive source for the media importer.
 *
 * Reads a Drive folder recursively so `import-media.mjs` can mirror it into the
 * topic hierarchy: folders become topics, media files become media, and a
 * `README.md` inside a folder becomes that topic's content. The READMEs in the
 * real content library are **Google Docs titled "README.md"**, so they are
 * fetched through the export endpoint rather than a raw download.
 *
 * Auth is an OAuth refresh token, using the same form-post shape already
 * established in apps/api/src/controllers/google-oauth.controller.ts, with
 * `grant_type=refresh_token`. The importer reads all three from the environment:
 *
 *   AQ_GDRIVE_CLIENT_ID · AQ_GDRIVE_CLIENT_SECRET · AQ_GDRIVE_REFRESH_TOKEN
 *
 * `--login` may also take the client id as `--client-id` and will prompt for
 * anything missing. The client SECRET has no flag by design: a value in argv
 * leaks into shell history, `ps` output and CI logs, so it comes from the
 * environment or a hidden prompt and nowhere else.
 *
 * They are kept separate from the app's `GOOGLE_*` vars on purpose: that OAuth
 * client is sign-in only (`openid email profile`, no offline access) and cannot
 * be reused for Drive.
 *
 * Run this file directly to mint the refresh token once:
 *
 *   node scripts/content/drive-source.mjs --login
 *
 * That loopback consent flow is the ONE place a secret is printed — handing you
 * the token is the command's entire purpose. It goes to stdout once, is never
 * written to disk, and the importer itself never logs it.
 *
 * stdlib only, ESM, zero dependencies.
 */

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import readline from 'node:readline';
import { parseArgs as nodeParseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import log from '../lib/log.mjs';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';

/** Read-only is all an importer may ever need. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

/** Google access tokens live one hour; refresh a little before the edge. */
const TOKEN_LIFETIME_MS = 3_600_000;
const TOKEN_REFRESH_MARGIN_MS = 300_000;

/** Drive caps `pageSize` at 1000; the client follows `nextPageToken` regardless. */
const PAGE_SIZE = 200;

/** Every field the importer needs to plan and to detect a changed file. */
const LIST_FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum)';

// -- errors -------------------------------------------------------------------

/** Error carrying the HTTP status so the caller's retry policy can classify it. */
export class DriveError extends Error {
  constructor(status, detail) {
    super(detail ? `Drive ${status}: ${detail}` : `Drive ${status}`);
    this.name = 'DriveError';
    this.status = status;
  }
}

// -- pure helpers -------------------------------------------------------------

/**
 * Accept either a bare folder id or a Drive URL and return the id.
 * `https://drive.google.com/drive/folders/<id>?usp=sharing` -> `<id>`.
 */
export function extractFolderId(input) {
  if (!input || typeof input !== 'string') throw new Error('a Drive folder id or URL is required');
  const trimmed = input.trim();
  const fromUrl = /\/(?:folders|d)\/([A-Za-z0-9_-]{10,})/.exec(trimmed);
  if (fromUrl) return fromUrl[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  throw new Error(`could not read a Drive folder id from "${input}"`);
}

/** True for anything Drive stores as a native Google editor document. */
export function isGoogleAppsFile(mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('application/vnd.google-apps.');
}

/**
 * Change token for a Drive file. `md5Checksum` is exact and is present for
 * binary uploads; native Google files have none, so fall back to size and
 * modification time.
 */
export function driveRevision(file) {
  if (file.md5Checksum) return file.md5Checksum;
  return `${file.size ?? '0'}:${file.modifiedTime ?? ''}`;
}

// -- client -------------------------------------------------------------------

/**
 * Authenticated Drive client.
 *
 * Mirrors `createApiClient` in import-media.mjs: an injectable `fetchImpl` and
 * `now` for tests, and a cached bearer token refreshed proactively before it
 * can expire mid-run.
 */
export function createDriveClient({
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl = fetch,
  now = Date.now,
}) {
  let token = null;
  let tokenExpiresAt = 0;

  async function refresh() {
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const text = await response.text();
    if (!response.ok) {
      // Google returns {error, error_description}; surface it without the token.
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error_description ?? parsed.error ?? detail;
      } catch {
        // keep the raw prefix
      }
      throw new DriveError(response.status, detail);
    }

    const body = JSON.parse(text);
    if (!body.access_token) throw new DriveError(response.status, 'token response carried no access_token');
    token = body.access_token;
    const lifetime = Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : TOKEN_LIFETIME_MS;
    tokenExpiresAt = now() + lifetime - TOKEN_REFRESH_MARGIN_MS;
    return token;
  }

  async function ensureToken() {
    if (!token || now() >= tokenExpiresAt) await refresh();
    return token;
  }

  /** One authenticated GET. `raw: true` returns the Response for body reads. */
  async function request(url, { raw = false } = {}) {
    const send = async () => {
      const accessToken = await ensureToken();
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new DriveError(response.status, detail);
      }
      return raw ? response : JSON.parse(await response.text());
    };

    try {
      return await send();
    } catch (err) {
      if (err instanceof DriveError && err.status === 401) {
        token = null; // expired mid-run — refresh once and retry
        return send();
      }
      throw err;
    }
  }

  /** Every direct child of `folderId`, following pagination to exhaustion. */
  async function listChildren(folderId) {
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: LIST_FIELDS,
        pageSize: String(PAGE_SIZE),
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await request(`${FILES_URL}?${params}`);
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  /** Raw bytes of a binary file. */
  async function download(fileId) {
    const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
    const response = await request(`${FILES_URL}/${fileId}?${params}`, { raw: true });
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Text of a native Google Doc. Markdown export keeps headings, tables and
   * links; older documents that refuse it fall back to plain text.
   */
  async function exportDoc(fileId) {
    for (const mimeType of ['text/markdown', 'text/plain']) {
      const params = new URLSearchParams({ mimeType, supportsAllDrives: 'true' });
      try {
        const response = await request(`${FILES_URL}/${fileId}/export?${params}`, { raw: true });
        return await response.text();
      } catch (err) {
        const retryAsPlain = err instanceof DriveError && (err.status === 400 || err.status === 415);
        if (!retryAsPlain || mimeType === 'text/plain') throw err;
      }
    }
    throw new DriveError(415, `could not export ${fileId} as text`);
  }

  /** Folder name, so the plan header can show what is being imported. */
  async function folderName(folderId) {
    const params = new URLSearchParams({ fields: 'id,name', supportsAllDrives: 'true' });
    const file = await request(`${FILES_URL}/${folderId}?${params}`);
    return file.name;
  }

  return { ensureToken, listChildren, download, exportDoc, folderName };
}

// -- listing ------------------------------------------------------------------

/**
 * Recursively list `folderId` into the importer's source-agnostic listing shape:
 *
 *   dir  -> { type: 'dir',  name, id, children[] }
 *   file -> { type: 'file', name, id, sizeBytes, revision, mimeType }
 *
 * Depth-first, one API call per folder. `onFolder` reports progress, since a
 * large library takes a while to enumerate.
 */
export async function listDrive(client, folderId, { onFolder } = {}) {
  const walk = async (id, path) => {
    if (onFolder) onFolder(path);
    const children = await client.listChildren(id);
    const nodes = [];

    for (const file of children) {
      if (file.mimeType === FOLDER_MIME) {
        nodes.push({
          type: 'dir',
          name: file.name,
          id: file.id,
          children: await walk(file.id, path ? `${path}/${file.name}` : file.name),
        });
        continue;
      }
      nodes.push({
        type: 'file',
        name: file.name,
        id: file.id,
        sizeBytes: Number(file.size ?? 0),
        revision: driveRevision(file),
        mimeType: file.mimeType,
      });
    }

    return nodes;
  };

  return walk(folderId, '');
}

/**
 * The importer's source contract, backed by Drive.
 *
 * `readText` is what turns a `README.md` Google Doc into topic content; a
 * README stored as a genuine `.md` file downloads normally instead.
 */
export function createDriveSource({ client, folderId, onFolder }) {
  return {
    kind: 'drive',
    describe: async () => {
      const name = await client.folderName(folderId).catch(() => folderId);
      return `Google Drive: ${name} (${folderId})`;
    },
    list: () => listDrive(client, folderId, { onFolder }),
    readBytes: (file) => client.download(file.id),
    readText: (file) =>
      isGoogleAppsFile(file.mimeType) ? client.exportDoc(file.id) : client.download(file.id).then((b) => b.toString('utf8')),
  };
}

/**
 * Build a Drive client from the environment, or return null with the reason.
 * Never logs or returns the credential values themselves.
 */
/**
 * A value copied from a documentation snippet rather than replaced. The repo
 * already treats `<fill …>` this way in provision-label.mjs; an ellipsis is the
 * other shape our own examples use, and pasting one produces a Google error
 * ("The provided client secret is invalid") that says nothing about the cause.
 */
export function looksLikePlaceholder(value) {
  const v = String(value ?? '').trim();
  return v.includes('...') || v.includes('…') || /^<.*>$/.test(v);
}

export function driveClientFromEnv(env = process.env) {
  const clientId = env.AQ_GDRIVE_CLIENT_ID;
  const clientSecret = env.AQ_GDRIVE_CLIENT_SECRET;
  const refreshToken = env.AQ_GDRIVE_REFRESH_TOKEN;

  const entries = [
    ['AQ_GDRIVE_CLIENT_ID', clientId],
    ['AQ_GDRIVE_CLIENT_SECRET', clientSecret],
    ['AQ_GDRIVE_REFRESH_TOKEN', refreshToken],
  ];

  const missing = entries.filter(([, value]) => !value).map(([name]) => name);
  const placeholders = entries
    .filter(([, value]) => value && looksLikePlaceholder(value))
    .map(([name]) => name);

  if (missing.length > 0 || placeholders.length > 0) return { ok: false, missing, placeholders };
  return { ok: true, client: createDriveClient({ clientId, clientSecret, refreshToken }), missing: [], placeholders: [] };
}

// -- one-time consent (--login) -----------------------------------------------

const base64url = (buffer) => buffer.toString('base64url');

/** PKCE pair, same S256 construction the API's OAuth controller uses. */
export function createPkcePair(random = () => randomBytes(32)) {
  const verifier = base64url(random());
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** The consent URL. `access_type=offline` + `prompt=consent` force a refresh token. */
export function buildConsentUrl({ clientId, redirectUri, challenge, state }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DRIVE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Turn a token-exchange failure into something actionable.
 *
 * Google answers with a bare `invalid_client` / `invalid_grant`, which says
 * nothing about which of the several possible causes applies. Every one of these
 * also burns the authorization code — it is single-use — so the operator always
 * has to start a fresh consent, and the hints say so.
 */
export function explainExchangeFailure(detail, { secretFromEnv = false } = {}) {
  const body = String(detail ?? '');
  const hints = [];

  if (body.includes('client secret is invalid') || body.includes('invalid_client')) {
    hints.push('The client secret does not match the client id.');
    if (secretFromEnv) {
      hints.push('AQ_GDRIVE_CLIENT_SECRET is set and takes precedence over the prompt — so this run used');
      hints.push('that value, not one you typed. `unset AQ_GDRIVE_CLIENT_SECRET` to be asked instead.');
    }
    hints.push('A current Google secret looks like GOCSPX-… and is 35 characters.');
    hints.push('Re-copy it from the OAuth client in the console; both values must be from the SAME client.');
  } else if (body.includes('redirect_uri_mismatch')) {
    hints.push('The OAuth client is probably a "Web application". It must be type "Desktop app",');
    hints.push('which is what accepts an arbitrary http://127.0.0.1:<port> redirect.');
  } else if (body.includes('invalid_grant')) {
    hints.push('The authorization code was already used or has expired (they last a few minutes).');
  }

  hints.push('The code is now spent either way — run the login again for a fresh consent URL.');
  return hints;
}

/** Exchange the authorization code for tokens (PKCE + client secret). */
export async function exchangeCode({ clientId, clientSecret, redirectUri, code, verifier, fetchImpl = fetch }) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
    }).toString(),
  });

  const text = await response.text();
  if (!response.ok) throw new DriveError(response.status, text.slice(0, 300));
  return JSON.parse(text);
}

/**
 * Listen on an ephemeral loopback port for the OAuth callback.
 *
 * Resolves once listening, with the chosen `port` and a `code` promise that
 * settles when Google redirects back. A "Desktop app" OAuth client accepts any
 * `http://127.0.0.1:<port>` redirect, so the port does not need registering.
 */
export function startCallbackServer(state, port = 0) {
  return new Promise((ready, failed) => {
    let resolveCode;
    let rejectCode;
    const code = new Promise((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('not found');
        return;
      }

      const finish = (status, message) => {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
        server.close();
      };

      if (url.searchParams.get('state') !== state) {
        finish(400, 'State mismatch — start over.');
        rejectCode(new Error('OAuth state mismatch — the callback did not come from this run'));
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        finish(400, `Consent failed: ${error}`);
        rejectCode(new Error(`consent failed: ${error}`));
        return;
      }

      const authCode = url.searchParams.get('code');
      if (!authCode) {
        finish(400, 'No code in the callback.');
        rejectCode(new Error('callback carried no authorization code'));
        return;
      }

      finish(200, 'Done. You can close this tab and return to the terminal.');
      resolveCode(authCode);
    });

    server.on('error', failed);
    server.listen(port, '127.0.0.1', () => ready({ port: server.address().port, code, server }));
  });
}

/**
 * Read the authorization code out of whatever the operator pasted back.
 *
 * On a headless box the browser runs elsewhere, so the redirect lands on THAT
 * machine's loopback and this process never sees it. The address bar still holds
 * the whole callback URL, and pasting it here is equivalent — `state` is checked
 * exactly as the served callback would.
 *
 * A bare code is accepted too, for the case where only the `code=` value was
 * copied; there is no state to verify then, but the operator typed it by hand.
 */
export function parseCallbackInput(input, state) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) throw new Error('nothing pasted');

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    // Not a URL — treat it as the raw code.
    if (/^[A-Za-z0-9/_-]+$/.test(trimmed)) return trimmed;
    throw new Error('that is neither a callback URL nor an authorization code');
  }

  const error = url.searchParams.get('error');
  if (error) throw new Error(`consent failed: ${error}`);

  const returnedState = url.searchParams.get('state');
  if (returnedState && returnedState !== state) {
    throw new Error('OAuth state mismatch — that callback came from a different run');
  }

  const code = url.searchParams.get('code');
  if (!code) throw new Error('the pasted URL carries no ?code= parameter');
  return code;
}

/** Ask for a value on the terminal, echoing what is typed. */
function promptVisible(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ask for a secret without echoing it.
 *
 * There is deliberately no `--client-secret` flag: a value in argv lands in the
 * shell history, in `ps` output and in CI logs. The environment or this prompt
 * are the only two ways in.
 */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) rl.output.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true; // `question()` has written the prompt by now; hide the typing
  });
}

/**
 * Resolve the OAuth client credentials for `--login`.
 *
 * The client id may come from `--client-id`, since Google does not treat it as a
 * secret (the repo says the same of `GOOGLE_CLIENT_ID` in wrangler.jsonc). The
 * client secret may not: environment or interactive prompt only. Without a TTY
 * both fall back to a clear failure rather than hanging.
 */
export async function resolveLoginCredentials({
  argClientId,
  env = process.env,
  isTTY = Boolean(process.stdin.isTTY),
  askVisible = promptVisible,
  askHidden = promptHidden,
} = {}) {
  let clientId = argClientId?.trim() || env.AQ_GDRIVE_CLIENT_ID?.trim() || '';
  let clientSecret = env.AQ_GDRIVE_CLIENT_SECRET?.trim() || '';

  if (!clientId) {
    if (!isTTY) {
      throw new Error(
        'no client id: set AQ_GDRIVE_CLIENT_ID or pass --client-id (no TTY available to ask for it).',
      );
    }
    // Trim here rather than trusting the prompt: an injected asker may not.
    clientId = String(await askVisible('      Client ID: ') ?? '').trim();
    if (!clientId) throw new Error('no client id given');
  }

  if (!clientSecret) {
    if (!isTTY) {
      throw new Error(
        'no client secret: set AQ_GDRIVE_CLIENT_SECRET in the environment ' +
          '(there is no flag for it — a secret in argv leaks into shell history, ps and CI logs).',
      );
    }
    clientSecret = String(await askHidden('      Client secret (input hidden): ') ?? '').trim();
    if (!clientSecret) throw new Error('no client secret given');
  }

  return { clientId, clientSecret };
}

async function runLogin({ port: fixedPort, clientId: argClientId } = {}) {
  const secretFromEnv = Boolean(process.env.AQ_GDRIVE_CLIENT_SECRET);
  let clientId;
  let clientSecret;
  try {
    ({ clientId, clientSecret } = await resolveLoginCredentials({ argClientId }));
  } catch (err) {
    log.fail(err.message);
    log.hint('The values come from an OAuth client of type "Desktop app" in the Google Cloud console.');
    log.hint('Enable the Google Drive API on that project first, or the first listing fails with 403.');
    process.exitCode = 1;
    return;
  }

  const { verifier, challenge } = createPkcePair();
  const state = base64url(randomBytes(16));

  const { port, code: servedCode, server } = await startCallbackServer(state, fixedPort ?? 0);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  log.heading('Google Drive — one-time consent');
  log.info('Open this URL in a browser signed in to the account that owns the content:');
  console.log('');
  console.log(`      ${buildConsentUrl({ clientId, redirectUri, challenge, state })}`);
  console.log('');
  log.hint(`Listening on ${redirectUri} — if the browser runs on THIS machine, you are done.`);
  log.hint('Otherwise the redirect lands on the browser machine and fails to load: copy the');
  log.hint('whole address bar (it still holds ?code=…) and paste it below.');
  console.log('');
  // This one fails in the browser, before any callback reaches us, so it has to
  // be said up front rather than explained after the fact.
  log.hint('If the consent page itself shows "Error 400: redirect_uri_mismatch", the OAuth client');
  log.hint('is a "Web application". It must be type "Desktop app" — that is the type which accepts');
  log.hint(`an arbitrary loopback port. (Or register ${redirectUri} on the web client and reuse`);
  log.hint('the same --port every time.)');
  console.log('');

  // Two ways in, whichever arrives first: the served callback, or a pasted URL.
  // The paste path is what makes this work over SSH with no tunnel.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pastedCode = new Promise((resolve, reject) => {
    rl.question('      Paste the callback URL (or just wait): ', (answer) => {
      try {
        resolve(parseCallbackInput(answer, state));
      } catch (err) {
        reject(err);
      }
    });
  });

  let tokens;
  try {
    const code = await Promise.race([servedCode, pastedCode]);
    rl.close();
    server.close();
    tokens = await exchangeCode({ clientId, clientSecret, redirectUri, code, verifier });
  } catch (err) {
    rl.close();
    server.close();
    log.fail(err.message);
    if (err instanceof DriveError) {
      for (const hint of explainExchangeFailure(err.message, { secretFromEnv })) log.hint(hint);
    }
    process.exitCode = 1;
    return;
  }

  if (!tokens.refresh_token) {
    log.fail('Google returned no refresh_token.');
    log.hint('Revoke the app at https://myaccount.google.com/permissions and run --login again.');
    process.exitCode = 1;
    return;
  }

  log.ok('Consent granted. Store this refresh token somewhere safe — it is shown once:');
  console.log('');
  console.log(`      export AQ_GDRIVE_REFRESH_TOKEN='${tokens.refresh_token}'`);
  console.log('');
  log.hint('It is not written to disk, and the importer never logs it. It grants read access to');
  log.hint('your Drive until revoked, so it belongs in a password manager — never in a chat, a');
  log.hint('ticket or a commit. Nothing and nobody needs a copy: the importer reads it from your');
  log.hint('own environment.');
  log.hint('Leaked one? Revoke it and mint another:');
  log.cmd('curl -s -X POST https://oauth2.googleapis.com/revoke -d "token=$AQ_GDRIVE_REFRESH_TOKEN"');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  let values;
  try {
    ({ values } = nodeParseArgs({
      args: process.argv.slice(2),
      options: {
        login: { type: 'boolean' },
        port: { type: 'string' },
        'client-id': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    }));
  } catch (err) {
    log.die(`invalid arguments: ${err.message}`);
  }

  if (values.login) {
    let port;
    if (values.port !== undefined) {
      port = Number(values.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        log.die(`--port must be a TCP port between 1 and 65535 (got "${values.port}")`);
      }
    }
    runLogin({ port, clientId: values['client-id'] }).catch((error) => {
      log.fail(error.message);
      process.exitCode = 1;
    });
  } else {
    console.log(`
  Usage: node scripts/content/drive-source.mjs --login [--client-id <id>] [--port <n>]

  Mints the Google Drive refresh token the media importer needs, from a
  "Desktop app" OAuth client with the Google Drive API enabled.

  Credentials
    Client ID      --client-id, or AQ_GDRIVE_CLIENT_ID, or it asks.
    Client secret  AQ_GDRIVE_CLIENT_SECRET, or it asks (input hidden).
                   There is deliberately NO flag: a secret in argv leaks into
                   shell history, ps output and CI logs.

  It prints a consent URL and then accepts the result either way:

    - browser on THIS machine  -> the loopback callback is caught automatically
    - browser somewhere else   -> paste the callback URL back into the prompt
                                  (the redirect fails to load over there; the
                                  address bar still holds the ?code=)

  --port pins the loopback port, which is what you want when forwarding it:
      ssh -L 5555:localhost:5555 you@server
      node scripts/content/drive-source.mjs --login --port 5555

  This module is otherwise imported by scripts/content/import-media.mjs; use
  that script's --drive-folder flag to run an import.
`);
  }
}
