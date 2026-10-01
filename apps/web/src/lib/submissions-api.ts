import type { HttpTransport } from './api-client';
import type { components } from './api-types.gen';

/** A student submission as the write routes return it (presign, finalize, edit). */
export type Submission = components['schemas']['Submission'];

/** A submission in a topic listing, with the caller flag and a signed GET `url` (ready only). */
export type SubmissionView = components['schemas']['SubmissionView'];

/** Effective limits, sharing switch, the caller's usage and the class count of a topic. */
export type SubmissionSummary = components['schemas']['SubmissionSummary'];

export type SubmissionVisibility = Submission['visibility'];

export type SubmissionContentType = Submission['contentType'];

/** A cursor-paginated page; `nextCursor` is `null` on the last page. */
export type SubmissionPage<T> = { data: T[]; nextCursor: string | null };

export type PresignSubmissionInput = components['schemas']['PresignSubmissionBody'];

export type PresignSubmissionResult = components['schemas']['PresignSubmissionResponse'];

export type EditSubmissionInput = components['schemas']['EditSubmissionBody'];

export type SubmissionsApiErrorCode =
  | 'Unauthorized'
  | 'Forbidden'
  | 'NotFound'
  | 'NetworkError'
  | 'InvalidCursor'
  | 'BadRequest'
  | 'UnsupportedMediaType'
  | 'TitleInvalid'
  | 'DescriptionTooLong'
  | 'Quota'
  | 'Moderated'
  | 'SharingDisabled'
  | 'Removed'
  | 'FileTooLarge'
  | 'UploadMismatch'
  | 'NotUploaded'
  | 'RateLimited'
  | 'StorageUnavailable'
  | 'Aborted'
  | 'Unknown';

/** Details some errors carry, spread at the top level of the API's error body. */
export type SubmissionsApiErrorMeta = {
  /** `SUBMISSION_QUOTA`: which limit refused the upload. */
  reason?: 'count' | 'storage';
  used?: number;
  limit?: number;
  /** `FileTooLarge`: the ceiling for the declared type. */
  maxBytes?: number;
  /** `429`: seconds until another presign is allowed. */
  retryAfterSeconds?: number;
};

export class SubmissionsApiError extends Error {
  readonly code: SubmissionsApiErrorCode;
  readonly status: number;
  readonly meta: SubmissionsApiErrorMeta;

  constructor(code: SubmissionsApiErrorCode, status: number, message: string, meta: SubmissionsApiErrorMeta = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.meta = meta;
  }
}

const ERROR_CODES: Record<string, SubmissionsApiErrorCode> = {
  SUBMISSION_QUOTA: 'Quota',
  SUBMISSION_MODERATED: 'Moderated',
  SUBMISSION_SHARING_DISABLED: 'SharingDisabled',
  SUBMISSION_REMOVED: 'Removed',
  SUBMISSION_TITLE_INVALID: 'TitleInvalid',
  SUBMISSION_DESCRIPTION_TOO_LONG: 'DescriptionTooLong',
  UnsupportedMediaType: 'UnsupportedMediaType',
  FileTooLarge: 'FileTooLarge',
  UPLOAD_MISMATCH: 'UploadMismatch',
  NotUploaded: 'NotUploaded',
  StorageUnavailable: 'StorageUnavailable',
  InvalidCursor: 'InvalidCursor',
};

