/**
 * scripts/mcp/tools/authoring.test.mjs — the seven authoring tools with the
 * API client, the file system, the converter and the uploader stubbed.
 *
 * What is pinned here is the policy, not the HTTP: the exact tool list and
 * annotations; that no input schema has a `status` property and no body ever
 * carries one; that a write on a non-draft topic is refused BEFORE any write
 * call; that an oversized or unsupported file is refused before presign; the
 * `.mov` path (missing ffmpeg → install command, present → convert then
 * upload the converted file); the comments filter; and that two concurrent
 * creates reach the API one at a time.
 *
 * Run: node --test scripts/mcp/tools/authoring.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { ApiError } from '../../lib/api-client.mjs';
import {
  AUTHORING_TOOL_NAMES,
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  buildAuthoringTools,
  callTool,
  expandPath,
  registerAuthoringTools,
} from './authoring.mjs';

// -- fixtures -----------------------------------------------------------------

const DRAFT = {
  id: 'd1',
  parentId: null,
  title: 'Draft one',
  content: '# Hello',
  status: 'draft',
  order: 2,
  estimatedMinutes: 30,
  prerequisiteIds: [],
  tags: [{ id: 'g1', name: 'Kata', slug: 'kata' }],
  mediaCount: { video: 1, audio: 0, pdf: 0, total: 1 },
  children: [],
};
const PUBLISHED = { ...DRAFT, id: 'p1', title: 'Published one', status: 'published', order: 1, tags: [], mediaCount: undefined, media: [{ id: 'm9' }] };
const CHILD = { ...DRAFT, id: 'c1', parentId: 'p1', title: 'Child', order: 0 };

const CONFIG = {
  label: 'budo',
  env: 'staging',
  webOrigin: 'https://budo-web-staging.pages.dev',
  uploadLedgerPath: '/state/mcp-upload-budo-staging.jsonl',
  convertDir: '/state/mcp-convert/budo-staging',
};

/** A recording API client. `routes` maps `METHOD path` to a value, a function or an Error. */
function stubClient(routes = {}) {
  const calls = [];
  const topics = { d1: DRAFT, p1: PUBLISHED, c1: CHILD };
  return {
    calls,
    writes: () => calls.filter((c) => c.method !== 'GET'),
    async request(method, path, opts = {}) {
      calls.push({ method, path, body: opts.body });
      const key = `${method} ${path}`;
      if (key in routes) {
        const value = routes[key];
        if (value instanceof Error) throw value;
        return typeof value === 'function' ? value(opts) : value;
      }
      if (method === 'GET' && path === '/v1/admin/topics') return { data: [DRAFT, PUBLISHED, CHILD] };
      const topicMatch = /^\/v1\/admin\/topics\/([^/]+)$/.exec(path);
      if (method === 'GET' && topicMatch) {
        const topic = topics[topicMatch[1]];
        if (!topic) throw new ApiError(404, 'NotFound', null, { error: 'NotFound' });
        return topic;
      }
      if (method === 'GET' && /\/media$/.test(path)) return { data: [{ id: 'm1', originalName: 'a.mp4', type: 'video/mp4', sizeBytes: 10, status: 'ready', storageKey: 'topics/x', url: 'u' }] };
      if (method === 'POST' && path === '/v1/admin/topics') return { ...DRAFT, id: 'new', title: opts.body.title, status: 'draft' };
      if (method === 'PATCH' && topicMatch) return { ...topics[topicMatch[1]], ...opts.body };
      throw new Error(`unexpected ${key}`);
    },
  };
}

function stubFs({ files = {} } = {}) {
  const made = [];
  return {
    made,
    async stat(path) {
      const file = files[path];
      if (!file) {
        const err = new Error(`ENOENT: ${path}`);
        err.code = 'ENOENT';
        throw err;
      }
      return { isFile: () => file.isFile ?? true, size: file.size, mtimeMs: file.mtimeMs ?? 1000 };
    },
    async readFile(path) {
      return Buffer.alloc(files[path]?.size ?? 0);
    },
    async mkdir(path) {
      made.push(path);
    },
  };
}

