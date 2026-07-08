import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------


const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT_A = 'cmt-student-a';
const STUDENT_B = 'cmt-student-b';
const STUDENT_C = 'cmt-student-c'; // never enrolled
const ADMIN_ID = 'cmt-admin-1';
const CREATOR_ID = 'cmt-creator-1';
const TOPIC_ID = 'cmt-topic-1';
const PUBLIC_TOPIC_ID = 'cmt-public-topic-1';
const RESTRICTED_TOPIC_ID = 'cmt-restricted-topic-1'; // restricted, nobody enrolled

let tokenA: string;
let tokenB: string;
let tokenC: string;
let adminToken: string;
let creatorToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(STUDENT_A, 'Student A', 'a@cmt.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(STUDENT_B, 'Student B', 'b@cmt.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(STUDENT_C, 'Student C', 'c@cmt.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(ADMIN_ID, 'Admin', 'admin@cmt.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(CREATOR_ID, 'Creator', 'creator@cmt.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO topic_nodes (id, title) VALUES (?, ?)`)
      .bind(TOPIC_ID, 'Test Topic'),
    env.DB.prepare(`INSERT OR IGNORE INTO topic_nodes (id, title, status, visibility) VALUES (?, ?, ?, ?)`)
      .bind(PUBLIC_TOPIC_ID, 'Public Topic', 'published', 'public'),
    env.DB.prepare(`INSERT OR IGNORE INTO topic_nodes (id, title, status, visibility) VALUES (?, ?, ?, ?)`)
      .bind(RESTRICTED_TOPIC_ID, 'Restricted Topic', 'published', 'restricted'),
    // Enroll student A in the topic
    env.DB.prepare(`INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)`)
      .bind('enroll-a', STUDENT_A, TOPIC_ID, ADMIN_ID),
    // Enroll student B in the topic (needed for delete test)
    env.DB.prepare(`INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)`)
      .bind('enroll-b-del', STUDENT_B, TOPIC_ID, ADMIN_ID),
    // Enroll admin in topic (needed for delete test)
    env.DB.prepare(`INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)`)
      .bind('enroll-admin', ADMIN_ID, TOPIC_ID, ADMIN_ID),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [tokenA, tokenB, tokenC, adminToken, creatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT_A, email: 'a@cmt.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_B, email: 'b@cmt.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_C, email: 'c@cmt.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'admin@cmt.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: CREATOR_ID, email: 'creator@cmt.test', roles: ['content_creator'] }),
  ]);
});

