const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

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

async function apiFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

export const adminMediaApi = {
  async list(token: string, topicId: string): Promise<Media[]> {
    const res = await apiFetch(`/admin/topics/${topicId}/media`, token);
    if (!res.ok) throw new Error(`Failed to list media (${res.status})`);
    const body = (await res.json()) as { data: Media[] };
    return body.data;
  },

  async getPresignedUrl(token: string, topicId: string, data: PresignInput): Promise<PresignResponse> {
    const res = await apiFetch(`/admin/topics/${topicId}/media/presign`, token, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string, detail?: string };
      throw new Error(body.detail ?? body.error ?? `Failed to get presigned URL (${res.status})`);
    }
    return res.json();
  },

  async finalize(token: string, topicId: string, mediaId: string): Promise<Media> {
    const res = await apiFetch(`/admin/topics/${topicId}/media/${mediaId}/finalize`, token, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string, detail?: string };
      throw new Error(body.detail ?? body.error ?? `Failed to finalize media (${res.status})`);
    }
    return res.json();
  },

  async delete(token: string, topicId: string, mediaId: string): Promise<void> {
    const res = await apiFetch(`/admin/topics/${topicId}/media/${mediaId}`, token, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to delete media (${res.status})`);
    }
  },
};
