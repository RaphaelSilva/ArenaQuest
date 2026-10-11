import { describe, it, expect } from 'vitest';
import type { IJobRunRepository, IRateLimiter, IStorageAdapter, ListJobRunsOptions } from '@arenaquest/shared/ports';
import { JOB_RUNS_LIST_MAX_LIMIT } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import {
  AdminOpsController,
  KV_PROBE_KEY,
  STORAGE_PROBE_KEY,
  probe,
  type OpsHealth,
} from '@api/controllers/admin-ops.controller';

/**
 * The ops controller against recording fakes (RFC 0025 section 3.2): every
 * dependency classified from what its probe did, the worst status wins, the
 * response is bounded by the timeout, and — asserted, not assumed — a health
 * call issues no write to any port.
 */

const { JobName, JobTrigger, JobRunStatus } = Entities.Config;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function run(job: Entities.Config.JobName, startedAt: string): Entities.Ops.JobRun {
  return {
    id: `run-${job}`,
    job,
    trigger: JobTrigger.CRON,
    status: JobRunStatus.OK,
    actorId: null,
    startedAt,
    finishedAt: startedAt,
    durationMs: 1,
    summary: { n: 1 },
    error: null,
  };
}

interface Fakes {
  calls: string[];
  jobRuns: IJobRunRepository;
  kv: IRateLimiter;
  storage: IStorageAdapter;
  listOptions: ListJobRunsOptions[];
}

/**
 * Every method of every port records its name; a probe that should be a pure
 * read is then provable by the list of names. `behaviour` overrides the three
 * probed reads only.
 */
function fakes(behaviour: {
  database?: () => Promise<{ latestMigration: string | null }>;
  peek?: () => Promise<unknown>;
  head?: () => Promise<unknown>;
  latest?: Entities.Ops.JobRun[];
} = {}): Fakes {
  const calls: string[] = [];
  const listOptions: ListJobRunsOptions[] = [];
  const rec = <T>(name: string, value: T) => async () => {
    calls.push(name);
    return value;
  };
  const jobRuns = {
    start: rec('jobRuns.start', run(JobName.BILLING, new Date().toISOString())),
    finish: rec('jobRuns.finish', undefined),
    list: async (options?: ListJobRunsOptions) => {
      calls.push('jobRuns.list');
      listOptions.push(options ?? {});
      return [];
    },
    latestPerJob: async () => {
      calls.push('jobRuns.latestPerJob');
      return behaviour.latest ?? [];
    },
    pruneOlderThan: rec('jobRuns.pruneOlderThan', 0),
    databaseProbe: async () => {
      calls.push('jobRuns.databaseProbe');
      return behaviour.database ? behaviour.database() : { latestMigration: '0032_create_job_runs.sql' };
    },
  } satisfies IJobRunRepository;
  const ok = { allowed: true, remaining: 5 };
  const kv = {
    hit: rec('kv.hit', ok),
    reset: rec('kv.reset', undefined),
    peek: async () => {
      calls.push('kv.peek');
      return behaviour.peek ? ((await behaviour.peek()) as typeof ok) : ok;
    },
  } satisfies IRateLimiter;
  const storage = {
    putObject: rec('storage.putObject', undefined),
    getObject: rec('storage.getObject', null),
    deleteObject: rec('storage.deleteObject', undefined),
    headObject: async () => {
      calls.push('storage.headObject');
      return behaviour.head ? ((await behaviour.head()) as null) : null;
    },
    readHead: rec('storage.readHead', null),
    getPresignedUploadUrl: rec('storage.getPresignedUploadUrl', ''),
    getPresignedDownloadUrl: rec('storage.getPresignedDownloadUrl', ''),
    listObjects: rec('storage.listObjects', { objects: [], prefixes: [], nextCursor: null }),
  } as unknown as IStorageAdapter;
  return { calls, jobRuns, kv, storage, listOptions };
}

const READS = ['jobRuns.databaseProbe', 'kv.peek', 'storage.headObject', 'jobRuns.latestPerJob'];

async function health(f: Fakes, extra: Partial<ConstructorParameters<typeof AdminOpsController>[0]> = {}): Promise<OpsHealth> {
  const controller = new AdminOpsController({ jobRuns: f.jobRuns, kv: f.kv, storage: f.storage, ...extra });
  const result = await controller.health();
  if (!result.ok) throw new Error('health is always ok');
  return result.data;
}