const ffmpegPresent = () => ({ resolved: { ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' }, missing: [] });
const ffmpegMissing = () => ({
  resolved: {},
  missing: [{ tool: 'ffmpeg', role: 'ffmpeg', candidates: ['ffmpeg'], fix: 'sudo apt-get install -y ffmpeg' }],
});

function build(overrides = {}) {
  const client = overrides.client ?? stubClient();
  const uploads = [];
  const tools = buildAuthoringTools({
    client,
    config: CONFIG,
    fs: stubFs(),
    homedir: () => '/home/op',
    resolveTools: ffmpegMissing,
    convertVideo: async () => {
      throw new Error('convertVideo must not run');
    },
    uploadFile: async (_client, args) => {
      uploads.push(args);
      return { relPath: args.file.relPath, outcome: 'uploaded', media: { id: 'm-new', status: 'ready' } };
    },
    readLedger: () => new Map(),
    fetchImpl: () => {
      throw new Error('no network in tests');
    },
    ...overrides,
  });
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  return { tools, byName, client, uploads };
}

// -- the list -----------------------------------------------------------------

test('exactly the seven tools, in order, with read/write annotations', () => {
  const { tools } = build();
  assert.deepEqual(
    tools.map((t) => t.name),
    ['list_topics', 'read_topic', 'topic_comments', 'create_topic_draft', 'update_topic_draft', 'upload_media', 'review_link'],
  );
  assert.deepEqual(tools.map((t) => t.name), AUTHORING_TOOL_NAMES);
  const reads = ['list_topics', 'read_topic', 'topic_comments', 'review_link'];
  for (const tool of tools) {
    assert.ok(tool.title && tool.description, `${tool.name} has a title and a description`);
    assert.equal(typeof tool.run, 'function');
    assert.deepEqual(tool.annotations, reads.includes(tool.name) ? READ_ANNOTATIONS : WRITE_ANNOTATIONS, tool.name);
  }
  assert.equal(READ_ANNOTATIONS.readOnlyHint, true);
  assert.equal(WRITE_ANNOTATIONS.readOnlyHint, false);
  assert.equal(WRITE_ANNOTATIONS.destructiveHint, false);
});

test('no input schema has a status (or visibility) property', () => {
  const { tools } = build();
  for (const tool of tools) {
    const keys = Object.keys(tool.inputSchema);
    assert.ok(keys.length > 0 || tool.name === 'list_topics', `${tool.name} declares its inputs`);
    for (const key of keys) {
      assert.doesNotMatch(key, /status/i, `${tool.name}.${key}`);
      assert.doesNotMatch(key, /visibility/i, `${tool.name}.${key}`);
    }
  }
});

test('registerAuthoringTools registers each tool once with its schema and annotations', () => {
  const registered = [];
  const server = { registerTool: (name, config, cb) => registered.push({ name, config, cb }) };
  const audit = { record: () => {} };
  const tools = registerAuthoringTools(server, { audit, client: stubClient(), config: CONFIG });
  assert.equal(tools.length, 7);
  assert.deepEqual(registered.map((r) => r.name), AUTHORING_TOOL_NAMES);
  for (const r of registered) {
    assert.equal(r.config.annotations.readOnlyHint, tools.find((t) => t.name === r.name).annotations.readOnlyHint);
    assert.equal(typeof r.cb, 'function');
    assert.ok('inputSchema' in r.config);
  }
  assert.throws(() => registerAuthoringTools(server, { client: stubClient(), config: CONFIG }), /audit is required/);
});

// -- reads --------------------------------------------------------------------

test('list_topics returns the flat list sorted by order, or one parent\'s children', async () => {
  const { byName } = build();
  const all = await byName.list_topics.run({});
  assert.equal(all.count, 3);
  assert.deepEqual(all.topics.map((t) => t.id), ['c1', 'p1', 'd1']);
  assert.deepEqual(all.topics[2], {
    id: 'd1', parentId: null, title: 'Draft one', status: 'draft', order: 2, estimatedMinutes: 30, mediaCount: 1, tags: ['Kata'],
  });
  assert.equal(all.topics[1].mediaCount, 1, 'falls back to media[].length');
  const children = await byName.list_topics.run({ parentId: 'p1' });
  assert.deepEqual(children.topics.map((t) => t.id), ['c1']);
  assert.equal(children.parentId, 'p1');
});

test('read_topic returns markdown, tag names, media summaries and children', async () => {
  const { byName, client } = build();
  const topic = await byName.read_topic.run({ id: 'd1' });
  assert.equal(topic.markdown, '# Hello');
  assert.deepEqual(topic.tags, ['Kata']);
  assert.deepEqual(topic.media, [{ id: 'm1', originalName: 'a.mp4', type: 'video/mp4', sizeBytes: 10, status: 'ready' }]);
  assert.deepEqual(client.calls.map((c) => c.path), ['/v1/admin/topics/d1', '/v1/admin/topics/d1/media']);
  assert.equal(client.writes().length, 0);
});

test('topic_comments filters by since, drops deleted comments and never reads notes or submissions', async () => {
  const rows = [
    { id: 'c1', userId: 'u1', userName: 'Ana', body: 'old', createdAt: '2026-01-01T00:00:00Z', deletedAt: null, likeCount: 2, parentCommentId: null },
    { id: 'c2', userId: 'u2', userName: 'Bia', body: 'new', createdAt: '2026-03-01T00:00:00Z', deletedAt: null, likeCount: 0, parentCommentId: 'c1' },
    { id: 'c3', userId: 'u3', userName: 'Cao', body: null, createdAt: '2026-04-01T00:00:00Z', deletedAt: '2026-04-02T00:00:00Z', likeCount: 0, parentCommentId: null },
  ];
  const client = stubClient({ 'GET /v1/topics/d1/comments': { data: rows } });
  const { byName } = build({ client });
  const all = await byName.topic_comments.run({ id: 'd1' });
  assert.deepEqual(all.comments.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(all.comments[1], { id: 'c2', author: 'Bia', body: 'new', createdAt: '2026-03-01T00:00:00Z', likeCount: 0, replyTo: 'c1' });
  const since = await byName.topic_comments.run({ id: 'd1', since: '2026-02-01T00:00:00Z' });
  assert.deepEqual(since.comments.map((c) => c.id), ['c2']);
  const bad = await byName.topic_comments.run({ id: 'd1', since: 'yesterday' });
  assert.equal(bad.refused, true);
  for (const call of client.calls) {
    assert.doesNotMatch(call.path, /notes|submissions/);
  }
});

test('topic_comments reports a topic the catalog cannot read (403/404) as an empty list with a note', async () => {
  for (const status of [403, 404]) {
    const client = stubClient({ 'GET /v1/topics/d1/comments': new ApiError(status, 'Forbidden', null, null) });
    const { byName } = build({ client });
    const out = await byName.topic_comments.run({ id: 'd1' });
    assert.deepEqual(out.comments, []);
    assert.match(out.note, /not readable in the catalog/);
  }
  const client = stubClient({ 'GET /v1/topics/d1/comments': new ApiError(500, 'Boom', null, null) });
  const { byName } = build({ client });
  await assert.rejects(() => byName.topic_comments.run({ id: 'd1' }), /HTTP 500/);
});

test('review_link points at the backoffice topics page with the title and status', async () => {
  const { byName } = build();
  assert.deepEqual(await byName.review_link.run({ topicId: 'p1' }), {
    url: 'https://budo-web-staging.pages.dev/admin/topics',
    topicId: 'p1',
    title: 'Published one',
    status: 'published',
    hint: 'open the page and select the topic by title',
  });
});

// -- writes -------------------------------------------------------------------

test('create_topic_draft posts without a status key and answers the draft the API created', async () => {
  const { byName, client } = build();
  const out = await byName.create_topic_draft.run({ title: 'New', markdown: '# md', tags: ['Kata'], parentId: 'p1', estimatedMinutes: 5 });
  assert.deepEqual(out, { id: 'new', parentId: null, title: 'New', status: 'draft' });
  const [post] = client.writes();
  assert.equal(post.method, 'POST');
  assert.deepEqual(post.body, { title: 'New', content: '# md', parentId: 'p1', tags: ['Kata'], estimatedMinutes: 5 });
  assert.equal('status' in post.body, false);
  assert.equal('visibility' in post.body, false);

  const minimal = await byName.create_topic_draft.run({ title: 'Root', markdown: '' });
  assert.equal(minimal.status, 'draft');
  assert.deepEqual(client.writes()[1].body, { title: 'Root', content: '' });
});

test('two concurrent create_topic_draft calls reach the API one after the other', async () => {
  const order = [];
  let releaseFirst;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let posts = 0;
  const client = stubClient({
    'POST /v1/admin/topics': async ({ body }) => {
      posts += 1;
      order.push(`start ${body.title}`);
      if (posts === 1) await first;
      order.push(`end ${body.title}`);
      return { ...DRAFT, id: `id-${body.title}`, title: body.title, status: 'draft' };
    },
  });
  const { byName } = build({ client });
  const a = byName.create_topic_draft.run({ title: 'A', markdown: '' });
  const b = byName.create_topic_draft.run({ title: 'B', markdown: '' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start A'], 'B must wait for A');
  releaseFirst();
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(order, ['start A', 'end A', 'start B', 'end B']);
  assert.equal(ra.id, 'id-A');
  assert.equal(rb.id, 'id-B');
});

test('a failed create does not block the next one', async () => {
  let posts = 0;
  const client = stubClient({
    'POST /v1/admin/topics': async ({ body }) => {
      posts += 1;
      if (posts === 1) throw new ApiError(400, 'BadRequest', 'title', null);
      return { ...DRAFT, id: 'ok', title: body.title, status: 'draft' };
    },
  });
  const { byName } = build({ client });
  await assert.rejects(() => byName.create_topic_draft.run({ title: 'bad', markdown: '' }), /HTTP 400/);
  const ok = await byName.create_topic_draft.run({ title: 'good', markdown: '' });
  assert.equal(ok.id, 'ok');
});

test('update_topic_draft patches a draft without a status key', async () => {
  const { byName, client } = build();
  const out = await byName.update_topic_draft.run({ id: 'd1', markdown: '# new', tags: [] });
  assert.equal(out.status, 'draft');
  assert.deepEqual(out.changed, ['content', 'tags']);
  const [patch] = client.writes();
  assert.equal(patch.method, 'PATCH');
  assert.equal(patch.path, '/v1/admin/topics/d1');
  assert.deepEqual(patch.body, { content: '# new', tags: [] });
  assert.equal(client.calls[0].method, 'GET', 'reads before writing');
});

test('update_topic_draft on a published topic is refused with no write call', async () => {
  const { byName, client } = build();
  const out = await byName.update_topic_draft.run({ id: 'p1', title: 'x' });
  assert.equal(out.refused, true);
  assert.match(out.reason, /topic p1 is published; the assistant edits drafts only — unpublish it in the backoffice first/);
  assert.deepEqual(client.calls.map((c) => c.method), ['GET']);
  assert.equal(client.writes().length, 0);
  const nothing = await byName.update_topic_draft.run({ id: 'd1' });
  assert.equal(nothing.refused, true);
  assert.equal(client.writes().length, 0);
});

// -- upload_media -------------------------------------------------------------

const MB = 1024 * 1024;

test('expandPath expands ~ and resolves relative paths', () => {
  assert.equal(expandPath('~/v.mov', { homedir: () => '/home/op' }), '/home/op/v.mov');
  assert.equal(expandPath('~', { homedir: () => '/home/op' }), '/home/op');
  assert.equal(expandPath('/abs/a.pdf'), '/abs/a.pdf');
  assert.equal(expandPath('rel/a.pdf'), join(process.cwd(), 'rel/a.pdf'));
  assert.throws(() => expandPath(''), /path is required/);
});

test('upload_media on a published topic is refused before any conversion, validation or write', async () => {
  const fs = stubFs({ files: { '/home/op/a.jpg': { size: 1000 } } });
  const { byName, client, uploads } = build({ fs });
  const out = await byName.upload_media.run({ topicId: 'p1', path: '~/a.jpg' });
  assert.equal(out.refused, true);
  assert.match(out.reason, /is published/);
  assert.equal(client.writes().length, 0);
  assert.equal(uploads.length, 0);
});

test('upload_media refuses an oversized or unsupported file before presign', async () => {
  const fs = stubFs({ files: { '/home/op/big.mp4': { size: 101 * MB }, '/home/op/x.exe': { size: 10 } } });
  const { byName, client, uploads } = build({ fs });
  const big = await byName.upload_media.run({ topicId: 'd1', path: '/home/op/big.mp4' });
  assert.equal(big.refused, true);
  assert.equal(big.state, 'too-large');
  assert.match(big.reason, /exceeds the API limit/);
  const exe = await byName.upload_media.run({ topicId: 'd1', path: '/home/op/x.exe' });
  assert.equal(exe.refused, true);
  assert.equal(exe.state, 'invalid-type');
  assert.equal(uploads.length, 0);
  assert.equal(client.writes().length, 0);
  assert.equal(client.calls.filter((c) => /presign/.test(c.path)).length, 0);
});

test('upload_media refuses a missing file without touching the API', async () => {
  const { byName, client, uploads } = build();
  const out = await byName.upload_media.run({ topicId: 'd1', path: '/home/op/missing.pdf' });
  assert.equal(out.refused, true);
  assert.match(out.reason, /file not found/);
  assert.equal(client.calls.length, 0);
  assert.equal(uploads.length, 0);
});

test('upload_media uploads a valid file on a draft through uploadFile with the ledger', async () => {
  const fs = stubFs({ files: { '/home/op/a.jpg': { size: 1000, mtimeMs: 42 } } });
  const { byName, uploads } = build({ fs });
  const out = await byName.upload_media.run({ topicId: 'd1', path: '~/a.jpg' });
  assert.deepEqual(out, {
    topicId: 'd1', mediaId: 'm-new', status: 'ready', bytes: 1000, fileName: 'a.jpg', contentType: 'image/jpeg', outcome: 'uploaded',
  });
  assert.equal(uploads.length, 1);
  const [args] = uploads;
  assert.deepEqual(args.file, { key: '/home/op/a.jpg', relPath: 'a.jpg', fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1000, revision: '1000:42' });
  assert.equal(args.topicId, 'd1');
  assert.equal(args.ledgerPath, CONFIG.uploadLedgerPath);
  assert.equal(args.entry, undefined);
  assert.equal((await args.readBytes(args.file)).byteLength, 1000);
});

test('upload_media with a .mov and no ffmpeg is refused with the install command', async () => {
  const fs = stubFs({ files: { '/home/op/v.mov': { size: 5 * MB } } });
  const { byName, uploads, client } = build({ fs, resolveTools: ffmpegMissing });
  const out = await byName.upload_media.run({ topicId: 'd1', path: '/home/op/v.mov' });
  assert.equal(out.refused, true);
  assert.match(out.reason, /needs ffmpeg/);
  assert.equal(out.install, 'sudo apt-get install -y ffmpeg');
  assert.equal(uploads.length, 0);
  assert.equal(client.writes().length, 0);
});

test('upload_media with a .mov converts it, validates the converted file and uploads that path', async () => {
  const outPath = join(CONFIG.convertDir, 'v.mp4');
  const fs = stubFs({ files: { '/home/op/v.mov': { size: 5 * MB, mtimeMs: 1 }, [outPath]: { size: 3 * MB, mtimeMs: 2 } } });
  const jobs = [];
  const { byName, uploads } = build({
    fs,
    resolveTools: ffmpegPresent,
    convertVideo: async (job, opts) => {
      jobs.push({ job, opts });
      return { outSizeBytes: 3 * MB, withinLimit: true, strategy: 'remux (stream copy)', attempts: 1 };
    },
  });
  const out = await byName.upload_media.run({ topicId: 'd1', path: '/home/op/v.mov' });
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].job, { absPath: '/home/op/v.mov', outPath, sizeLimit: 100 * MB });
  assert.deepEqual(jobs[0].opts.tools, { ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' });
  assert.deepEqual(fs.made, [CONFIG.convertDir]);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].file.key, outPath);
  assert.equal(uploads[0].file.fileName, 'v.mp4');
  assert.equal(uploads[0].file.contentType, 'video/mp4');
  assert.equal(uploads[0].file.revision, `${3 * MB}:2`);
  assert.equal(out.outcome, 'uploaded');
  assert.deepEqual(out.converted, { from: '/home/op/v.mov', to: outPath, strategy: 'remux (stream copy)', attempts: 1 });
});

test('upload_media refuses a .mov whose best encode is still over the limit', async () => {
  const fs = stubFs({ files: { '/home/op/v.mov': { size: 500 * MB } } });
  const { byName, uploads } = build({
    fs,
    resolveTools: ffmpegPresent,
    convertVideo: async () => ({ outSizeBytes: 120 * MB, withinLimit: false, strategy: 'transcode crf=31 width<=1280', attempts: 4 }),
  });
  const out = await byName.upload_media.run({ topicId: 'd1', path: '/home/op/v.mov' });
  assert.equal(out.refused, true);
  assert.match(out.reason, /still over the API limit/);
  assert.equal(uploads.length, 0);
});

// -- callTool: audit + MCP envelope -----------------------------------------

test('callTool audits every call (ok, refused, error) and shapes the MCP result', async () => {
  const lines = [];
  const audit = { record: (line) => lines.push(line) };
  let clock = 0;
  const now = () => (clock += 5);
  const { byName } = build();

  const ok = await callTool(byName.review_link, { topicId: 'd1' }, { audit, now });
  assert.equal(ok.isError, undefined);
  assert.equal(JSON.parse(ok.content[0].text).topicId, 'd1');

  const refused = await callTool(byName.update_topic_draft, { id: 'p1', markdown: 'x'.repeat(10) }, { audit, now });
  assert.equal(refused.isError, undefined);
  assert.equal(JSON.parse(refused.content[0].text).refused, true);

  const failed = await callTool(byName.read_topic, { id: 'nope' }, { audit, now });
  assert.equal(failed.isError, true);
  assert.equal(failed.content[0].text, 'read_topic failed: HTTP 404 NotFound');

  assert.deepEqual(lines.map((l) => [l.tool, l.outcome, l.durationMs]), [
    ['review_link', 'ok', 5],
    ['update_topic_draft', 'refused', 5],
    ['read_topic', 'error', 5],
  ]);
  assert.deepEqual(lines[1].args, { id: 'p1', markdown: 'xxxxxxxxxx' }, 'callTool hands the raw args; the audit writer redacts');
  assert.equal(lines[2].error, 'HTTP 404 NotFound');
});
