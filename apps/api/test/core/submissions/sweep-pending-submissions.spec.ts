import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sweepPendingSubmissions,
  STALE_PENDING_HOURS,
  SWEEP_BATCH_SIZE,
} from '@api/jobs/sweep-pending-submissions';
import type { IStorageAdapter, ISubmissionRepository, SubmissionRecord } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

/**
 * The abandoned-upload sweep (RFC 0020 §9; M23 Task 05) against fakes: batch
 * size, object-before-row order, a storage failure stopping the run without
 * throwing, and a log line that carries counts only. The end-to-end run through
 * `scheduled()` lives in `test/db/sweep-pending-submissions.spec.ts`.
 */

function pending(i: number): SubmissionRecord {
  return {
    id: `p-${i}`,
    topicNodeId: 't',
    authorId: 'student',
    authorName: 'Student',
    title: `secret title ${i}`,
    description: '',
    storageKey: `submissions/student/p-${i}-private-name.mp4`,
    originalName: 'private-name.mp4',
    contentType: 'video/mp4',
    sizeBytes: 10,
    status: Entities.Config.SubmissionStatus.PENDING,
    visibility: Entities.Config.ShareVisibility.PRIVATE,
    sharedAt: null,
    moderatedAt: null,
    moderatedBy: null,
    removedAt: null,
    removedBy: null,
    removedByName: null,
    createdAt: '2026-09-01 00:00:00',
    updatedAt: '2026-09-01 00:00:00',
  };
}

/** A repository whose stale-pending queue drains as rows are deleted. */
function fakeRepo(count: number) {
  const rows = Array.from({ length: count }, (_, i) => pending(i));
  const order: string[] = [];
  const repo = {
    listStalePending: vi.fn(async (_hours: number, limit: number) => rows.slice(0, limit)),
    delete: vi.fn(async (id: string) => {
      order.push(`row:${id}`);
      rows.splice(rows.findIndex((r) => r.id === id), 1);
    }),
  } as unknown as ISubmissionRepository;
  return { repo, rows, order };
}

afterEach(() => vi.restoreAllMocks());

describe('sweepPendingSubmissions', () => {
  it('deletes every stale pending row in batches of 100, objects before rows', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { repo, rows, order } = fakeRepo(SWEEP_BATCH_SIZE + 5);
    const deleteObjects = vi.fn(async (keys: string[]) => {
      order.push(`objects:${keys.length}`);
    });
    const report = await sweepPendingSubmissions({
      submissions: repo,
      storage: { deleteObjects } as unknown as IStorageAdapter,
    });

    expect(report).toEqual({ deleted: SWEEP_BATCH_SIZE + 5, failed: false });
    expect(rows).toHaveLength(0);
    expect(repo.listStalePending).toHaveBeenCalledWith(STALE_PENDING_HOURS, SWEEP_BATCH_SIZE);
    expect(deleteObjects).toHaveBeenCalledTimes(2);
    expect(deleteObjects.mock.calls[0][0]).toHaveLength(SWEEP_BATCH_SIZE);
    expect(order[0]).toBe(`objects:${SWEEP_BATCH_SIZE}`);
    expect(order[SWEEP_BATCH_SIZE + 1]).toBe('objects:5');
  });

  it('does nothing when no row is stale', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { repo } = fakeRepo(0);
    const deleteObjects = vi.fn();
    expect(
      await sweepPendingSubmissions({ submissions: repo, storage: { deleteObjects } as unknown as IStorageAdapter }),
    ).toEqual({ deleted: 0, failed: false });
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it('keeps the rows and stops, without throwing, when storage fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { repo, rows } = fakeRepo(3);
    const report = await sweepPendingSubmissions({
      submissions: repo,
      storage: { deleteObjects: vi.fn().mockRejectedValue(new Error('R2 down: submissions/student/p-0')) } as unknown as IStorageAdapter,
    });
    expect(report).toEqual({ deleted: 0, failed: true });
    expect(rows).toHaveLength(3);
    expect(repo.delete).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).not.toContain('submissions/');
  });

  it('logs a count only - never titles, names or keys', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { repo } = fakeRepo(2);
    await sweepPendingSubmissions({
      submissions: repo,
      storage: { deleteObjects: vi.fn() } as unknown as IStorageAdapter,
    });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ event: 'submissions.sweep_pending', deleted: 2, failed: false });
    for (const leak of ['secret title', 'private-name', 'submissions/', 'p-0']) expect(line).not.toContain(leak);
  });
});