async function req(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe('auth guard', () => {
  it('GET /topics/:id/comments returns 401 without token', async () => {
    const res = await req('GET', `/topics/${TOPIC_ID}/comments`);
    expect(res.status).toBe(401);
  });

  it('POST /topics/:id/comments returns 401 without token', async () => {
    const res = await req('POST', `/topics/${TOPIC_ID}/comments`, { body: { body: 'hi' } });
    expect(res.status).toBe(401);
  });

  it('POST /me/comments/:id/like returns 401 without token', async () => {
    const res = await req('POST', '/me/comments/any-id/like');
    expect(res.status).toBe(401);
  });

  it('DELETE /me/comments/:id returns 401 without token', async () => {
    const res = await req('DELETE', '/me/comments/any-id');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Enrollment access check
// ---------------------------------------------------------------------------

describe('enrollment access', () => {
  it('GET /topics/:id/comments returns 403 for unenrolled user', async () => {
    const res = await req('GET', `/topics/${TOPIC_ID}/comments`, { token: tokenC });
    expect(res.status).toBe(403);
  });

  it('POST /topics/:id/comments returns 403 for unenrolled user', async () => {
    const res = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenC,
      body: { body: 'Hi there' },
    });
    expect(res.status).toBe(403);
  });

  it('GET /topics/:id/comments returns 200 for enrolled user', async () => {
    const res = await req('GET', `/topics/${TOPIC_ID}/comments`, { token: tokenA });
    expect(res.status).toBe(200);
  });

  it('GET /topics/:id/comments includes the author display name', async () => {
    await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Comment with author name' },
    });

    const res = await req('GET', `/topics/${TOPIC_ID}/comments`, { token: tokenA });
    expect(res.status).toBe(200);
    const { data } = await res.json<{ data: Array<{ userId: string; userName: string }> }>();
    const fromA = data.find(c => c.userId === STUDENT_A);
    expect(fromA?.userName).toBe('Student A');
  });
});

// ---------------------------------------------------------------------------
// Privileged bypass — admins/content creators read & write on restricted
// topics they are NOT enrolled in (mirrors topic-read bypass in catalog router).
// ---------------------------------------------------------------------------

describe('privileged bypass on restricted topic (unenrolled)', () => {
  it('plain student gets 403 on a restricted topic they are not enrolled in', async () => {
    const res = await req('GET', `/topics/${RESTRICTED_TOPIC_ID}/comments`, { token: tokenC });
    expect(res.status).toBe(403);
  });

  it('admin can GET comments without enrollment', async () => {
    const res = await req('GET', `/topics/${RESTRICTED_TOPIC_ID}/comments`, { token: adminToken });
    expect(res.status).toBe(200);
  });

  it('content creator can GET comments without enrollment', async () => {
    const res = await req('GET', `/topics/${RESTRICTED_TOPIC_ID}/comments`, { token: creatorToken });
    expect(res.status).toBe(200);
  });

  it('content creator can POST a comment without enrollment', async () => {
    const res = await req('POST', `/topics/${RESTRICTED_TOPIC_ID}/comments`, {
      token: creatorToken,
      body: { body: 'Creator comment on restricted topic' },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ body: string }>();
    expect(body.body).toBe('Creator comment on restricted topic');
  });
});

// ---------------------------------------------------------------------------
// Create, list, reply
// ---------------------------------------------------------------------------

describe('POST /topics/:id/comments', () => {
  it('creates a top-level comment', async () => {
    const res = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'First comment' },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; body: string; userName: string }>();
    expect(body.body).toBe('First comment');
    expect(body.id).toBeTruthy();
    // Author display name is resolved from users.name, not the raw user id
    expect(body.userName).toBe('Student A');
  });

  it('creates a reply to a top-level comment', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Parent comment' },
    });
    const parent = await createRes.json<{ id: string }>();

    const replyRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Reply to parent', parentCommentId: parent.id },
    });
    expect(replyRes.status).toBe(201);
    const reply = await replyRes.json<{ parentCommentId: string }>();
    expect(reply.parentCommentId).toBe(parent.id);
  });

  it('returns 400 NESTED_REPLY_FORBIDDEN for reply to a reply', async () => {
    const parentRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Level 1' },
    });
    const parent = await parentRes.json<{ id: string }>();

    const replyRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Level 2', parentCommentId: parent.id },
    });
    const reply = await replyRes.json<{ id: string }>();

    const nestedRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Level 3 (forbidden)', parentCommentId: reply.id },
    });
    expect(nestedRes.status).toBe(400);
    const body = await nestedRes.json<{ error: string }>();
    expect(body.error).toBe('NESTED_REPLY_FORBIDDEN');
  });

  it('strips HTML tags from body', async () => {
    const res = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: '<b>Bold</b> text' },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ body: string }>();
    expect(body.body).toBe('Bold text');
    expect(body.body).not.toContain('<b>');
  });

  it('returns 400 for malformed JSON body', async () => {
    const request = new IncomingRequest(`http://example.com${v1(`/topics/${TOPIC_ID}/comments`)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: 'not-valid-json{{{',
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

describe('DELETE /me/comments/:id', () => {
  it('author can delete own comment', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'To be deleted' },
    });
    const comment = await createRes.json<{ id: string }>();

    const deleteRes = await req('DELETE', `/me/comments/${comment.id}`, { token: tokenA });
    expect(deleteRes.status).toBe(204);
  });

  it('deleted comment body is null in listing', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Will be deleted' },
    });
    const comment = await createRes.json<{ id: string }>();

    await req('DELETE', `/me/comments/${comment.id}`, { token: tokenA });

    const listRes = await req('GET', `/topics/${TOPIC_ID}/comments`, { token: tokenA });
    const { data } = await listRes.json<{ data: Array<{ id: string; body: string | null }> }>();
    const deleted = data.find(c => c.id === comment.id);
    expect(deleted).toBeDefined();
    expect(deleted?.body).toBeNull();
  });

  it('another user cannot delete a comment they do not own', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Only A can delete this' },
    });
    const comment = await createRes.json<{ id: string }>();

    // B tries to delete A's comment
    const deleteRes = await req('DELETE', `/me/comments/${comment.id}`, { token: tokenB });
    expect(deleteRes.status).toBe(403);
  });

  it('admin can delete any comment', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Admin will delete this' },
    });
    const comment = await createRes.json<{ id: string }>();

    const deleteRes = await req('DELETE', `/me/comments/${comment.id}`, { token: adminToken });
    expect(deleteRes.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// OpenAPI contract
// ---------------------------------------------------------------------------

describe('OpenAPI contract', () => {
  it('comment endpoints appear in /openapi.json', async () => {
    // /openapi.json is unversioned — call worker.fetch directly to avoid the v1() prefix in req()
    const r = new IncomingRequest('http://example.com/openapi.json', { method: 'GET' });
    const ctx = createExecutionContext();
    const res = await worker.fetch(r, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const doc = await res.json<{ paths: Record<string, unknown> }>();
    const commentPath = doc.paths['/v1/topics/{id}/comments'] as Record<string, unknown> | undefined;
    expect(commentPath).toBeDefined();
    expect(commentPath).toHaveProperty('get');
    expect(commentPath).toHaveProperty('post');
  });
});

// ---------------------------------------------------------------------------
// Like toggle
// ---------------------------------------------------------------------------

describe('POST /me/comments/:id/like', () => {
  it('liked_by_me reflects toggle state', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Likeable comment' },
    });
    const comment = await createRes.json<{ id: string }>();

    // Like
    const likeRes = await req('POST', `/me/comments/${comment.id}/like`, { token: tokenA });
    expect(likeRes.status).toBe(200);
    const likeBody = await likeRes.json<{ liked: boolean }>();
    expect(likeBody.liked).toBe(true);

    // Unlike
    const unlikeRes = await req('POST', `/me/comments/${comment.id}/like`, { token: tokenA });
    const unlikeBody = await unlikeRes.json<{ liked: boolean }>();
    expect(unlikeBody.liked).toBe(false);
  });

  it('returns 404 for unknown comment', async () => {
    const res = await req('POST', '/me/comments/00000000-0000-0000-0000-000000000000/like', { token: tokenA });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Public topic visibility — unenrolled access
// ---------------------------------------------------------------------------

describe('public topic visibility — unenrolled access', () => {
  it('unenrolled tokenC can GET comments on a public topic', async () => {
    const res = await req('GET', `/topics/${PUBLIC_TOPIC_ID}/comments`, { token: tokenC });
    expect(res.status).toBe(200);
  });

  it('unenrolled tokenC can POST a comment on a public topic', async () => {
    const res = await req('POST', `/topics/${PUBLIC_TOPIC_ID}/comments`, {
      token: tokenC,
      body: { body: 'Public topic comment from unenrolled user' },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; body: string }>();
    expect(body.body).toBe('Public topic comment from unenrolled user');
  });
});
