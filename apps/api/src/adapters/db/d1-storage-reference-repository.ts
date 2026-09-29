import type {
  IStorageReferenceRepository,
  StorageReference,
  ExistingOwnersQuery,
  ExistingOwners,
  ListReferencedKeysOptions,
  ReferencedKeysPage,
} from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';
import { STORAGE_KEY_OWNERS, type StorageKeyOwner } from '@arenaquest/shared/domain/storage';

/**
 * D1 caps bound parameters at 100 per statement; 90 leaves headroom for the
 * statement's own fixed bindings.
 */
export const STORAGE_REFERENCE_CHUNK = 90;

type MediaRefRow = {
  ref_key: string;
  id: string;
  status: string;
  original_name: string;
  type: string;
  size_bytes: number;
  uploaded_by: string;
  topic_node_id: string;
  created_at: string;
  topic_id: string | null;
  topic_title: string | null;
  topic_status: string | null;
  user_id: string | null;
  user_name: string | null;
};

type EventRefRow = {
  ref_key: string;
  id: string;
  title: string;
  slug: string;
  flyer_status: string;
  flyer_name: string | null;
};

type RefRow = MediaRefRow | EventRefRow;

/**
 * How one registered owner column is read. Every entry of
 * `STORAGE_KEY_OWNERS` must have one — the constructor refuses otherwise, so a
 * new owner cannot be registered without being resolved.
 */
interface OwnerReader {
  /** SELECT … WHERE <column> IN (<placeholders>) — every row, any status. */
  resolveSql(placeholders: string): string;
  /** Paged walk over live references: binds (afterId, limit), ordered by id. */
  walkSql: string;
  toReference(row: RefRow): StorageReference;
}

/** D1 emits `YYYY-MM-DD HH:MM:SS` in UTC with no zone designator. */
function parseUtc(value: string): Date {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value);
  return new Date(`${value.replace(' ', 'T')}Z`);
}

const MEDIA_SELECT = `
  SELECT m.storage_key AS ref_key, m.id, m.status, m.original_name, m.type, m.size_bytes,
         m.uploaded_by, m.topic_node_id, m.created_at,
         t.id AS topic_id, t.title AS topic_title, t.status AS topic_status,
         u.id AS user_id, u.name AS user_name
    FROM media m
    LEFT JOIN topic_nodes t ON t.id = m.topic_node_id
    LEFT JOIN users u ON u.id = m.uploaded_by`;

function mediaReference(raw: RefRow): StorageReference {
  const row = raw as MediaRefRow;
  return {
    kind: 'media',
    key: row.ref_key,
    mediaId: row.id,
    status: row.status as Entities.Config.MediaStatus,
    originalName: row.original_name,
    type: row.type,
    sizeBytes: row.size_bytes,
    uploaderId: row.uploaded_by,
    uploader: row.user_id !== null ? { id: row.user_id, name: row.user_name ?? '' } : null,
    topicId: row.topic_node_id,
    topic: row.topic_id !== null
      ? {
          id: row.topic_id,
          title: row.topic_title ?? '',
          status: row.topic_status as Entities.Config.TopicNodeStatus,
        }
      : null,
    createdAt: parseUtc(row.created_at),
  };
}

function eventReader(column: string, kind: 'event-flyer' | 'event-flyer-displaced'): OwnerReader {
  const select = `SELECT ${column} AS ref_key, id, title, slug, flyer_status, flyer_name FROM events`;
  return {
    resolveSql: (placeholders) => `${select} WHERE ${column} IN (${placeholders}) ORDER BY id`,
    walkSql: `${select} WHERE ${column} IS NOT NULL AND id > ? ORDER BY id LIMIT ?`,
    toReference: (raw) => {
      const row = raw as EventRefRow;
      return {
        kind,
        key: row.ref_key,
        eventId: row.id,
        title: row.title,
        slug: row.slug,
        flyerStatus: row.flyer_status as Entities.Events.EventFlyerStatus,
        flyerName: row.flyer_name,
      };
    },
  };
}

const OWNER_READERS: Record<string, OwnerReader> = {
  'media.storage_key': {
    resolveSql: (placeholders) =>
      `${MEDIA_SELECT} WHERE m.storage_key IN (${placeholders}) ORDER BY m.created_at, m.id`,
    walkSql: `${MEDIA_SELECT} WHERE m.status IN ('ready', 'pending') AND m.id > ? ORDER BY m.id LIMIT ?`,
    toReference: mediaReference,
  },
  'events.flyer_key': eventReader('flyer_key', 'event-flyer'),
  'events.flyer_replaced_key': eventReader('flyer_replaced_key', 'event-flyer-displaced'),
};

const ownerId = (owner: StorageKeyOwner) => `${owner.table}.${owner.column}`;

