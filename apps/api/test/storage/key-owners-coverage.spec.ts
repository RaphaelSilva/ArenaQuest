import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEY_OWNERS,
  NON_STORAGE_KEY_COLUMNS,
} from '@arenaquest/shared/domain/storage';

// Every migration, bundled as raw text (same mechanism as apply-migrations.ts).
const MIGRATIONS = import.meta.glob('../../migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

interface KeyColumn {
  table: string;
  column: string;
}

const IDENT = '[`"\\[]?(\\w+)[`"\\]]?';
const CREATE_TABLE_RE = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}\\s*\\(`, 'gi');
const ADD_COLUMN_RE = new RegExp(`ALTER\\s+TABLE\\s+${IDENT}\\s+ADD\\s+(?:COLUMN\\s+)?${IDENT}`, 'gi');
const CONSTRAINT_WORDS = new Set(['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'CONSTRAINT']);
const KEY_COLUMN_RE = /^\w*_key$/i;

/** Split a CREATE TABLE body on top-level commas (ignoring those inside parens). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** Every `*_key` column declared (CREATE TABLE or ALTER TABLE ADD COLUMN) in a SQL script. */
export function extractKeyColumns(sql: string): KeyColumn[] {
  const text = sql.replace(/--[^\n]*/g, '');
  const found: KeyColumn[] = [];

  for (const match of text.matchAll(CREATE_TABLE_RE)) {
    const table = match[1];
    // Walk to the paren that closes the column list.
    let depth = 1;
    let i = (match.index ?? 0) + match[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')') depth--;
    }
    const body = text.slice(start, i - 1);
    for (const def of splitTopLevel(body)) {
      const name = /^\s*[`"[]?(\w+)/.exec(def)?.[1];
      if (!name || CONSTRAINT_WORDS.has(name.toUpperCase())) continue;
      if (KEY_COLUMN_RE.test(name)) found.push({ table, column: name });
    }
  }

  for (const match of text.matchAll(ADD_COLUMN_RE)) {
    if (KEY_COLUMN_RE.test(match[2])) found.push({ table: match[1], column: match[2] });
  }
  return found;
}

/**
 * The `*_key` columns across `sources` that are neither registered in
 * `STORAGE_KEY_OWNERS` nor allow-listed in `NON_STORAGE_KEY_COLUMNS`.
 */
export function findUnregisteredKeyColumns(sources: Record<string, string>): KeyColumn[] {
  const registered = new Set(STORAGE_KEY_OWNERS.map(o => `${o.table}.${o.column}`));
  const allowed = new Set(NON_STORAGE_KEY_COLUMNS);
  return Object.values(sources)
    .flatMap(extractKeyColumns)
    .filter(c => !registered.has(`${c.table}.${c.column}`) && !allowed.has(c.column));
}

function describeGaps(gaps: KeyColumn[]): string {
  return gaps.map(g => `${g.table}.${g.column}`).join(', ');
}

describe('storage key-owner registry coverage', () => {
  it('finds the migrations', () => {
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(0);
  });

  it('every *_key column in the migrations is registered or allow-listed', () => {
    const gaps = findUnregisteredKeyColumns(MIGRATIONS);
    expect(gaps, `Unregistered *_key columns: ${describeGaps(gaps)}`).toEqual([]);
  });

  it('every registered owner exists in the migrations', () => {
    const declared = new Set(
      Object.values(MIGRATIONS).flatMap(extractKeyColumns).map(c => `${c.table}.${c.column}`),
    );
    for (const owner of STORAGE_KEY_OWNERS) {
      expect(declared.has(`${owner.table}.${owner.column}`), `${owner.table}.${owner.column}`).toBe(true);
    }
  });

  it('fails naming the column when a migration adds an unregistered thumbnail_key', () => {
    const fixture = {
      ...MIGRATIONS,
      '9999_add_thumbnail.sql': 'ALTER TABLE media ADD COLUMN thumbnail_key TEXT;',
    };
    const gaps = findUnregisteredKeyColumns(fixture);
    expect(gaps).toEqual([{ table: 'media', column: 'thumbnail_key' }]);
    expect(describeGaps(gaps)).toContain('thumbnail_key');
  });

  it('also catches a *_key column declared inside a new CREATE TABLE', () => {
    const fixture = {
      '9999_create_avatars.sql': `
        CREATE TABLE IF NOT EXISTS avatars (
          id TEXT PRIMARY KEY,
          -- the object in the bucket
          avatar_key TEXT NOT NULL,
          period_key TEXT,
          UNIQUE (id, avatar_key)
        );`,
    };
    expect(findUnregisteredKeyColumns(fixture)).toEqual([{ table: 'avatars', column: 'avatar_key' }]);
  });
});
