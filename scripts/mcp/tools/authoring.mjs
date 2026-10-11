/**
 * scripts/mcp/tools/authoring.mjs — Plane A of aq-mcp (RFC 0025 §2): the
 * seven draft-authoring tools.
 *
 *   list_topics · read_topic · topic_comments            reads
 *   create_topic_draft · update_topic_draft · upload_media   writes (drafts only)
 *   review_link                                          read
 *
 * Every tool talks to the PUBLIC API through `scripts/lib/api-client.mjs` as a
 * dedicated `content_creator`; nothing here opens wrangler, SQL or R2. The
 * guarantees the tests pin:
 *
 *   - no input schema has a `status` property, and no request body ever
 *     carries one: a create answers `draft` because the API defaults to it,
 *     and the publish transition is an admin act the API enforces (Task 07);
 *   - `update_topic_draft` and `upload_media` READ the topic first and refuse
 *     anything that is not a `draft` before any write call — a refusal is a
 *     normal result with `refused: true` so the model can read the reason;
 *   - `upload_media` validates type and size against the shared limits BEFORE
 *     presign, converts `.mov` through `scripts/lib/convert.mjs` (a missing
 *     `ffmpeg` is reported with its install command, never installed), and
 *     then runs the importer's `presign -> PUT -> finalize` with its ledger;
 *   - `create_topic_draft` is serialised: `sort_order` derives from a
 *     non-transactional `MAX`, so two concurrent creates would collide;
 *   - `topic_comments` returns comments only — never notes, never submissions;
 *   - one audit line per call, bodies redacted (`../audit.mjs`).
 *
 * Credentials are never tool arguments; they live in the client. Stdout is the
 * MCP channel, so nothing here writes to it.
 */

import { promises as fsPromises } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { basename, extname, join, resolve as resolvePath } from 'node:path';
import { z } from 'zod';

import {
  ApiError,
  SIZE_LIMIT_BYTES,
  readLedger as defaultReadLedger,
  uploadFile as defaultUploadFile,
  validateMediaFile as defaultValidateMediaFile,
  withRetry,
} from '../../lib/api-client.mjs';
import { convertVideo as defaultConvertVideo, resolveTools as defaultResolveTools } from '../../lib/convert.mjs';

/** The seven tool names, in the order they are registered. */
export const AUTHORING_TOOL_NAMES = [
  'list_topics',
  'read_topic',
  'topic_comments',
  'create_topic_draft',
  'update_topic_draft',
  'upload_media',
  'review_link',
];

/** Annotations the client uses to auto-approve reads and prompt on writes. */
export const READ_ANNOTATIONS = Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
export const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
});

const DRAFT = 'draft';

// -- helpers ------------------------------------------------------------------

/** A policy answer the model should read; never an MCP error. */
function refuse(reason, extra = {}) {
  return { refused: true, reason, ...extra };
}

function notDraft(topic) {
  return refuse(
    `topic ${topic.id} is ${topic.status}; the assistant edits drafts only — unpublish it in the backoffice first`,
    { topicId: topic.id, status: topic.status },
  );
}

function tagNames(tags) {
  return Array.isArray(tags) ? tags.map((tag) => (typeof tag === 'string' ? tag : tag?.name)).filter(Boolean) : [];
}

function mediaSummary(media) {
  return {
    id: media.id,
    originalName: media.originalName,
    type: media.type,
    sizeBytes: media.sizeBytes,
    status: media.status,
  };
}

/** `~` and `~/x` expand to the home directory; everything else resolves from cwd. */
export function expandPath(input, { homedir = osHomedir } = {}) {
  const raw = String(input ?? '').trim();
  if (raw === '') throw new Error('path is required');
  if (raw === '~') return homedir();
  if (raw.startsWith('~/')) return resolvePath(homedir(), raw.slice(2));
  return resolvePath(raw);
}

/** Parse the optional `since` cursor; an unparsable value is a refusal, not a crash. */
function parseSince(since) {
  if (since === undefined || since === null || since === '') return null;
  const ms = Date.parse(since);
  if (Number.isNaN(ms)) return undefined;
  return ms;
}

/** `GET /v1/admin/topics/{id}` — the admin read, so drafts are visible. */
async function readTopic(client, id) {
  return withRetry(() => client.request('GET', `/v1/admin/topics/${encodeURIComponent(id)}`));
}

// -- tool builders -----------------------------------------------------------

