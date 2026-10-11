import type { IJobRunRepository, IRateLimiter, IStorageAdapter } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { JOB_RUNS_LIST_DEFAULT_LIMIT, JOB_RUNS_LIST_MAX_LIMIT } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

/**
 * Admin operations surface (RFC 0025 section 3.2, M28 Task 06) — **read-only**.
 *
 * Health is *measured*, not asserted: every dependency is probed through its
 * port (a pure read on each), timed, and classified against two thresholds.
 * No provider symbol appears here — the controller knows the job-run port,
 * the rate-limiter port and the storage port, nothing about D1, KV or R2.
 *
 * Probes run in parallel and each races its own timeout, so one hung binding
 * bounds the response at `timeoutMs` instead of hanging it.
 */

/** A probe slower than this (ms) is `degraded`. */
export const DEGRADED_MS = 1000;
/** A probe slower than this (ms) is `down` with `error: 'timeout'`. */
export const PROBE_TIMEOUT_MS = 3000;

/** The fixed keys every probe reads. Nothing is ever written under them. */
export const KV_PROBE_KEY = 'ops:health-probe';
export const STORAGE_PROBE_KEY = 'ops/health-probe';

export type DependencyStatus = 'ok' | 'degraded' | 'down';
export type DependencyName = 'd1' | 'kv' | 'r2';

export interface DependencyHealth {
  name: DependencyName;
  status: DependencyStatus;
  latencyMs: number;
  /** First line of the failure message, or `timeout`; absent unless `down`. */
  error?: string;
}

/** The last run of one job, with its age at the time of the check. */
export interface JobHealth {
  job: Entities.Config.JobName;
  /** `null` when the job has never run. */
  lastRun: (Entities.Ops.JobRun & { ageMs: number }) | null;
}

export interface OpsHealth {
  /** The worst dependency status. */
  status: DependencyStatus;
  checkedAt: string;
  dependencies: DependencyHealth[];
  latestMigration: string | null;
  jobs: JobHealth[];
}

export interface ListJobRunsQuery {
  job?: Entities.Config.JobName;
  /** ISO timestamp, validated upstream. */
  since?: string;
  limit?: number;
}

export interface AdminOpsDeps {
  jobRuns: IJobRunRepository;
  /** Any rate limiter: `peek` is the documented pure read of the KV port. */
  kv: IRateLimiter;
  storage: IStorageAdapter;
  now?: () => Date;
  timeoutMs?: number;
  degradedMs?: number;
}

const SEVERITY: Record<DependencyStatus, number> = { ok: 0, degraded: 1, down: 2 };

/** Only the first line of a message is reported: never a stack, never a payload. */
function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const line = message.split('\n', 1)[0].trim();
  return line.length > 0 ? line : 'error';
}

/**
 * Runs one probe against a timeout and classifies the outcome. The timer is
 * always cleared, so a fast probe leaves nothing pending behind it.
 */
export async function probe(
  name: DependencyName,
  fn: () => Promise<unknown>,
  options: { timeoutMs: number; degradedMs: number },
): Promise<DependencyHealth> {
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), options.timeoutMs);
  });
  try {
    const outcome = await Promise.race([fn().then(() => 'done' as const), timeout]);
    const latencyMs = Math.round(performance.now() - startedAt);
    if (outcome === 'timeout') return { name, status: 'down', latencyMs, error: 'timeout' };
    return { name, status: latencyMs > options.degradedMs ? 'degraded' : 'ok', latencyMs };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    return { name, status: 'down', latencyMs, error: firstLine(err) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class AdminOpsController {
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly degradedMs: number;

  constructor(private readonly deps: AdminOpsDeps) {
    this.now = deps.now ?? (() => new Date());
    this.timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
    this.degradedMs = deps.degradedMs ?? DEGRADED_MS;
  }

  /**
   * Always `ok: true` — the health verdict travels in the body, so a `down`
   * dependency is still a `200` with the detail an operator needs to act on.
   * A failing job-run read leaves `jobs` empty rather than failing the call;
   * the `d1` dependency already reports that store.
   */
  async health(): Promise<ControllerResult<OpsHealth>> {
    const options = { timeoutMs: this.timeoutMs, degradedMs: this.degradedMs };
    let latestMigration: string | null = null;

    const [d1, kv, r2, latestRuns] = await Promise.all([
      probe(
        'd1',
        async () => {
          const result = await this.deps.jobRuns.databaseProbe();
          latestMigration = result.latestMigration;
        },
        options,
      ),
      probe('kv', () => this.deps.kv.peek(KV_PROBE_KEY), options),
      probe('r2', () => this.deps.storage.headObject(STORAGE_PROBE_KEY), options),
      this.deps.jobRuns.latestPerJob().catch(() => [] as Entities.Ops.JobRun[]),
    ]);

    const dependencies = [d1, kv, r2];
    const status = dependencies.reduce<DependencyStatus>(
      (worst, dep) => (SEVERITY[dep.status] > SEVERITY[worst] ? dep.status : worst),
      'ok',
    );

    const checkedAt = this.now();
    const byJob = new Map(latestRuns.map((run) => [run.job, run]));
    const jobs: JobHealth[] = Object.values(Entities.Config.JobName).map((job) => {
      const run = byJob.get(job);
      return {
        job,
        lastRun: run ? { ...run, ageMs: Math.max(0, checkedAt.getTime() - Date.parse(run.startedAt)) } : null,
      };
    });

    return {
      ok: true,
      data: { status, checkedAt: checkedAt.toISOString(), dependencies, latestMigration, jobs },
    };
  }

  /** Newest first; `limit` is clamped to the port's bounds, filters pass through. */
  async listJobRuns(query: ListJobRunsQuery = {}): Promise<ControllerResult<{ runs: Entities.Ops.JobRun[] }>> {
    const requested = Math.trunc(query.limit ?? JOB_RUNS_LIST_DEFAULT_LIMIT);
    const limit = Math.min(Math.max(1, requested), JOB_RUNS_LIST_MAX_LIMIT);
    const runs = await this.deps.jobRuns.list({ job: query.job, since: query.since, limit });
    return { ok: true, data: { runs } };
  }
}
