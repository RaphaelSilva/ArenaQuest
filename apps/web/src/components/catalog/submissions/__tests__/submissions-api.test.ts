import { describe, expect, it, vi } from 'vitest';
import { createSubmissionsApi, SubmissionsApiError } from '@web/lib/submissions-api';
import { dictEn } from '@web/i18n/dict-en';
import { dictPt } from '@web/i18n/dict-pt';
import { submissionErrorMessage } from '../submission-errors';
import { formatBytes, resolveSubmissionType, titleFromFileName } from '../submission-format';

function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function caught(promise: Promise<unknown>): Promise<SubmissionsApiError> {
  try {
    await promise;
  } catch (err) {
    return err as SubmissionsApiError;
  }
  throw new Error('expected a rejection');
}

describe('submissions-api', () => {
  it('lists the caller’s own submissions with scope=mine and the cursor', async () => {
    const http = vi.fn().mockResolvedValue(json(200, { data: [], nextCursor: null }));
    const api = createSubmissionsApi(http);
    await api.listMine('t1', 'abc');
    expect(http).toHaveBeenCalledWith('GET', '/topics/t1/submissions?scope=mine&cursor=abc', undefined);
  });

  it('lists the class’s shared submissions with scope=class and reads one by id', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(json(200, { data: [], nextCursor: null }))
      .mockResolvedValueOnce(json(200, { id: 's 1' }))
      .mockResolvedValueOnce(json(404, { error: 'NotFound' }));
    const api = createSubmissionsApi(http);
    await api.listClass('t1', 'c2');
    expect(http).toHaveBeenCalledWith('GET', '/topics/t1/submissions?scope=class&cursor=c2', undefined);
    await api.getOne('t1', 's 1');
    expect(http).toHaveBeenLastCalledWith('GET', '/topics/t1/submissions/s%201', undefined);
    expect((await caught(api.getOne('t1', 'x'))).code).toBe('NotFound');
  });

  it('maps 409 SUBMISSION_QUOTA with its spread meta', async () => {
    const http = vi.fn().mockResolvedValue(json(409, { error: 'SUBMISSION_QUOTA', reason: 'storage', used: 5, limit: 1024 }));
    const err = await caught(createSubmissionsApi(http).presign('t1', {
      fileName: 'a.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1,
      title: 'a',
    }));
    expect(err.code).toBe('Quota');
    expect(err.meta).toMatchObject({ reason: 'storage', used: 5, limit: 1024 });
  });

  it('maps 422 FileTooLarge, 429 with Retry-After and the sharing/moderation conflicts', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(json(422, { error: 'FileTooLarge', maxBytes: 2048 }))
      .mockResolvedValueOnce(json(429, { error: 'TooManyRequests' }, { 'Retry-After': '120' }))
      .mockResolvedValueOnce(json(409, { error: 'SUBMISSION_SHARING_DISABLED' }))
      .mockResolvedValueOnce(json(409, { error: 'SUBMISSION_MODERATED' }));
    const api = createSubmissionsApi(http);
    const input = { fileName: 'a.mp4', contentType: 'video/mp4' as const, sizeBytes: 1, title: 'a' };

    const tooLarge = await caught(api.presign('t1', input));
    expect(tooLarge.code).toBe('FileTooLarge');
    expect(tooLarge.meta.maxBytes).toBe(2048);

    const limited = await caught(api.presign('t1', input));
    expect(limited.code).toBe('RateLimited');
    expect(limited.meta.retryAfterSeconds).toBe(120);
    expect(submissionErrorMessage(dictPt, limited)).toBe(dictPt.submissions.errors.rateLimited(2));

    expect((await caught(api.edit('t1', 's1', { visibility: 'shared' }))).code).toBe('SharingDisabled');
    expect((await caught(api.edit('t1', 's1', { visibility: 'shared' }))).code).toBe('Moderated');
  });

  it('treats 204 as a successful delete', async () => {
    const http = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(createSubmissionsApi(http).remove('t1', 's1')).resolves.toBeUndefined();
    expect(http).toHaveBeenCalledWith('DELETE', '/topics/t1/submissions/s1', undefined);
  });
});

describe('submission-format', () => {
  it('formats binary sizes per language', () => {
    expect(formatBytes(dictPt, 420 * 1024 * 1024)).toBe('420 MB');
    expect(formatBytes(dictPt, 1024 * 1024 * 1024)).toBe('1 GB');
    expect(formatBytes(dictPt, 1.5 * 1024 * 1024)).toBe('1,5 MB');
    expect(formatBytes(dictEn, 1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(dictEn, 512)).toBe('512 B');
  });

  it('resolves a typeless .mov by extension and refuses unknown types', () => {
    expect(resolveSubmissionType({ name: 'IMG_1.MOV', type: '' })).toBe('video/quicktime');
    expect(resolveSubmissionType({ name: 'a.pdf', type: 'application/pdf' })).toBe('application/pdf');
    expect(resolveSubmissionType({ name: 'a.txt', type: 'text/plain' })).toBeNull();
  });

  it('suggests the file name without its extension as the title', () => {
    expect(titleFromFileName('Kata 2.mp4', 120)).toBe('Kata 2');
    expect(titleFromFileName('noext', 3)).toBe('noe');
  });
});

describe('uploadToPresignedUrl', () => {
  class FakeXhr {
    static last: FakeXhr;
    status = 0;
    headers: Record<string, string> = {};
    method = '';
    url = '';
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    sent: unknown;
    constructor() {
      FakeXhr.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: unknown) {
      this.sent = body;
    }
    abort() {
      this.onabort?.();
    }
  }

  it('PUTs with the declared type, reports progress, and rejects with Aborted on abort', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const { uploadToPresignedUrl } = await import('@web/lib/submissions-api');
    const progress = vi.fn();

    const ok = uploadToPresignedUrl('https://r2/put', new Blob(['x']), 'video/quicktime', { onProgress: progress });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('PUT');
    expect(xhr.headers['Content-Type']).toBe('video/quicktime');
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    expect(progress).toHaveBeenCalledWith(0.25);
    xhr.status = 200;
    xhr.onload?.();
    await expect(ok).resolves.toBeUndefined();

    const controller = new AbortController();
    const aborted = uploadToPresignedUrl('https://r2/put', new Blob(['x']), 'video/mp4', { signal: controller.signal });
    controller.abort();
    expect((await caught(aborted)).code).toBe('Aborted');
    vi.unstubAllGlobals();
  });
});
