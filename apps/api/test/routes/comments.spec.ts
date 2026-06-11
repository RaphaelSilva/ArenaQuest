import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { JwtAuthAdapter } from '@api/adapters/auth';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------


const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT_A = 'cmt-student-a';
const STUDENT_B = 'cmt-student-b';
const STUDENT_C = 'cmt-student-c'; // never enrolled
const ADMIN_ID = 'cmt-admin-1';
const TOPIC_ID = 'cmt-topic-1';

let tokenA: string;
let tokenB: string;
let tokenC: string;
let adminToken: string;

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
    env.DB.prepare(`INSERT OR IGNORE INTO topic_nodes (id, title) VALUES (?, ?)`)
      .bind(TOPIC_ID, 'Test Topic'),
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
  [tokenA, tokenB, tokenC, adminToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT_A, email: 'a@cmt.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_B, email: 'b@cmt.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_C, email: 'c@cmt.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'admin@cmt.test', roles: ['admin'] }),
  ]);
});

async function req(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const request = new IncomingRequest(`http://example.com${path}`, {
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
    const body = await res.json<{ id: string; body: string }>();
    expect(body.body).toBe('First comment');
    expect(body.id).toBeTruthy();
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
    const request = new IncomingRequest(`http://example.com/topics/${TOPIC_ID}/comments`, {
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
    const res = await req('GET', '/openapi.json');
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
