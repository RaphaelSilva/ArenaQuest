import type { HttpTransport } from './api-client';

export type MediaStatus = 'pending' | 'ready' | 'deleted';

export type Media = {
  id: string;
  topicNodeId: string;
  url: string;
  type: string;
  storageKey: string;
  sizeBytes: number;
  originalName: string;
  uploadedById: string;
  status: MediaStatus;
  createdAt: string;
  updatedAt: string;
};

export type PresignInput = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type PresignResponse = {
  uploadUrl: string;
  media: Media;
};

/**
 * A non-OK answer from the media move endpoint, carrying the HTTP status and
 * the server's `error` code (`SameTopic`, `NotFound`, `MediaNotReady`, ...) and
 * its optional `detail`, so a caller can pick its message per answer.
 */
export class AdminMediaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;

  constructor(status: number, code: string, detail?: string) {
    super(detail ?? code);
    this.name = 'AdminMediaApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function createAdminMediaApi(http: HttpTransport) {
  return {
    async list(topicId: string): Promise<Media[]> {
      const res = await http('GET', `/admin/topics/${topicId}/media`);
      if (!res.ok) throw new Error(`Failed to list media (${res.status})`);
      const body = (await res.json()) as { data: Media[] };
      return body.data;
    },

    async getPresignedUrl(topicId: string, data: PresignInput): Promise<PresignResponse> {
      const res = await http('POST', `/admin/topics/${topicId}/media/presign`, {
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(body.detail ?? body.error ?? `Failed to get presigned URL (${res.status})`);
      }
      return res.json();
    },

    async finalize(topicId: string, mediaId: string): Promise<Media> {
      const res = await http('POST', `/admin/topics/${topicId}/media/${mediaId}/finalize`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(body.detail ?? body.error ?? `Failed to finalize media (${res.status})`);
      }
      return res.json();
    },

    /** Reassigns a ready media item to `targetTopicId`; rejects with `AdminMediaApiError`. */
    async move(topicId: string, mediaId: string, targetTopicId: string): Promise<Media> {
      const res = await http('POST', `/admin/topics/${topicId}/media/${mediaId}/move`, {
        body: JSON.stringify({ targetTopicId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown; detail?: unknown };
        throw new AdminMediaApiError(
          res.status,
          typeof body.error === 'string' ? body.error : `HTTP_${res.status}`,
          typeof body.detail === 'string' ? body.detail : undefined,
        );
      }
      return (await res.json()) as Media;
    },

    async delete(topicId: string, mediaId: string): Promise<void> {
      const res = await http('DELETE', `/admin/topics/${topicId}/media/${mediaId}`);
      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to delete media (${res.status})`);
      }
    },
  };
}

const _err = () => { throw new Error('adminMediaApi is deprecated. Use useApiClient() hook instead.'); };
export const adminMediaApi = { list: _err, getPresignedUrl: _err, finalize: _err, move: _err, delete: _err };
