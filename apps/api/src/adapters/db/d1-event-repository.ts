import type {
  IEventRepository,
  EventScope,
  ListVisibleEventsOptions,
  ListAdminEventsOptions,
  CreateEventInput,
  UpdateEventInput,
  SetEventFlyerPendingInput,
} from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';

/**
 * D1 implementation of {@link IEventRepository} (RFC 0014, Milestone 20).
 *
 * This file is the only place in the milestone that contains SQL or names
 * `D1Database`. Everything above it sees `IEventRepository` and nothing else.
 *
 * Two properties of this adapter carry the milestone's security posture:
 *
 * 1. The anonymous listing is **its own statement** with a literal
 *    `status = 'published' AND audience = 'public'` filter. It is deliberately
 *    not expressible as "the authenticated query with a null user", because a
 *    null reaching the wrong side of that expression is a data leak rather than
 *    an error. See {@link anonymousVisibleSql}.
 * 2. "Past" is computed per query and never stored. No column, no flag, no
 *    sweep: the same row moves between the two lists as the clock passes it,
 *    and neither read writes anything.
 */

type EventRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  location: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  status: string;
  audience: string;
  flyer_status: string;
  flyer_key: string | null;
  flyer_type: string | null;
  flyer_size_bytes: number | null;
  flyer_name: string | null;
  /** Internal bookkeeping; never mapped onto the entity. */
  flyer_replaced_key: string | null;
  whatsapp_number: string;
  whatsapp_message: string | null;
  contact_label: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Date <-> TEXT
// ---------------------------------------------------------------------------

/**
 * SQLite has no Date type, so the port speaks `Date` and the columns hold TEXT.
 * The conversion lives here and nowhere else.
 *
 * The stored form is the canonical `YYYY-MM-DD HH:MM:SS` UTC that `datetime()`
 * both emits and parses. That matters twice over: the scope predicate calls
 * `datetime(starts_at, '+1 day')`, which yields NULL for anything it cannot
 * parse, and the same shape sorts correctly as a plain string, which is what
 * `ORDER BY starts_at` relies on. Sub-second precision is dropped deliberately —
 * an events board is not a clock.
 */
