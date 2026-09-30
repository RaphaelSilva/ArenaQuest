import { describe, expect, it, vi } from 'vitest';
import { createNotesApi, NotesApiError, type Note } from '@web/lib/notes-api';

const NOTE: Note = {
  id: 'n1',
  topicNodeId: 't1',
  authorId: 'me',
  authorName: 'Me',
  body: 'hello',
  visibility: 'private',
  revision: 2,
  sharedAt: null,
  moderated: false,
  createdAt: '2026-09-28 12:00:00',
  updatedAt: '2026-09-28 12:00:00',
};

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('notes-api', () => {
  it('getMine unwraps the data envelope, null included', async () => {
    const http = vi.fn().mockResolvedValueOnce(json(200, { data: NOTE })).mockResolvedValueOnce(json(200, { data: null }));
    const api = createNotesApi(http);

    expect(await api.getMine('t1')).toEqual(NOTE);
    expect(await api.getMine('t1')).toBeNull();
    expect(http).toHaveBeenCalledWith('GET', '/topics/t1/notes/me', undefined);
  });

  it('saveMine PUTs the body and reports created on 201', async () => {
    const http = vi.fn().mockResolvedValue(json(201, NOTE));
    const api = createNotesApi(http);

    const result = await api.saveMine('t1', { body: 'hello', baseRevision: 0 });

    expect(result).toEqual({ kind: 'saved', note: NOTE, created: true });
    expect(http).toHaveBeenCalledWith('PUT', '/topics/t1/notes/me', {
      body: JSON.stringify({ body: 'hello', baseRevision: 0 }),
    });
  });

  it('reads NOTE_STALE with `current` at the top level of the body', async () => {
    const api = createNotesApi(vi.fn().mockResolvedValue(json(409, { error: 'NOTE_STALE', current: NOTE })));
    expect(await api.saveMine('t1', { body: 'x', baseRevision: 1 })).toEqual({ kind: 'stale', current: NOTE });

    const gone = createNotesApi(vi.fn().mockResolvedValue(json(409, { error: 'NOTE_STALE', current: null })));
    expect(await gone.saveMine('t1', { body: 'x', baseRevision: 1 })).toEqual({ kind: 'stale', current: null });
  });

  it('maps NOTE_MODERATED and the 400 codes to typed results', async () => {
    const moderated = createNotesApi(vi.fn().mockResolvedValue(json(409, { error: 'NOTE_MODERATED' })));
    expect(await moderated.saveMine('t1', { body: 'x', baseRevision: 1, visibility: 'shared' })).toEqual({ kind: 'moderated' });

    const tooLong = createNotesApi(vi.fn().mockResolvedValue(json(400, { error: 'NOTE_BODY_TOO_LONG', max: 20000 })));
    expect(await tooLong.saveMine('t1', { body: 'x', baseRevision: 1 })).toEqual({ kind: 'invalid', code: 'NOTE_BODY_TOO_LONG' });

    const malformed = createNotesApi(vi.fn().mockResolvedValue(json(400, { error: 'BadRequest' })));
    expect(await malformed.saveMine('t1', { body: 'x', baseRevision: 1 })).toEqual({ kind: 'invalid', code: 'BadRequest' });
  });

  it('throws NotesApiError for 404, 401 and network failures', async () => {
    const notFound = createNotesApi(vi.fn().mockResolvedValue(json(404, { error: 'NotFound' })));
    await expect(notFound.saveMine('t1', { body: 'x', baseRevision: 0 })).rejects.toMatchObject({ code: 'NotFound' });
    await expect(notFound.deleteMine('t1')).rejects.toBeInstanceOf(NotesApiError);

    const unauthorized = createNotesApi(vi.fn().mockResolvedValue(json(401, {})));
    await expect(unauthorized.getMine('t1')).rejects.toMatchObject({ code: 'Unauthorized' });

    const offline = createNotesApi(vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(offline.getMine('t1')).rejects.toMatchObject({ code: 'NetworkError' });
  });

  it('deleteMine resolves on 204', async () => {
    const http = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(createNotesApi(http).deleteMine('t1')).resolves.toBeUndefined();
    expect(http).toHaveBeenCalledWith('DELETE', '/topics/t1/notes/me', undefined);
  });

  it('listForTopic GETs the first page and encodes the cursor on the next', async () => {
    const page = { data: [{ ...NOTE, visibility: 'shared', isMine: true }], nextCursor: 'a b/c' };
    const http = vi.fn().mockImplementation(async () => json(200, page));
    const api = createNotesApi(http);

    expect(await api.listForTopic('t1')).toEqual(page);
    expect(http).toHaveBeenLastCalledWith('GET', '/topics/t1/notes', undefined);

    await api.listForTopic('t1', 'a b/c');
    expect(http).toHaveBeenLastCalledWith('GET', '/topics/t1/notes?cursor=a%20b%2Fc', undefined);
  });

  it('listMine GETs /me/notes with the cursor', async () => {
    const page = { data: [{ ...NOTE, topicTitle: 'T', topicAccessible: true }], nextCursor: null };
    const http = vi.fn().mockImplementation(async () => json(200, page));
    const api = createNotesApi(http);

    expect(await api.listMine()).toEqual(page);
    expect(http).toHaveBeenLastCalledWith('GET', '/me/notes', undefined);
    await api.listMine('x=1');
    expect(http).toHaveBeenLastCalledWith('GET', '/me/notes?cursor=x%3D1', undefined);
  });

  it('list calls map 400 to InvalidCursor and 404 to NotFound', async () => {
    const bad = createNotesApi(vi.fn().mockResolvedValue(json(400, { error: 'InvalidCursor' })));
    await expect(bad.listMine('junk')).rejects.toMatchObject({ code: 'InvalidCursor', status: 400 });
    await expect(bad.listForTopic('t1', 'junk')).rejects.toMatchObject({ code: 'InvalidCursor' });

    const missing = createNotesApi(vi.fn().mockResolvedValue(json(404, { error: 'NotFound' })));
    await expect(missing.listForTopic('t1')).rejects.toMatchObject({ code: 'NotFound' });
  });

  it('listForUser GETs the staff route with the cursor', async () => {
    const page = { data: [], nextCursor: null };
    const http = vi.fn().mockImplementation(async () => json(200, page));
    const api = createNotesApi(http);

    expect(await api.listForUser('u1')).toEqual(page);
    expect(http).toHaveBeenLastCalledWith('GET', '/admin/users/u1/notes', undefined);
    await api.listForUser('u1', 'c/1');
    expect(http).toHaveBeenLastCalledWith('GET', '/admin/users/u1/notes?cursor=c%2F1', undefined);
  });

  it('unshare POSTs and returns the stored note', async () => {
    const staff = { ...NOTE, moderated: true, moderatedAt: '2026-09-28 13:00:00', moderatedBy: 's' };
    const http = vi.fn().mockResolvedValue(json(200, staff));
    const api = createNotesApi(http);

    expect(await api.unshare('n1')).toEqual(staff);
    expect(http).toHaveBeenCalledWith('POST', '/admin/notes/n1/unshare', undefined);
  });

  it('clearModeration DELETEs and resolves on 204', async () => {
    const http = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = createNotesApi(http);

    await expect(api.clearModeration('n1')).resolves.toBeUndefined();
    expect(http).toHaveBeenCalledWith('DELETE', '/admin/notes/n1/moderation', undefined);
  });

  it('staff calls map 403 to Forbidden and 404 to NotFound', async () => {
    const forbidden = createNotesApi(vi.fn().mockResolvedValue(json(403, { error: 'Forbidden' })));
    await expect(forbidden.unshare('n1')).rejects.toMatchObject({ code: 'Forbidden', status: 403 });
    await expect(forbidden.listForUser('u1')).rejects.toBeInstanceOf(NotesApiError);

    const missing = createNotesApi(vi.fn().mockResolvedValue(json(404, { error: 'NotFound' })));
    await expect(missing.clearModeration('n1')).rejects.toMatchObject({ code: 'NotFound' });
  });
});