async function send(http: HttpTransport, method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await http(method, path, body === undefined ? undefined : { body: JSON.stringify(body) });
  } catch {
    throw new SubmissionsApiError('NetworkError', 0, 'Network failure.');
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Maps a non-2xx response onto a typed error, keeping the meta the API spreads into the body. */
async function toError(res: Response): Promise<SubmissionsApiError> {
  if (res.status === 401) return new SubmissionsApiError('Unauthorized', 401, 'Unauthorized.');
  if (res.status === 403) return new SubmissionsApiError('Forbidden', 403, 'Forbidden.');
  if (res.status === 404) return new SubmissionsApiError('NotFound', 404, 'Not found.');

  const body = await readJson(res);
  const meta: SubmissionsApiErrorMeta = {
    reason: body.reason === 'count' || body.reason === 'storage' ? body.reason : undefined,
    used: numberOrUndefined(body.used),
    limit: numberOrUndefined(body.limit),
    maxBytes: numberOrUndefined(body.maxBytes),
    retryAfterSeconds: numberOrUndefined(body.retryAfterSeconds),
  };

  if (res.status === 429) {
    const header = Number(res.headers.get('Retry-After'));
    if (meta.retryAfterSeconds === undefined && Number.isFinite(header) && header > 0) {
      meta.retryAfterSeconds = header;
    }
    return new SubmissionsApiError('RateLimited', 429, 'Too many requests.', meta);
  }

  const mapped = typeof body.error === 'string' ? ERROR_CODES[body.error] : undefined;
  if (mapped) return new SubmissionsApiError(mapped, res.status, String(body.error), meta);
  if (res.status === 400) return new SubmissionsApiError('BadRequest', 400, 'Bad request.', meta);
  return new SubmissionsApiError('Unknown', res.status, `Failed (${res.status})`, meta);
}

export type UploadOptions = {
  /** Called with the fraction of bytes sent, 0..1. */
  onProgress?: (fraction: number) => void;
  /** Aborting rejects the upload with `Aborted`. */
  signal?: AbortSignal;
};

/**
 * PUTs a file to its presigned URL. `XMLHttpRequest` rather than `fetch`
 * because only XHR reports upload progress. The URL signs `Content-Type`, so
 * the header must be exactly the type declared at presign.
 */
export function uploadToPresignedUrl(
  url: string,
  file: Blob,
  contentType: string,
  { onProgress, signal }: UploadOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SubmissionsApiError('Aborted', 0, 'Upload aborted.'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new SubmissionsApiError('Unknown', xhr.status, `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new SubmissionsApiError('NetworkError', 0, 'Upload failed.'));
    };
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new SubmissionsApiError('Aborted', 0, 'Upload aborted.'));
    };
    signal?.addEventListener('abort', onAbort);
    xhr.send(file);
  });
}

export function createSubmissionsApi(http: HttpTransport) {
  const base = (topicId: string) => `/topics/${encodeURIComponent(topicId)}/submissions`;
  const one = (topicId: string, submissionId: string) => `${base(topicId)}/${encodeURIComponent(submissionId)}`;

  return {
    /** Limits, sharing switch, the caller's usage and the class count on a topic. */
    async summary(topicId: string): Promise<SubmissionSummary> {
      const res = await send(http, 'GET', `${base(topicId)}/summary`);
      if (!res.ok) throw await toError(res);
      return (await res.json()) as SubmissionSummary;
    },

    /** A page of the caller's own submissions on a topic, every status, newest first. */
    async listMine(topicId: string, cursor?: string | null): Promise<SubmissionPage<SubmissionView>> {
      const query = new URLSearchParams({ scope: 'mine' });
      if (cursor) query.set('cursor', cursor);
      const res = await send(http, 'GET', `${base(topicId)}?${query.toString()}`);
      if (!res.ok) throw await toError(res);
      return (await res.json()) as SubmissionPage<SubmissionView>;
    },

    /** Creates a `pending` submission and returns its presigned PUT. */
    async presign(topicId: string, input: PresignSubmissionInput): Promise<PresignSubmissionResult> {
      const res = await send(http, 'POST', `${base(topicId)}/presign`, input);
      if (!res.ok) throw await toError(res);
      return (await res.json()) as PresignSubmissionResult;
    },

    /** Verifies the stored object and marks the submission `ready`. */
    async finalize(topicId: string, submissionId: string): Promise<Submission> {
      const res = await send(http, 'POST', `${one(topicId, submissionId)}/finalize`);
      if (!res.ok) throw await toError(res);
      return (await res.json()) as Submission;
    },

    /** Last-write-wins edit of title, description and visibility. */
    async edit(topicId: string, submissionId: string, input: EditSubmissionInput): Promise<Submission> {
      const res = await send(http, 'PATCH', one(topicId, submissionId), input);
      if (!res.ok) throw await toError(res);
      return (await res.json()) as Submission;
    },

    /** Deletes a pending or ready submission, or dismisses a tombstone. */
    async remove(topicId: string, submissionId: string): Promise<void> {
      const res = await send(http, 'DELETE', one(topicId, submissionId));
      if (res.ok) return;
      throw await toError(res);
    },
  };
}
