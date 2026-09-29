import type { HttpTransport } from './api-client';

/** A tag as returned by `GET /v1/admin/tags`. */
export type AdminTag = {
  id: string;
  name: string;
  slug: string;
};

export type ListAdminTagsParams = {
  /** Free text; slugified server-side and matched as a slug prefix. */
  q?: string;
  /** Maximum number of tags to return (1–100). */
  limit?: number;
};

export function createAdminTagsApi(http: HttpTransport) {
  return {
    async list(params: ListAdminTagsParams = {}): Promise<AdminTag[]> {
      const search = new URLSearchParams();
      if (params.q !== undefined && params.q !== '') search.set('q', params.q);
      if (params.limit !== undefined) search.set('limit', String(params.limit));
      const qs = search.toString();
      const res = await http('GET', qs ? `/admin/tags?${qs}` : '/admin/tags');
      if (!res.ok) throw new Error(`Failed to list tags (${res.status})`);
      const body = (await res.json()) as { data: AdminTag[] };
      return body.data;
    },
  };
}