describe('AdminOpsController.health', () => {
  it('reports every dependency ok, the latest migration and the last run per job with its age', async () => {
    const now = new Date('2026-10-11T12:00:00.000Z');
    const f = fakes({ latest: [run(JobName.BILLING, '2026-10-11T03:00:00.000Z')] });
    const data = await health(f, { now: () => now });

    expect(data.status).toBe('ok');
    expect(data.checkedAt).toBe(now.toISOString());
    expect(data.latestMigration).toBe('0032_create_job_runs.sql');
    expect(data.dependencies.map((d) => [d.name, d.status])).toEqual([
      ['d1', 'ok'],
      ['kv', 'ok'],
      ['r2', 'ok'],
    ]);
    for (const dep of data.dependencies) {
      expect(dep.latencyMs).toBeGreaterThanOrEqual(0);
      expect(dep.error).toBeUndefined();
    }
    expect(data.jobs).toEqual([
      { job: 'billing', lastRun: { ...run(JobName.BILLING, '2026-10-11T03:00:00.000Z'), ageMs: 9 * 3_600_000 } },
      { job: 'sweep_submissions', lastRun: null },
    ]);
  });

  it('issues no write: only the four reads are called, on the fixed probe keys', async () => {
    const f = fakes();
    const peekKeys: string[] = [];
    const headKeys: string[] = [];
    const originalPeek = f.kv.peek;
    const originalHead = f.storage.headObject;
    f.kv.peek = (key) => {
      peekKeys.push(key);
      return originalPeek(key);
    };
    f.storage.headObject = (key) => {
      headKeys.push(key);
      return originalHead(key);
    };

    await health(f);

    expect([...f.calls].sort()).toEqual([...READS].sort());
    expect(peekKeys).toEqual([KV_PROBE_KEY]);
    expect(headKeys).toEqual([STORAGE_PROBE_KEY]);
  });

  it('a throwing storage head makes r2 down, with the first line of the message, and the overall status down', async () => {
    const f = fakes({ head: async () => { throw new Error('bucket unreachable\n    at R2Bucket.head'); } });
    const data = await health(f);

    expect(data.status).toBe('down');
    const r2 = data.dependencies.find((d) => d.name === 'r2');
    expect(r2).toMatchObject({ status: 'down', error: 'bucket unreachable' });
    expect(data.dependencies.filter((d) => d.name !== 'r2').every((d) => d.status === 'ok')).toBe(true);
  });

  it('a slow probe beyond the threshold is degraded, and degraded beats ok', async () => {
    const f = fakes({ peek: () => sleep(30) });
    const data = await health(f, { degradedMs: 5, timeoutMs: 500 });

    expect(data.status).toBe('degraded');
    expect(data.dependencies.find((d) => d.name === 'kv')).toMatchObject({ status: 'degraded' });
    expect(data.dependencies.find((d) => d.name === 'kv')?.latencyMs).toBeGreaterThan(5);
  });

  it('a hung probe is down with error timeout, and the call returns before the probe would', async () => {
    const f = fakes({ database: () => sleep(400).then(() => ({ latestMigration: 'late' })) });
    const startedAt = Date.now();
    const data = await health(f, { degradedMs: 5, timeoutMs: 40 });

    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(data.status).toBe('down');
    expect(data.dependencies.find((d) => d.name === 'd1')).toMatchObject({ status: 'down', error: 'timeout' });
    expect(data.latestMigration).toBeNull();
  });

  it('a failing latestPerJob leaves jobs unrun rather than failing the call', async () => {
    const f = fakes();
    f.jobRuns.latestPerJob = async () => { throw new Error('boom'); };
    const data = await health(f);
    expect(data.status).toBe('ok');
    expect(data.jobs.every((j) => j.lastRun === null)).toBe(true);
  });
});

describe('probe', () => {
  it('classifies a fast read as ok and a thrown non-Error as down with its text', async () => {
    const fast = await probe('kv', async () => 1, { timeoutMs: 100, degradedMs: 50 });
    expect(fast).toEqual({ name: 'kv', status: 'ok', latencyMs: expect.any(Number) });

    const thrown = await probe('r2', async () => { throw 'plain string'; }, { timeoutMs: 100, degradedMs: 50 });
    expect(thrown).toMatchObject({ name: 'r2', status: 'down', error: 'plain string' });
  });
});

describe('AdminOpsController.listJobRuns', () => {
  it('passes the filters through and clamps the limit to the port bounds', async () => {
    const f = fakes();
    const controller = new AdminOpsController({ jobRuns: f.jobRuns, kv: f.kv, storage: f.storage });

    const result = await controller.listJobRuns({ job: JobName.BILLING, since: '2026-10-01T00:00:00Z', limit: 10 });
    expect(result).toEqual({ ok: true, data: { runs: [] } });
    await controller.listJobRuns({ limit: 10_000 });
    await controller.listJobRuns({ limit: 0 });
    await controller.listJobRuns();

    expect(f.listOptions).toEqual([
      { job: 'billing', since: '2026-10-01T00:00:00Z', limit: 10 },
      { job: undefined, since: undefined, limit: JOB_RUNS_LIST_MAX_LIMIT },
      { job: undefined, since: undefined, limit: 1 },
      { job: undefined, since: undefined, limit: 50 },
    ]);
    expect(f.calls.every((c) => c === 'jobRuns.list')).toBe(true);
  });
});