function toSqlUtc(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

/** Inverse of {@link toSqlUtc}; tolerant of an already-ISO value. */
function fromSqlUtc(value: string): Date {
  const withSeparator = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(withSeparator.endsWith('Z') ? withSeparator : `${withSeparator}Z`);
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

const SLUG_MAX_LENGTH = 80;
/** Bounded so a pathological title cannot spin; a random suffix closes it out. */
const SLUG_ATTEMPTS = 25;

/**
 * Derives the URL-facing slug from a title.
 *
 * Applied **once, at creation**. A later title change never re-derives it: the
 * slug is the public identity of the event and a link already pasted into a
 * WhatsApp group has to keep working.
 */
export function deriveEventSlug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * True when the write lost the race for a slug.
 *
 * Collisions are resolved by retrying on the constraint rather than by a
 * SELECT-then-INSERT pre-check: the pre-check has a window between the two
 * statements, and `slug` is UNIQUE precisely so the database can arbitrate.
 * A collision on any other column is somebody else's bug and is rethrown.
 */
function isSlugCollision(error: unknown): boolean {
  const messages: string[] = [];
  if (error instanceof Error) {
    messages.push(error.message);
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error) messages.push(cause.message);
  }
  return messages.some(m => /UNIQUE constraint failed:\s*events\.slug/i.test(m));
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/** `upcoming` keeps what has not finished; `past` is its strict complement. */
function scopeComparison(scope: EventScope): string {
  return scope === 'past' ? '<' : '>=';
}

function scopeOrder(scope: EventScope): string {
  return scope === 'past' ? 'DESC' : 'ASC';
}

/**
 * ANONYMOUS reader. The single most important statement in this milestone.
 *
 * The audience filter is a **literal**, not a bound parameter, and this is a
 * separate statement from {@link authenticatedVisibleSql} rather than the same
 * one with a null user id. Do not merge the two: the moment `audience = 'public'`
 * becomes something a caller supplies, a mistake one layer up stops being a bug
 * and becomes a disclosure.
 *
 * Bindings: ?1 now, ?2 limit, ?3 offset.
 *
 * Exported so a spec can assert the literal is still there. That guard is the
 * point: a regression that merges the two branches would keep passing the
 * audience matrix while quietly reintroducing the parameter.
 */
export function anonymousVisibleSql(scope: EventScope): string {
  return `SELECT * FROM events
           WHERE status = 'published' AND audience = 'public'
             AND COALESCE(ends_at, datetime(starts_at, '+1 day')) ${scopeComparison(scope)} ?1
           ORDER BY starts_at ${scopeOrder(scope)}, id ASC
           LIMIT ?2 OFFSET ?3`;
}

/** Bindings: ?1 now. */
function anonymousCountSql(scope: EventScope): string {
  return `SELECT COUNT(*) AS n FROM events
           WHERE status = 'published' AND audience = 'public'
             AND COALESCE(ends_at, datetime(starts_at, '+1 day')) ${scopeComparison(scope)} ?1`;
}

/**
 * The audience union for an authenticated reader: `public` and `members` by
 * level, plus the `restricted` events granted to this user directly or through
 * one of their groups (RFC 0014 section 2).
 *
 * A grant here is permission to see an announcement. It is not an enrollment,
 * and nothing in this expression reads `enrollments_user`,
 * `enrollments_user_group` or `topic_nodes`.
 */
const AUTHENTICATED_AUDIENCE_PREDICATE = `(
        e.audience IN ('public','members')
     OR EXISTS (SELECT 1 FROM event_audience_user au
                 WHERE au.event_id = e.id AND au.user_id = ?2)
     OR EXISTS (SELECT 1 FROM event_audience_group ag
                  JOIN user_group_members ugm ON ugm.group_id = ag.group_id
                 WHERE ag.event_id = e.id AND ugm.user_id = ?2)
   )`;

/** Bindings: ?1 now, ?2 viewerUserId, ?3 limit, ?4 offset. Exported alongside
 * {@link anonymousVisibleSql} so a spec can assert the two remain distinct. */
export function authenticatedVisibleSql(scope: EventScope): string {
  return `SELECT e.* FROM events e
           WHERE e.status = 'published'
             AND COALESCE(e.ends_at, datetime(e.starts_at, '+1 day')) ${scopeComparison(scope)} ?1
             AND ${AUTHENTICATED_AUDIENCE_PREDICATE}
           ORDER BY e.starts_at ${scopeOrder(scope)}, e.id ASC
           LIMIT ?3 OFFSET ?4`;
}

/** Bindings: ?1 now, ?2 viewerUserId. */
function authenticatedCountSql(scope: EventScope): string {
  return `SELECT COUNT(*) AS n FROM events e
           WHERE e.status = 'published'
             AND COALESCE(e.ends_at, datetime(e.starts_at, '+1 day')) ${scopeComparison(scope)} ?1
             AND ${AUTHENTICATED_AUDIENCE_PREDICATE}`;
}

/**
 * Slug lookup for an anonymous reader — again a literal filter in its own
 * statement, for the same reason as {@link anonymousVisibleSql}.
 *
 * No scope predicate: a past event still has a readable detail page. Only the
 * board is split into two lists.
 */
const ANONYMOUS_BY_SLUG_SQL = `SELECT * FROM events
   WHERE slug = ?1 AND status = 'published' AND audience = 'public'`;

/** Bindings: ?1 slug, ?2 viewerUserId. */
const AUTHENTICATED_BY_SLUG_SQL = `SELECT e.* FROM events e
   WHERE e.slug = ?1 AND e.status = 'published'
     AND ${AUTHENTICATED_AUDIENCE_PREDICATE}`;

const INSERT_EVENT_SQL = `INSERT INTO events (
    id, slug, title, summary, content, location,
    starts_at, ends_at, timezone, status, audience,
    whatsapp_number, whatsapp_message, contact_label, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// ---------------------------------------------------------------------------

export class D1EventRepository implements IEventRepository {
  constructor(private readonly db: D1Database) {}

  private rowToEvent(row: EventRow): Entities.Events.Event {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      content: row.content,
      location: row.location,
      startsAt: fromSqlUtc(row.starts_at),
      endsAt: row.ends_at === null ? null : fromSqlUtc(row.ends_at),
      timezone: row.timezone,
      status: row.status as Entities.Config.EventStatus,
      audience: row.audience as Entities.Config.EventAudience,
      flyer: {
        status: row.flyer_status as Entities.Events.EventFlyerStatus,
        key: row.flyer_key,
        type: row.flyer_type,
        sizeBytes: row.flyer_size_bytes,
        name: row.flyer_name,
      },
      whatsappNumber: row.whatsapp_number,
      whatsappMessage: row.whatsapp_message,
      contactLabel: row.contact_label,
      createdBy: row.created_by,
      createdAt: fromSqlUtc(row.created_at),
      updatedAt: fromSqlUtc(row.updated_at),
    };
  }

  /**
   * Anything that is not a non-empty user id is anonymous.
   *
   * The narrow side is the safe side: an empty string routed to the
   * authenticated branch would match no grant anyway, but routing it to the
   * anonymous branch means a caller that mishandles its own identity can only
   * ever see less.
   */
  private static isAnonymous(viewerUserId: string | null | undefined): boolean {
    return typeof viewerUserId !== 'string' || viewerUserId.length === 0;
  }

  // -- reader surface (audience-scoped) --------------------------------------

  async listVisible(opts: ListVisibleEventsOptions): Promise<Entities.Events.Event[]> {
    const scope: EventScope = opts.scope ?? 'upcoming';
    const now = toSqlUtc(opts.now);
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const { results } = D1EventRepository.isAnonymous(opts.viewerUserId)
      ? await this.db
          .prepare(anonymousVisibleSql(scope))
          .bind(now, limit, offset)
          .all<EventRow>()
      : await this.db
          .prepare(authenticatedVisibleSql(scope))
          .bind(now, opts.viewerUserId, limit, offset)
          .all<EventRow>();

    return results.map(row => this.rowToEvent(row));
  }

  async countVisible(
    opts: Omit<ListVisibleEventsOptions, 'limit' | 'offset'>,
  ): Promise<number> {
    const scope: EventScope = opts.scope ?? 'upcoming';
    const now = toSqlUtc(opts.now);

    const row = D1EventRepository.isAnonymous(opts.viewerUserId)
      ? await this.db.prepare(anonymousCountSql(scope)).bind(now).first<{ n: number }>()
      : await this.db
          .prepare(authenticatedCountSql(scope))
          .bind(now, opts.viewerUserId)
          .first<{ n: number }>();

    return row?.n ?? 0;
  }

  /**
   * `null` both for an event that does not exist and for one this caller may
   * not see. The two are indistinguishable on purpose, so the route answers 404
   * either way and the public surface is not an enumeration oracle.
   */
  async findVisibleBySlug(
    slug: string,
    opts: { viewerUserId: string | null },
  ): Promise<Entities.Events.Event | null> {
    const row = D1EventRepository.isAnonymous(opts.viewerUserId)
      ? await this.db.prepare(ANONYMOUS_BY_SLUG_SQL).bind(slug).first<EventRow>()
      : await this.db
          .prepare(AUTHENTICATED_BY_SLUG_SQL)
          .bind(slug, opts.viewerUserId)
          .first<EventRow>();

    return row ? this.rowToEvent(row) : null;
  }

  // -- admin surface (bypasses the audience rule) ----------------------------

  async listAll(opts?: ListAdminEventsOptions): Promise<Entities.Events.Event[]> {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const { results } = opts?.status
      ? await this.db
          .prepare(
            'SELECT * FROM events WHERE status = ? ORDER BY starts_at DESC, id ASC LIMIT ? OFFSET ?',
          )
          .bind(opts.status, limit, offset)
          .all<EventRow>()
      : await this.db
          .prepare('SELECT * FROM events ORDER BY starts_at DESC, id ASC LIMIT ? OFFSET ?')
          .bind(limit, offset)
          .all<EventRow>();

    return results.map(row => this.rowToEvent(row));
  }

  async countAll(opts?: Omit<ListAdminEventsOptions, 'limit' | 'offset'>): Promise<number> {
    const row = opts?.status
      ? await this.db
          .prepare('SELECT COUNT(*) AS n FROM events WHERE status = ?')
          .bind(opts.status)
          .first<{ n: number }>()
      : await this.db.prepare('SELECT COUNT(*) AS n FROM events').first<{ n: number }>();

    return row?.n ?? 0;
  }

  async findById(id: string): Promise<Entities.Events.Event | null> {
    const row = await this.db
      .prepare('SELECT * FROM events WHERE id = ?')
      .bind(id)
      .first<EventRow>();

    return row ? this.rowToEvent(row) : null;
  }

  async findBySlug(slug: string): Promise<Entities.Events.Event | null> {
    const row = await this.db
      .prepare('SELECT * FROM events WHERE slug = ?')
      .bind(slug)
      .first<EventRow>();

    return row ? this.rowToEvent(row) : null;
  }

  // -- writes ----------------------------------------------------------------

  async create(data: CreateEventInput): Promise<Entities.Events.Event> {
    const id = data.id ?? crypto.randomUUID();
    // An explicit slug is honoured as given; an empty one is derived from the
    // title. Either way the base is suffixed until the database accepts it.
    const explicit = data.slug?.trim() ?? '';
    const base = explicit || deriveEventSlug(data.title) || 'event';

    for (let attempt = 0; attempt <= SLUG_ATTEMPTS; attempt++) {
      let slug: string;
      if (attempt === 0) {
        slug = base;
      } else if (attempt < SLUG_ATTEMPTS) {
        slug = `${base}-${attempt + 1}`;
      } else {
        // Last resort for a base that is contended beyond the ladder above.
        slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
      }

      try {
        await this.db
          .prepare(INSERT_EVENT_SQL)
          .bind(
            id,
            slug,
            data.title,
            data.summary ?? '',
            data.content ?? '',
            data.location ?? '',
            toSqlUtc(data.startsAt),
            data.endsAt ? toSqlUtc(data.endsAt) : null,
            data.timezone ?? 'America/Sao_Paulo',
            data.status ?? 'draft',
            data.audience ?? 'members',
            data.whatsappNumber ?? '',
            data.whatsappMessage ?? null,
            data.contactLabel ?? '',
            data.createdBy,
          )
          .run();

        const created = await this.findById(id);
        if (!created) {
          throw new Error(`D1EventRepository: failed to fetch event after create (id=${id})`);
        }
        return created;
      } catch (error) {
        if (!isSlugCollision(error)) throw error;
      }
    }

    throw new Error(`D1EventRepository: could not allocate a free slug for "${base}"`);
  }

  async update(id: string, data: UpdateEventInput): Promise<Entities.Events.Event> {
    const setClauses = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    // The slug moves only when a caller names one. A title change deliberately
    // leaves it alone — see deriveEventSlug.
    if (data.slug !== undefined) { setClauses.push('slug = ?'); values.push(data.slug); }
    if (data.title !== undefined) { setClauses.push('title = ?'); values.push(data.title); }
    if (data.summary !== undefined) { setClauses.push('summary = ?'); values.push(data.summary); }
    if (data.content !== undefined) { setClauses.push('content = ?'); values.push(data.content); }
    if (data.location !== undefined) { setClauses.push('location = ?'); values.push(data.location); }
    if (data.startsAt !== undefined) { setClauses.push('starts_at = ?'); values.push(toSqlUtc(data.startsAt)); }
    if (data.endsAt !== undefined) {
      setClauses.push('ends_at = ?');
      values.push(data.endsAt === null ? null : toSqlUtc(data.endsAt));
    }
    if (data.timezone !== undefined) { setClauses.push('timezone = ?'); values.push(data.timezone); }
    if (data.status !== undefined) { setClauses.push('status = ?'); values.push(data.status); }
    if (data.audience !== undefined) { setClauses.push('audience = ?'); values.push(data.audience); }
    if (data.whatsappNumber !== undefined) { setClauses.push('whatsapp_number = ?'); values.push(data.whatsappNumber); }
    if (data.whatsappMessage !== undefined) { setClauses.push('whatsapp_message = ?'); values.push(data.whatsappMessage); }
    if (data.contactLabel !== undefined) { setClauses.push('contact_label = ?'); values.push(data.contactLabel); }

    values.push(id);
    await this.db
      .prepare(`UPDATE events SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    const updated = await this.findById(id);
    if (!updated) throw new Error(`D1EventRepository: event not found (id=${id})`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  }

  // -- audience grants -------------------------------------------------------

  async getAudienceGrants(eventId: string): Promise<Entities.Events.EventAudienceGrants> {
    const [groups, users] = await Promise.all([
      this.db
        .prepare('SELECT group_id FROM event_audience_group WHERE event_id = ? ORDER BY group_id ASC')
        .bind(eventId)
        .all<{ group_id: string }>(),
      this.db
        .prepare('SELECT user_id FROM event_audience_user WHERE event_id = ? ORDER BY user_id ASC')
        .bind(eventId)
        .all<{ user_id: string }>(),
    ]);

    return {
      groupIds: groups.results.map(r => r.group_id),
      userIds: users.results.map(r => r.user_id),
    };
  }

  /**
   * Whole-set replacement: everything absent from `grants` is revoked.
   *
   * The delete and the inserts go through `db.batch()`, which D1 runs
   * atomically — do not downgrade this to a sequence of `.run()` calls. Between
   * a bare delete and its inserts the event would briefly be addressed to
   * nobody, and a concurrent read would observe that half-applied set.
   */
  async replaceAudienceGrants(
    eventId: string,
    grants: Entities.Events.EventAudienceGrants,
  ): Promise<void> {
    const statements = [
      this.db.prepare('DELETE FROM event_audience_group WHERE event_id = ?').bind(eventId),
      this.db.prepare('DELETE FROM event_audience_user WHERE event_id = ?').bind(eventId),
      ...grants.groupIds.map(groupId =>
        this.db
          .prepare('INSERT OR IGNORE INTO event_audience_group (event_id, group_id) VALUES (?, ?)')
          .bind(eventId, groupId),
      ),
      ...grants.userIds.map(userId =>
        this.db
          .prepare('INSERT OR IGNORE INTO event_audience_user (event_id, user_id) VALUES (?, ?)')
          .bind(eventId, userId),
      ),
    ];

    await this.db.batch(statements);
  }

  // -- flyer columns ---------------------------------------------------------

  /**
   * One statement: the CASE captures the key this upload is about to displace,
   * so `setFlyerReady` can hand it back for deletion once the bytes actually
   * landed. Deleting it here instead would destroy a live flyer every time an
   * upload is abandoned.
   */
  async setFlyerPending(eventId: string, flyer: SetEventFlyerPendingInput): Promise<void> {
    await this.db
      .prepare(
        `UPDATE events
            SET flyer_replaced_key = CASE WHEN flyer_status = 'ready'
                                          THEN flyer_key ELSE flyer_replaced_key END,
                flyer_status = 'pending',
                flyer_key = ?,
                flyer_type = ?,
                flyer_size_bytes = ?,
                flyer_name = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(flyer.key, flyer.type, flyer.sizeBytes, flyer.name, eventId)
      .run();
  }

  async setFlyerReady(eventId: string, opts?: { sizeBytes?: number }): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT flyer_key, flyer_replaced_key FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ flyer_key: string | null; flyer_replaced_key: string | null }>();

    if (!row) return null;

    const setClauses = [
      "flyer_status = 'ready'",
      'flyer_replaced_key = NULL',
      "updated_at = datetime('now')",
    ];
    const values: unknown[] = [];
    if (opts?.sizeBytes !== undefined) {
      setClauses.push('flyer_size_bytes = ?');
      values.push(opts.sizeBytes);
    }
    values.push(eventId);

    await this.db
      .prepare(`UPDATE events SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    // Re-uploading the same key replaces nothing; there is no orphan to delete.
    if (row.flyer_replaced_key === null || row.flyer_replaced_key === row.flyer_key) {
      return null;
    }
    return row.flyer_replaced_key;
  }

  async clearFlyer(eventId: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT flyer_key FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ flyer_key: string | null }>();

    if (!row) return null;

    await this.db
      .prepare(
        `UPDATE events
            SET flyer_status = 'none',
                flyer_key = NULL,
                flyer_type = NULL,
                flyer_size_bytes = NULL,
                flyer_name = NULL,
                flyer_replaced_key = NULL,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(eventId)
      .run();

    return row.flyer_key;
  }
}
