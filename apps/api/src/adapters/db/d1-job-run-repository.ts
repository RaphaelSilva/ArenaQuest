import { D1Database } from '@cloudflare/workers-types';
import {
  JOB_RUN_ERROR_MAX_LENGTH,
  JOB_RUNS_LIST_DEFAULT_LIMIT,
  JOB_RUNS_LIST_MAX_LIMIT,
  type IJobRunRepository,
  type StartJobRunParams,
  type FinishJobRunParams,
  type ListJobRunsOptions,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

type JobRunRow = {
  id: string;
  job: string;
  trigger: string;
  status: string;
  actor_id: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  summary: string | null;
  error: string | null;
};

/**
 * A stored summary that is not a JSON object of numbers is reported as `null`
 * rather than thrown: the row is an observation, and a malformed one must not
 * take the ops surface that reads it down with it.
 */
function parseSummary(raw: string | null): Record<string, number> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number') out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}

function rowToJobRun(row: JobRunRow): Entities.Ops.JobRun {
  return {
    id: row.id,
    job: row.job as Entities.Config.JobName,
    trigger: row.trigger as Entities.Config.JobTrigger,
    status: row.status as Entities.Config.JobRunStatus,
    actorId: row.actor_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    summary: parseSummary(row.summary),
    error: row.error,
  };
}

/**
 * D1 implementation of {@link IJobRunRepository} (RFC 0025 section 3.1).
 *
 * Timestamps are ISO strings written by the adapter (not `datetime('now')`),
 * so a `started_at` read back compares exactly with what the caller saw, and
 * `duration_ms` is derived in the `UPDATE` itself from the stored start.
 */
export class D1JobRunRepository implements IJobRunRepository {
  constructor(private readonly db: D1Database) {}

  async start(params: StartJobRunParams): Promise<Entities.Ops.JobRun> {
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO job_runs (id, job, trigger, status, actor_id, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, params.job, params.trigger, Entities.Config.JobRunStatus.RUNNING, params.actorId ?? null, startedAt)
      .run();
    return {
      id,
      job: params.job,
      trigger: params.trigger,
      status: Entities.Config.JobRunStatus.RUNNING,
      actorId: params.actorId ?? null,
      startedAt,
      finishedAt: null,
      durationMs: null,
      summary: null,
      error: null,
    };
  }

  async finish(id: string, params: FinishJobRunParams): Promise<void> {
    const finishedAt = new Date().toISOString();
    const summary = params.summary === undefined || params.summary === null ? null : JSON.stringify(params.summary);
    const error =
      params.error === undefined || params.error === null ? null : params.error.slice(0, JOB_RUN_ERROR_MAX_LENGTH);
    await this.db
      .prepare(
        `UPDATE job_runs
         SET status = ?,
             finished_at = ?,
             duration_ms = CAST(ROUND((julianday(?) - julianday(started_at)) * 86400000) AS INTEGER),
             summary = ?,
             error = ?
         WHERE id = ?`,
      )
      .bind(params.status, finishedAt, finishedAt, summary, error, id)
      .run();
  }

  async list(options: ListJobRunsOptions = {}): Promise<Entities.Ops.JobRun[]> {
    const where: string[] = [];
    const binds: Array<string | number> = [];
    if (options.job !== undefined) {
      where.push('job = ?');
      binds.push(options.job);
    }
    if (options.since !== undefined) {
      where.push('started_at >= ?');
      binds.push(options.since);
    }
    const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? JOB_RUNS_LIST_DEFAULT_LIMIT)), JOB_RUNS_LIST_MAX_LIMIT);
    binds.push(limit);

    const sql = `SELECT * FROM job_runs
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY started_at DESC, rowid DESC
      LIMIT ?`;
    const { results } = await this.db.prepare(sql).bind(...binds).all<JobRunRow>();
    return results.map(rowToJobRun);
  }

  async latestPerJob(): Promise<Entities.Ops.JobRun[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, job, trigger, status, actor_id, started_at, finished_at, duration_ms, summary, error
         FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY job ORDER BY started_at DESC, rowid DESC) AS rn
           FROM job_runs
         )
         WHERE rn = 1
         ORDER BY job ASC`,
      )
      .all<JobRunRow>();
    return results.map(rowToJobRun);
  }

  async pruneOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = await this.db.prepare('DELETE FROM job_runs WHERE started_at < ?').bind(cutoff).run();
    return result.meta.changes ?? 0;
  }
}
