import type { components } from './api-types.gen';
import type { HttpTransport } from './api-client';

// ---------------------------------------------------------------------------
// Wire types for `/v1/admin/storage/*` (RFC 0018, M25 Task 03), taken from the
// generated OpenAPI contract so a backend rename surfaces at compile time.
//
// The classification (`status`, `stale`, `hint`) is resolved on the server.
// Nothing in the web app re-derives it: the browser only renders it.
// ---------------------------------------------------------------------------

type Schemas = components['schemas'];

export type ClassifiedObject = Schemas['ClassifiedObject'];
export type StorageStatus = ClassifiedObject['status'];
export type OrphanHint = NonNullable<ClassifiedObject['hint']>;
export type StorageReference = Schemas['StorageReference'];
export type MediaStorageReference = Schemas['MediaStorageReference'];
export type EventFlyerStorageReference = Schemas['EventFlyerStorageReference'];
export type StorageFolder = Schemas['StorageFolder'];
export type StorageBrowseResponse = Schemas['StorageBrowseResponse'];
export type StorageObjectDetail = Schemas['StorageObjectDetail'];

export type BrowseQuery = {
  /** `''` for the bucket root, otherwise a prefix ending with `/`. */
  prefix: string;
  cursor?: string;
  limit?: number;
};

export class AdminStorageApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'AdminStorageApiError';
  }
}

async function rejectWith(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  throw new AdminStorageApiError(
    typeof body.error === 'string' ? body.error : fallback,
    res.status,
    body,
  );
}

const BASE = '/admin/storage';

export function createAdminStorageApi(http: HttpTransport) {
  async function get<T>(path: string, fallback: string): Promise<T> {
    const res = await http('GET', path);
    if (!res.ok) await rejectWith(res, fallback);
    return (await res.json()) as T;
  }

  return {
    /**
     * One folder page. `prefix` is always sent — an empty value is the bucket
     * root, which is a request of its own rather than an omitted parameter.
     */
    browse({ prefix, cursor, limit }: BrowseQuery): Promise<StorageBrowseResponse> {
      const search = new URLSearchParams();
      search.set('prefix', prefix);
      if (cursor) search.set('cursor', cursor);
      if (limit !== undefined) search.set('limit', String(limit));
      return get<StorageBrowseResponse>(`${BASE}/browse?${search.toString()}`, 'STORAGE_BROWSE_FAILED');
    },

    /** Head, references, classification and a 5-minute presigned download URL. */
    getObject(key: string): Promise<StorageObjectDetail> {
      const search = new URLSearchParams({ key });
      return get<StorageObjectDetail>(`${BASE}/object?${search.toString()}`, 'STORAGE_OBJECT_FAILED');
    },
  };
}