function chunk<T>(items: readonly T[], size = STORAGE_REFERENCE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

type Cursor = { o: string; a: string };

function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(raw: string): Cursor {
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as unknown;
    if (
      parsed && typeof parsed === 'object'
      && typeof (parsed as Cursor).o === 'string'
      && typeof (parsed as Cursor).a === 'string'
    ) {
      return parsed as Cursor;
    }
  } catch {
    // fall through
  }
  throw new InvalidStorageReferenceCursorError();
}

export class InvalidStorageReferenceCursorError extends Error {
  constructor() {
    super('Invalid storage reference cursor');
    this.name = 'InvalidStorageReferenceCursorError';
  }
}

/**
 * Read-only resolution of object-storage keys to their owning rows, driven by
 * `STORAGE_KEY_OWNERS`. Issues no INSERT, UPDATE or DELETE.
 */
export class D1StorageReferenceRepository implements IStorageReferenceRepository {
  private readonly owners: { id: string; reader: OwnerReader }[];

  constructor(private readonly db: D1Database) {
    this.owners = STORAGE_KEY_OWNERS.map((owner) => {
      const id = ownerId(owner);
      const reader = OWNER_READERS[id];
      if (!reader) throw new Error(`No storage reference reader for registered owner ${id}`);
      return { id, reader };
    });
  }

  async resolveKeys(keys: readonly string[]): Promise<Map<string, StorageReference[]>> {
    const result = new Map<string, StorageReference[]>();
    const unique = [...new Set(keys)];

    for (const part of chunk(unique)) {
      const marks = placeholders(part.length);
      const statements = this.owners.map(({ reader }) =>
        this.db.prepare(reader.resolveSql(marks)).bind(...part),
      );
      const results = await this.db.batch<RefRow>(statements);
      results.forEach((res, i) => {
        const { reader } = this.owners[i];
        for (const row of res.results ?? []) {
          const ref = reader.toReference(row);
          const list = result.get(ref.key);
          if (list) list.push(ref);
          else result.set(ref.key, [ref]);
        }
      });
    }

    return result;
  }

  async existingOwners(query: ExistingOwnersQuery): Promise<ExistingOwners> {
    const topics = new Map<string, string>();
    const events = new Map<string, string>();
    const topicChunks = chunk([...new Set(query.topicIds ?? [])]);
    const eventChunks = chunk([...new Set(query.eventIds ?? [])]);

    const rounds = Math.max(topicChunks.length, eventChunks.length);
    for (let i = 0; i < rounds; i++) {
      const statements: { target: Map<string, string>; stmt: D1PreparedStatement }[] = [];
      const topicPart = topicChunks[i];
      if (topicPart) {
        statements.push({
          target: topics,
          stmt: this.db
            .prepare(`SELECT id, title FROM topic_nodes WHERE id IN (${placeholders(topicPart.length)})`)
            .bind(...topicPart),
        });
      }
      const eventPart = eventChunks[i];
      if (eventPart) {
        statements.push({
          target: events,
          stmt: this.db
            .prepare(`SELECT id, title FROM events WHERE id IN (${placeholders(eventPart.length)})`)
            .bind(...eventPart),
        });
      }
      const results = await this.db.batch<{ id: string; title: string }>(statements.map((s) => s.stmt));
      results.forEach((res, j) => {
        for (const row of res.results ?? []) statements[j].target.set(row.id, row.title);
      });
    }

    return { topics, events };
  }

  async listReferencedKeys({ cursor, limit }: ListReferencedKeysOptions): Promise<ReferencedKeysPage> {
    const pageSize = Math.max(1, Math.floor(limit));
    let ownerIndex = 0;
    let after = '';

    if (cursor !== undefined) {
      const decoded = decodeCursor(cursor);
      ownerIndex = this.owners.findIndex((o) => o.id === decoded.o);
      if (ownerIndex === -1) throw new InvalidStorageReferenceCursorError();
      after = decoded.a;
    }

    const items: StorageReference[] = [];
    while (ownerIndex < this.owners.length) {
      const { id, reader } = this.owners[ownerIndex];
      const remaining = pageSize - items.length;
      // One extra row tells a full page from the end of this owner.
      const { results } = await this.db
        .prepare(reader.walkSql)
        .bind(after, remaining + 1)
        .all<RefRow>();
      const rows = results ?? [];

      if (rows.length > remaining) {
        const page = rows.slice(0, remaining);
        items.push(...page.map((row) => reader.toReference(row)));
        return { items, nextCursor: encodeCursor({ o: id, a: page[page.length - 1].id }) };
      }

      items.push(...rows.map((row) => reader.toReference(row)));
      ownerIndex++;
      after = '';

      if (items.length === pageSize) {
        return ownerIndex < this.owners.length
          ? { items, nextCursor: encodeCursor({ o: this.owners[ownerIndex].id, a: '' }) }
          : { items };
      }
    }

    return { items };
  }
}
