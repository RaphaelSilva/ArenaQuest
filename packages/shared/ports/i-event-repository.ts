import type { Entities } from '../types/entities';

/**
 * Events board persistence contract (RFC 0014).
 *
 * This file **describes**; it names no store, no SQL and no provider type. The
 * D1 implementation lives in `apps/api/src/adapters/db/` and is the only place
 * the audience resolution is written out.
 *
 * Two rules the implementation owes this contract:
 *
 * - **Audience is resolved server-side.** The reader-facing methods below take
 *   the caller's identity and return only what that caller may see. A caller
 *   with no identity (`viewerUserId: null`) is anonymous and sees `public`
 *   published events only.
 * - **A miss is a miss, not a refusal.** `findVisibleBySlug` returns `null` for
 *   an event the caller may not see, exactly as for one that does not exist, so
 *   the route answers `404` and the public surface is not an enumeration oracle.
 */

/**
 * Which side of "now" a listing asks for.
 *
 * Past is a computed predicate, not a column: an event is past when
 * `COALESCE(endsAt, startsAt + 1 day) < now`. Nothing is written when an event
 * expires — the same row moves between the two lists as the clock passes it.
 */
export type EventScope = 'upcoming' | 'past';

export interface ListVisibleEventsOptions {
  /** The authenticated reader, or `null` for an anonymous one. */
  viewerUserId: string | null;
  /** Defaults to `upcoming`. */
  scope?: EventScope;
  /** The request instant the scope predicate is evaluated against. */
  now: Date;
  limit?: number;
  offset?: number;
}

export interface ListAdminEventsOptions {
  /** Restrict to one status; omit to include drafts, published and archived alike. */
  status?: Entities.Config.EventStatus;
  limit?: number;
  offset?: number;
}

export interface CreateEventInput {
  /** If omitted, the repository generates a UUID. */
  id?: string;
  /** Must be unique; the caller derives it from the title. */
  slug: string;
  title: string;
  summary?: string;
  /** Markdown, already sanitised by the caller. */
  content?: string;
  location?: string;
  startsAt: Date;
  endsAt?: Date | null;
  timezone?: string;
  /** Defaults to `draft`: nothing reaches a reader before a human publishes it. */
  status?: Entities.Config.EventStatus;
  /** Defaults to `members`: a wrong default must lose readers, never leak an event. */
  audience?: Entities.Config.EventAudience;
  /** Normalised digits, or '' for "this event has no own number". */
  whatsappNumber?: string;
  whatsappMessage?: string | null;
  contactLabel?: string;
  /** Id of the creating user. */
  createdBy: string;
}

/** Every field an admin may edit. An omitted key leaves its column untouched. */
export type UpdateEventInput = Partial<Omit<CreateEventInput, 'id' | 'createdBy'>>;

/** The flyer columns written when a presign is issued. */
export interface SetEventFlyerPendingInput {
  key: string;
  type: string;
  sizeBytes: number;
  name: string;
}

export interface IEventRepository {
  // -- reader surface (audience-scoped) --------------------------------------

  /**
   * Published events the caller may see, in the requested scope, ordered by
   * `startsAt` — ascending for `upcoming`, descending for `past`.
   *
   * Anonymous (`viewerUserId: null`) resolves to the `public` audience alone.
   * Authenticated resolves to `public` ∪ `members` ∪ the `restricted` events
   * granted to that user directly or through one of their groups.
   */
  listVisible(opts: ListVisibleEventsOptions): Promise<Entities.Events.Event[]>;

  /** Total matching `listVisible` under the same audience rule, for pagination. */
  countVisible(opts: Omit<ListVisibleEventsOptions, 'limit' | 'offset'>): Promise<number>;

  /**
   * One published event by slug, under the same audience rule as
   * {@link listVisible}. `null` when it does not exist **or** the caller may not
   * see it — the two cases are deliberately indistinguishable.
   */
  findVisibleBySlug(
    slug: string,
    opts: { viewerUserId: string | null },
  ): Promise<Entities.Events.Event | null>;

  // -- admin surface (bypasses the audience rule) ----------------------------

  /** Every event regardless of status or audience, newest start first. */
  listAll(opts?: ListAdminEventsOptions): Promise<Entities.Events.Event[]>;

  /** Total matching {@link listAll}, for pagination. */
  countAll(opts?: Omit<ListAdminEventsOptions, 'limit' | 'offset'>): Promise<number>;

  /** By id, ignoring status and audience. Admin reads only. */
  findById(id: string): Promise<Entities.Events.Event | null>;

  /** By slug, ignoring status and audience — used to detect a slug collision. */
  findBySlug(slug: string): Promise<Entities.Events.Event | null>;

  // -- writes ----------------------------------------------------------------

  create(data: CreateEventInput): Promise<Entities.Events.Event>;
  update(id: string, data: UpdateEventInput): Promise<Entities.Events.Event>;
  delete(id: string): Promise<void>;

  // -- audience grants -------------------------------------------------------

  /** The groups and users a `restricted` event is addressed to. */
  getAudienceGrants(eventId: string): Promise<Entities.Events.EventAudienceGrants>;

  /**
   * Replace the whole grant set for an event.
   *
   * Whole-set, never additive: the caller sends the complete membership it
   * wants, and anything absent is revoked. A partial write would make removing
   * a group impossible through this port.
   */
  replaceAudienceGrants(
    eventId: string,
    grants: Entities.Events.EventAudienceGrants,
  ): Promise<void>;

  // -- flyer columns ---------------------------------------------------------

  /** Records a presigned upload: flyer status becomes `pending`. */
  setFlyerPending(eventId: string, flyer: SetEventFlyerPendingInput): Promise<void>;

  /**
   * Confirms an uploaded flyer: status becomes `ready`.
   *
   * Returns the storage key of the flyer this one replaced, or `null` when
   * there was none, so the caller can delete the orphaned object.
   */
  setFlyerReady(eventId: string, opts?: { sizeBytes?: number }): Promise<string | null>;

  /**
   * Clears the flyer columns back to `none`, returning the storage key that was
   * held, or `null`. Used both to remove a flyer and to roll back a `pending`
   * upload that failed its size check.
   */
  clearFlyer(eventId: string): Promise<string | null>;
}
