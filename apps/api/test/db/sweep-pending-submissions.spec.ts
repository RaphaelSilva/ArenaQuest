import { env, createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';

/**
 * The abandoned-upload sweep through the real `scheduled()` handler (RFC 0020
 * §9; M23 Task 05), against a real D1 and R2: a pending row created 25 h ago
 * and its object are gone, a 1 h old one remains, ready rows are untouched,
 * and billing's daily run still happens on the same trigger.
 */

const STUDENT = 'sweep-student';
const TOPIC = 'sweep-topic';

beforeAll(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(STUDENT, 'Sweep Student', 'sweep@student.test', 'hash'),
    env.DB.prepare(
      `INSERT OR IGNORE INTO topic_nodes (id, title, status, archived, visibility) VALUES (?, 'Sweep', 'published', 0, 'restricted')`,
    ).bind(TOPIC),
  ]);
});

afterEach(() => vi.restoreAllMocks());

/** Inserts a row `ageHours` old with an object in R2; returns its id and key. */
async function insert(status: 'pending' | 'ready', ageHours: number) {
  const id = crypto.randomUUID();
  const key = `submissions/${STUDENT}/${id}-kata.mp4`;
  await env.DB.prepare(
    `INSERT INTO topic_submissions
       (id, topic_node_id, author_id, title, storage_key, original_name, content_type, size_bytes,
        status, visibility, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'Kata', ?4, 'kata.mp4', 'video/mp4', 10, ?5, 'private', datetime('now', ?6), datetime('now', ?6))`,
  )
    .bind(id, TOPIC, STUDENT, key, status, `-${ageHours} hours`)
    .run();
  await env.R2.put(key, new Uint8Array(10));
  return { id, key };
}

const exists = async (id: string) =>
  (await env.DB.prepare('SELECT id FROM topic_submissions WHERE id = ?').bind(id).first()) !== null;

async function runScheduled(workerEnv: AppEnv = env as AppEnv) {
  const controller = createScheduledController({ scheduledTime: Date.now(), cron: '0 3 * * *' });
  const ctx = createExecutionContext();
  await worker.scheduled(controller, workerEnv, ctx);
  await waitOnExecutionContext(ctx);
}

/** The structured log lines with an `event` field, from one console method's spy. */
function events(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls.flatMap((call) => {
    try {
      const parsed = JSON.parse(String(call[0]));
      return parsed && typeof parsed === 'object' && 'event' in parsed ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

describe('scheduled() - pending submissions sweep', () => {
  it('deletes a 25 h old pending row and its object, keeps a 1 h old one and ready rows, and still runs billing', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const stale = await insert('pending', 25);
    const fresh = await insert('pending', 1);
    const oldReady = await insert('ready', 100);

    await runScheduled();

    expect(await exists(stale.id)).toBe(false);
    expect(await env.R2.head(stale.key)).toBeNull();
    expect(await exists(fresh.id)).toBe(true);
    expect(await env.R2.head(fresh.key)).not.toBeNull();
    expect(await exists(oldReady.id)).toBe(true);
    expect(await env.R2.head(oldReady.key)).not.toBeNull();

    expect(events(log)).toContainEqual(expect.objectContaining({ event: 'submissions.sweep_pending', deleted: 1, failed: false }));
    expect(events(info).map((e) => e.event)).toContain('billing.invoice_run');
  });

  it('a failing R2 keeps the stale row, and neither throws nor stops billing', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stale = await insert('pending', 30);

    const real = env.R2;
    const failingR2 = {
      head: (k: string) => real.head(k),
      get: (k: string, o?: R2GetOptions) => real.get(k, o),
      put: real.put.bind(real),
      list: real.list.bind(real),
      delete: () => Promise.reject(new Error('R2 is down')),
    };
    await expect(runScheduled({ ...env, R2: failingR2 } as unknown as AppEnv)).resolves.toBeUndefined();

    expect(await exists(stale.id)).toBe(true);
    expect(events(error)).toContainEqual(expect.objectContaining({ event: 'submissions.sweep_pending', failed: true }));
    expect(events(info).map((e) => e.event)).toContain('billing.invoice_run');
  });
});
