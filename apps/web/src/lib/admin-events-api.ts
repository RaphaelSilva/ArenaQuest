import type { Entities } from '@arenaquest/shared/types/entities';
import type { HttpTransport } from './api-client';

/**
 * The authenticated admin client for `/v1/admin/events` (Milestone 20, Task 06).
 *
 * It mirrors `apps/api/src/routes/admin/events.ts` exactly, which means two
 * absences are deliberate and load-bearing:
 *
 * - **There is no `delete`.** No `DELETE /{id}` exists; removal is
 *   `update(id, { status: 'archived' })`, which is reversible. Adding one here
 *   would only produce a control that 404s.
 * - **There is no `get(id)`.** The router exposes the list and nothing else, so
 *   {@link createAdminEventsApi.findById} pages through the list. Adding a
 *   single-event read is a backend change, not a client one.
 *
 * `update` never sends `slug` unless a caller names one: the API re-derives
 * nothing on rename, and neither does this layer.
 */

/** Status literals, derived from the shared enum rather than re-declared. */
export type AdminEventStatus = `${Entities.Config.EventStatus}`;
/** Audience literals, derived from the shared enum rather than re-declared. */
export type AdminEventAudience = `${Entities.Config.EventAudience}`;

export type AdminEventFlyer = {
  status: Entities.Events.EventFlyerStatus;
  key: string | null;
  type: string | null;
  sizeBytes: number | null;
  name: string | null;
};

export type AdminEventAudienceGrants = {
  groupIds: string[];
  userIds: string[];
};

export type AdminEvent = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  location: string;
  /** ISO-8601 UTC instant. */
  startsAt: string;
  /** ISO-8601 UTC instant, or `null` for an open-ended event. */
  endsAt: string | null;
  timezone: string;
  status: AdminEventStatus;
  audience: AdminEventAudience;
  flyer: AdminEventFlyer;
  whatsappNumber: string;
  whatsappMessage: string | null;
  contactLabel: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Present only for a `restricted` event. */
  audienceGrants?: AdminEventAudienceGrants;
};

export type AdminEventList = {
  data: AdminEvent[];
  total: number;
  limit: number;
  offset: number;
};

/** The create payload. It carries **no status** — every event is born a draft. */
export type CreateEventInput = {
  title: string;
  slug?: string;
  summary?: string;
  content?: string;
  location?: string;
  startsAt: string;
  endsAt?: string | null;
  timezone?: string;
  audience?: AdminEventAudience;
  whatsappNumber?: string;
  whatsappMessage?: string | null;
  contactLabel?: string;
};

/** The patch payload. `status` is the only field create does not accept. */
export type UpdateEventInput = Partial<CreateEventInput> & {
  status?: AdminEventStatus;
};

export type FlyerPresignInput = {
  fileName: string;
  contentType: string;
  /** Exactly `file.size` — the API signs it into the upload URL. */
  sizeBytes: number;
};

export type FlyerPresignResult = {
  uploadUrl: string;
  expiresInSeconds: number;
  /** The ceiling the declared size was checked against, in bytes. */
  maxBytes: number;
  flyer: AdminEventFlyer;
};

export type ListEventsQuery = {
  status?: AdminEventStatus;
  limit?: number;
  offset?: number;
};

/**
 * A rejection carrying the API's own error code.
 *
 * The events surface has to tell `FileTooLarge` from `UnsupportedMediaType`
 * from `SlugConflict` from the publish `403`, and each has its own sentence in
 * the dictionary. A flattened `Error(message)` would force the UI to match on
 * English prose.
 */
export class AdminEventsApiError extends Error {
  constructor(
    readonly status: number,
    /** The API's `error` discriminator, e.g. `FileTooLarge`. */
    readonly code: string,
    /** The API's human-readable `detail`, when it sent one. */
    readonly detail?: string,
    /** Present on `FileTooLarge` — the ceiling in bytes. */
    readonly maxBytes?: number,
  ) {
    super(detail ?? code);
    this.name = 'AdminEventsApiError';
  }
}

type ApiErrorBody = {
  error?: string;
  detail?: string;
  maxBytes?: number;
};

async function raise(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  throw new AdminEventsApiError(
    res.status,
    body.error ?? 'RequestFailed',
    body.detail,
    body.maxBytes,
  );
}

/** One page of the admin list; also the paging step of {@link findById}. */
const PAGE_SIZE = 100;

export function createAdminEventsApi(http: HttpTransport) {
  const api = {
    async list(query: ListEventsQuery = {}): Promise<AdminEventList> {
      const params = new URLSearchParams();
      if (query.status) params.set('status', query.status);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const res = await http('GET', `/admin/events${suffix}`);
      if (!res.ok) return raise(res);
      return (await res.json()) as AdminEventList;
    },

    /**
     * One event by id, or `null`.
     *
     * The router has no `GET /{id}`, so this walks the list a page at a time.
     * It is the edit form's loader; a board with thousands of events would want
     * the endpoint instead, which is Task 04's to add.
     */
    async findById(id: string): Promise<AdminEvent | null> {
      let offset = 0;
      for (;;) {
        const page = await api.list({ limit: PAGE_SIZE, offset });
        const found = page.data.find((event) => event.id === id);
        if (found) return found;
        offset += page.data.length;
        if (page.data.length === 0 || offset >= page.total) return null;
      }
    },

    async create(input: CreateEventInput): Promise<AdminEvent> {
      const res = await http('POST', '/admin/events', { body: JSON.stringify(input) });
      if (!res.ok) return raise(res);
      return (await res.json()) as AdminEvent;
    },

    async update(id: string, input: UpdateEventInput): Promise<AdminEvent> {
      const res = await http('PATCH', `/admin/events/${id}`, { body: JSON.stringify(input) });
      if (!res.ok) return raise(res);
      return (await res.json()) as AdminEvent;
    },

    /** Whole-set replacement: anything absent from the payload loses its grant. */
    async replaceAudience(
      id: string,
      grants: AdminEventAudienceGrants,
    ): Promise<AdminEventAudienceGrants> {
      const res = await http('PUT', `/admin/events/${id}/audience`, {
        body: JSON.stringify(grants),
      });
      if (!res.ok) return raise(res);
      return (await res.json()) as AdminEventAudienceGrants;
    },

    async presignFlyer(id: string, input: FlyerPresignInput): Promise<FlyerPresignResult> {
      const res = await http('POST', `/admin/events/${id}/flyer/presign`, {
        body: JSON.stringify(input),
      });
      if (!res.ok) return raise(res);
      return (await res.json()) as FlyerPresignResult;
    },

    async finalizeFlyer(id: string): Promise<AdminEvent> {
      const res = await http('POST', `/admin/events/${id}/flyer/finalize`);
      if (!res.ok) return raise(res);
      return (await res.json()) as AdminEvent;
    },

    async deleteFlyer(id: string): Promise<void> {
      const res = await http('DELETE', `/admin/events/${id}/flyer`);
      if (!res.ok && res.status !== 204) return raise(res);
    },
  };

  return api;
}
