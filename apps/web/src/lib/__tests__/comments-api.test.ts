import { describe, it, expect, vi } from 'vitest';
import { createCommentsApi, CommentsApiError } from '../comments-api';
import type { HttpTransport } from '../api-client';

function makeTransport(responses: Partial<Response>[]): HttpTransport {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const res = responses[callCount++] ?? { ok: false, status: 500 };
    return Promise.resolve(res);
  });
}

function makeResponse(overrides: Partial<Response> & { jsonData?: unknown } = {}): Response {
  const { jsonData, ...rest } = overrides;
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(jsonData ?? {}),
    ...rest,
  } as unknown as Response;
}

describe('createCommentsApi', () => {
  const COMMENT = {
    id: 'c1',
    userId: 'u1',
    body: 'Hello',
    createdAt: '2026-01-01T00:00:00Z',
    likeCount: 0,
    likedByMe: false,
    parentCommentId: null,
  };

  describe('listForTopic', () => {
    it('returns array of comments on success', async () => {
      const http = makeTransport([makeResponse({ jsonData: { data: [COMMENT] } })]);
      const api = createCommentsApi(http);
      const result = await api.listForTopic('topic1');
      expect(result).toEqual([COMMENT]);
      expect(http).toHaveBeenCalledWith('GET', '/topics/topic1/comments');
    });

    it('throws Unauthorized on 401', async () => {
      const http = makeTransport([makeResponse({ ok: false, status: 401 })]);
      const api = createCommentsApi(http);
      await expect(api.listForTopic('topic1')).rejects.toMatchObject({
        code: 'Unauthorized',
        status: 401,
      });
    });

    it('throws NotFound on 404', async () => {
      const http = makeTransport([makeResponse({ ok: false, status: 404 })]);
      const api = createCommentsApi(http);
      await expect(api.listForTopic('topic1')).rejects.toMatchObject({
        code: 'NotFound',
        status: 404,
      });
    });

    it('throws NetworkError on network failure', async () => {
      const http = vi.fn().mockRejectedValueOnce(new Error('network'));
      const api = createCommentsApi(http as unknown as HttpTransport);
      await expect(api.listForTopic('topic1')).rejects.toMatchObject({
        code: 'NetworkError',
        status: 0,
      });
    });

    it('throws Unknown on other non-ok responses', async () => {
      const http = makeTransport([makeResponse({ ok: false, status: 500 })]);
      const api = createCommentsApi(http);
      await expect(api.listForTopic('topic1')).rejects.toMatchObject({
        code: 'Unknown',
        status: 500,
      });
    });
  });

  describe('createForTopic', () => {
    it('returns created comment on success', async () => {
      const http = makeTransport([makeResponse({ jsonData: COMMENT })]);
      const api = createCommentsApi(http);
      const result = await api.createForTopic('topic1', 'Hello');
      expect(result).toEqual(COMMENT);
      expect(http).toHaveBeenCalledWith('POST', '/topics/topic1/comments', {
        body: JSON.stringify({ body: 'Hello' }),
      });
    });

    it('throws Unauthorized on 401', async () => {
      const http = makeTransport([makeResponse({ ok: false, status: 401 })]);
      const api = createCommentsApi(http);
      await expect(api.createForTopic('topic1', 'text')).rejects.toMatchObject({
        code: 'Unauthorized',
      });
    });

    it('throws NetworkError on network failure', async () => {
      const http = vi.fn().mockRejectedValueOnce(new Error('network'));
      const api = createCommentsApi(http as unknown as HttpTransport);
      await expect(api.createForTopic('topic1', 'text')).rejects.toMatchObject({
        code: 'NetworkError',
      });
    });
  });

  describe('toggleLike', () => {
    it('resolves void on success', async () => {
      const http = makeTransport([makeResponse({ status: 200 })]);
      const api = createCommentsApi(http);
      await expect(api.toggleLike('c1')).resolves.toBeUndefined();
      expect(http).toHaveBeenCalledWith('POST', '/me/comments/c1/like');
    });

    it('throws Unauthorized on 401', async () => {
      const http = makeTransport([makeResponse({ ok: false, status: 401 })]);
      const api = createCommentsApi(http);
      await expect(api.toggleLike('c1')).rejects.toMatchObject({
        code: 'Unauthorized',
      });
    });

    it('throws NotFound on 404', async () => {
      const http = makeTransport([makeResponse({ ok: false, status: 404 })]);
      const api = createCommentsApi(http);
      await expect(api.toggleLike('c1')).rejects.toMatchObject({
        code: 'NotFound',
      });
    });

    it('throws NetworkError on network failure', async () => {
      const http = vi.fn().mockRejectedValueOnce(new Error('network'));
      const api = createCommentsApi(http as unknown as HttpTransport);
      await expect(api.toggleLike('c1')).rejects.toMatchObject({
        code: 'NetworkError',
      });
    });
  });

  it('CommentsApiError is instanceof Error', () => {
    const err = new CommentsApiError('Unknown', 500, 'oops');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('Unknown');
    expect(err.status).toBe(500);
    expect(err.message).toBe('oops');
  });
});
