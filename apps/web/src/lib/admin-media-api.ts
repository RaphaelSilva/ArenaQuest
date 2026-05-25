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

    async delete(topicId: string, mediaId: string): Promise<void> {
      const res = await http('DELETE', `/admin/topics/${topicId}/media/${mediaId}`);
      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to delete media (${res.status})`);
      }
    },
  };
}

const _err = () => { throw new Error('adminMediaApi is deprecated. Use useApiClient() hook instead.'); };
export const adminMediaApi = { list: _err, getPresignedUrl: _err, finalize: _err, delete: _err };