/**
 * Build the seven tools. Every dependency is injectable so the tests run with
 * the client, the file system and the converter stubbed — no network, no
 * ffmpeg. `config` is the server's: `{ label, env, webOrigin, uploadLedgerPath,
 * convertDir }`.
 *
 * Each tool is `{ name, title, description, inputSchema, annotations, run }`
 * where `run(args)` returns the plain result (or a `{ refused: true }` answer)
 * and throws on failure. `callTool` below adds the audit line and the MCP
 * envelope; `registerAuthoringTools` wires both into an `McpServer`.
 */
export function buildAuthoringTools({
  client,
  config,
  fs = fsPromises,
  homedir = osHomedir,
  resolveTools = defaultResolveTools,
  convertVideo = defaultConvertVideo,
  uploadFile = defaultUploadFile,
  readLedger = defaultReadLedger,
  validateMediaFile = defaultValidateMediaFile,
  fetchImpl = fetch,
} = {}) {
  if (!client) throw new TypeError('buildAuthoringTools: client is required');
  if (!config) throw new TypeError('buildAuthoringTools: config is required');

  // Serialises `create_topic_draft`: the importer's rule — `sort_order` is a
  // non-transactional `SELECT MAX`, so concurrent sibling creates collide.
  let createChain = Promise.resolve();

  const listTopics = {
    name: 'list_topics',
    title: 'List topics',
    description:
      'List topics with status, order and media count. With parentId: the direct children of that topic. ' +
      'Without it: every topic (flat; use parentId to rebuild the tree). Sorted by order.',
    inputSchema: {
      parentId: z.string().optional().describe('Id of the parent topic; omit for the whole flat list'),
    },
    annotations: READ_ANNOTATIONS,
    async run({ parentId } = {}) {
      const response = await withRetry(() => client.request('GET', '/v1/admin/topics'));
      const all = Array.isArray(response?.data) ? response.data : [];
      const selected = parentId === undefined ? all : all.filter((topic) => topic.parentId === parentId);
      const topics = selected
        .map((topic) => ({
          id: topic.id,
          parentId: topic.parentId ?? null,
          title: topic.title,
          status: topic.status,
          order: topic.order,
          estimatedMinutes: topic.estimatedMinutes,
          mediaCount: topic.mediaCount?.total ?? (Array.isArray(topic.media) ? topic.media.length : 0),
          tags: tagNames(topic.tags),
        }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      return { parentId: parentId ?? null, count: topics.length, topics };
    },
  };

  const readTopicTool = {
    name: 'read_topic',
    title: 'Read a topic',
    description: 'Read one topic: title, markdown content, status, tags, estimated minutes, media list and direct children.',
    inputSchema: {
      id: z.string().describe('Topic id'),
    },
    annotations: READ_ANNOTATIONS,
    async run({ id }) {
      const topic = await readTopic(client, id);
      const mediaResponse = await withRetry(() =>
        client.request('GET', `/v1/admin/topics/${encodeURIComponent(id)}/media`),
      );
      const media = Array.isArray(mediaResponse?.data) ? mediaResponse.data : [];
      return {
        id: topic.id,
        parentId: topic.parentId ?? null,
        title: topic.title,
        status: topic.status,
        markdown: topic.content ?? '',
        tags: tagNames(topic.tags),
        estimatedMinutes: topic.estimatedMinutes,
        media: media.map(mediaSummary),
        children: (topic.children ?? []).map((child) => ({ id: child.id, title: child.title, status: child.status })),
      };
    },
  };

  const topicComments = {
    name: 'topic_comments',
    title: 'Topic comments',
    description:
      'Student comments on a topic (for summarising). Comments only — never private notes or submissions. ' +
      'Deleted comments are dropped. A draft or archived topic is not readable in the catalog and answers an empty list.',
    inputSchema: {
      id: z.string().describe('Topic id'),
      since: z.string().optional().describe('ISO 8601 timestamp; only comments created at or after it'),
    },
    annotations: READ_ANNOTATIONS,
    async run({ id, since }) {
      const sinceMs = parseSince(since);
      if (sinceMs === undefined) return refuse(`since must be an ISO 8601 timestamp (got "${since}")`);
      let response;
      try {
        response = await withRetry(() => client.request('GET', `/v1/topics/${encodeURIComponent(id)}/comments`));
      } catch (err) {
        // The catalog's gate: a draft/archived topic (or one outside the
        // account's access set) answers 403/404. Report it, do not fail.
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          return { topicId: id, comments: [], note: 'topic not readable in the catalog (draft or archived)' };
        }
        throw err;
      }
      const rows = Array.isArray(response?.data) ? response.data : [];
      const comments = rows
        .filter((row) => row.deletedAt === null || row.deletedAt === undefined)
        .filter((row) => sinceMs === null || Date.parse(row.createdAt) >= sinceMs)
        .map((row) => ({
          id: row.id,
          author: row.userName,
          body: row.body,
          createdAt: row.createdAt,
          likeCount: row.likeCount ?? 0,
          replyTo: row.parentCommentId ?? null,
        }));
      return { topicId: id, since: since ?? null, count: comments.length, comments };
    },
  };

  const createTopicDraft = {
    name: 'create_topic_draft',
    title: 'Create a draft topic',
    description:
      'Create a topic as a DRAFT (the only status this tool can produce; publishing is done by an admin in the backoffice). ' +
      'Tags are names; an existing tag is reused.',
    inputSchema: {
      parentId: z.string().optional().describe('Parent topic id; omit for a root topic'),
      title: z.string().min(1).describe('Topic title'),
      markdown: z.string().describe('Topic content in Markdown (sanitised by the API)'),
      tags: z.array(z.string()).optional().describe('Tag names'),
      estimatedMinutes: z.number().int().min(0).optional().describe('Estimated study time in minutes'),
    },
    annotations: WRITE_ANNOTATIONS,
    run({ parentId, title, markdown, tags, estimatedMinutes }) {
      // No `status` key, ever: the API defaults a new topic to `draft`.
      const body = {
        title,
        content: markdown,
        ...(parentId !== undefined ? { parentId } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
      };
      const next = createChain.then(() =>
        withRetry(() => client.request('POST', '/v1/admin/topics', { body, expectStatus: 201 })),
      );
      // The chain itself never rejects, so one failed create does not block the next.
      createChain = next.then(
        () => undefined,
        () => undefined,
      );
      return next.then((topic) => ({
        id: topic.id,
        parentId: topic.parentId ?? null,
        title: topic.title,
        status: topic.status,
      }));
    },
  };

  const updateTopicDraft = {
    name: 'update_topic_draft',
    title: 'Update a draft topic',
    description:
      'Edit the title, markdown, tags or estimated minutes of a DRAFT topic. Refused when the stored topic is not a draft ' +
      '(unpublish it in the backoffice first). Never changes the status.',
    inputSchema: {
      id: z.string().describe('Topic id'),
      title: z.string().min(1).optional(),
      markdown: z.string().optional().describe('Replacement Markdown content'),
      tags: z.array(z.string()).optional().describe('Replacement tag names; [] clears them'),
      estimatedMinutes: z.number().int().min(0).optional(),
    },
    annotations: WRITE_ANNOTATIONS,
    async run({ id, title, markdown, tags, estimatedMinutes }) {
      const body = {
        ...(title !== undefined ? { title } : {}),
        ...(markdown !== undefined ? { content: markdown } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
      };
      if (Object.keys(body).length === 0) return refuse('nothing to update: pass at least one of title, markdown, tags, estimatedMinutes');

      // Read first, decide, then write — never the other way round.
      const existing = await readTopic(client, id);
      if (existing.status !== DRAFT) return notDraft(existing);

      const updated = await withRetry(() =>
        client.request('PATCH', `/v1/admin/topics/${encodeURIComponent(id)}`, { body }),
      );
      return { id: updated.id, title: updated.title, status: updated.status, changed: Object.keys(body) };
    },
  };

  const uploadMedia = {
    name: 'upload_media',
    title: 'Upload a local media file',
    description:
      'Upload a file from this machine\'s disk to a DRAFT topic (mp4, pdf, jpg, png, webp; a .mov is converted to mp4 first, ' +
      'which needs ffmpeg). Type and size are checked against the API limits before anything is sent.',
    inputSchema: {
      topicId: z.string().describe('Target topic id (must be a draft)'),
      path: z.string().describe('Local file path; ~ is expanded'),
    },
    annotations: WRITE_ANNOTATIONS,
    async run({ topicId, path }) {
      const absPath = expandPath(path, { homedir });
      let stat;
      try {
        stat = await fs.stat(absPath);
      } catch (err) {
        if (err?.code === 'ENOENT') return refuse(`file not found: ${absPath}`, { path: absPath });
        throw err;
      }
      if (!stat.isFile()) return refuse(`not a regular file: ${absPath}`, { path: absPath });

      // The draft check comes before any conversion or upload work.
      const topic = await readTopic(client, topicId);
      if (topic.status !== DRAFT) return notDraft(topic);

      let source = { absPath, fileName: basename(absPath), sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
      let converted = null;

      if (extname(absPath).toLowerCase() === '.mov') {
        const { resolved, missing } = resolveTools(['ffmpeg']);
        if (missing.length > 0) {
          const [first] = missing;
          return refuse(`converting ${source.fileName} needs ${first.role} (not found on PATH)`, {
            path: absPath,
            missing: missing.map((m) => m.role),
            install: first.fix,
          });
        }
        await fs.mkdir(config.convertDir, { recursive: true });
        const outPath = join(config.convertDir, `${basename(absPath, extname(absPath))}.mp4`);
        const result = await convertVideo(
          { absPath, outPath, sizeLimit: SIZE_LIMIT_BYTES['video/mp4'] },
          { tools: resolved },
        );
        if (!result.withinLimit) {
          return refuse(
            `${source.fileName} converted to ${result.outSizeBytes} bytes, still over the API limit of ${SIZE_LIMIT_BYTES['video/mp4']} bytes for video/mp4`,
            { path: absPath, convertedPath: outPath, strategy: result.strategy },
          );
        }
        const outStat = await fs.stat(outPath);
        converted = { from: absPath, to: outPath, strategy: result.strategy, attempts: result.attempts };
        source = { absPath: outPath, fileName: basename(outPath), sizeBytes: outStat.size, mtimeMs: outStat.mtimeMs };
      }

      // The shared preflight, on the bytes that will actually be sent — before presign.
      const check = validateMediaFile({ fileName: source.fileName, sizeBytes: source.sizeBytes });
      if (!check.ok) return refuse(check.reason, { path: source.absPath, state: check.state });

      const file = {
        key: source.absPath,
        relPath: source.fileName,
        fileName: source.fileName,
        contentType: check.contentType,
        sizeBytes: source.sizeBytes,
        revision: `${source.sizeBytes}:${source.mtimeMs}`,
      };
      const entry = readLedger(config.uploadLedgerPath).get(file.key);
      const outcome = await uploadFile(client, {
        file,
        topicId,
        ledgerPath: config.uploadLedgerPath,
        entry,
        readBytes: (f) => fs.readFile(f.key),
        fetchImpl,
      });

      return {
        topicId,
        mediaId: outcome.media?.id ?? entry?.mediaId ?? null,
        status: outcome.media?.status ?? 'ready',
        bytes: file.sizeBytes,
        fileName: file.fileName,
        contentType: file.contentType,
        outcome: outcome.outcome,
        ...(converted ? { converted } : {}),
      };
    },
  };

  const reviewLink = {
    name: 'review_link',
    title: 'Backoffice review link',
    description:
      'Where the operator reviews (and, as an admin, publishes) a topic. The backoffice has no per-topic deep link: ' +
      'open the page and select the topic by title.',
    inputSchema: {
      topicId: z.string().describe('Topic id'),
    },
    annotations: READ_ANNOTATIONS,
    async run({ topicId }) {
      const topic = await readTopic(client, topicId);
      return {
        url: `${config.webOrigin.replace(/\/$/, '')}/admin/topics`,
        topicId: topic.id,
        title: topic.title,
        status: topic.status,
        hint: 'open the page and select the topic by title',
      };
    },
  };

  return [listTopics, readTopicTool, topicComments, createTopicDraft, updateTopicDraft, uploadMedia, reviewLink];
}

// -- MCP envelope + audit ----------------------------------------------------

/** First line of an error, never the API body dump. */
export function errorMessage(err) {
  const text = err instanceof Error ? err.message : String(err);
  return text.split('\n')[0];
}

/**
 * Run one tool call: time it, audit it (always, in `finally`), and shape the
 * MCP result. A thrown error becomes `isError: true` with the first line of
 * the message; a refusal is a normal result the model reads.
 */
export async function callTool(tool, args, { audit, now = () => performance.now() }) {
  const t0 = now();
  let outcome = 'ok';
  let error;
  try {
    const result = await tool.run(args ?? {});
    if (result && result.refused === true) outcome = 'refused';
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    outcome = 'error';
    error = errorMessage(err);
    return { isError: true, content: [{ type: 'text', text: `${tool.name} failed: ${error}` }] };
  } finally {
    audit.record({ tool: tool.name, args, outcome, durationMs: now() - t0, error });
  }
}

/** Register the seven tools on an `McpServer`. Returns the built tool list. */
export function registerAuthoringTools(server, { audit, now, ...deps }) {
  if (!audit) throw new TypeError('registerAuthoringTools: audit is required');
  const tools = buildAuthoringTools(deps);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, ...tool.annotations },
      },
      (args) => callTool(tool, args, { audit, ...(now ? { now } : {}) }),
    );
  }
  return tools;
}
