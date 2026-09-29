import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminStorageApi, type ClassifiedObject, type StorageMissingObject } from '@web/lib/admin-storage-api';
import type { HttpTransport } from '@web/lib/api-client';
import { formatBytes } from '../storage-format';
import { EVENT_ID, TOPIC_ID, detailOf, flyerObject, mediaObject, orphanObject, root } from './fixtures';

const d = dictEn.adminStorage;

let client: { adminStorage: ReturnType<typeof createAdminStorageApi> };

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: () => true,
}));
vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import AdminStoragePage from '@web/app/(protected)/admin/storage/page';

type Call = { path: string; signal?: AbortSignal };

/**
 * A transport that records each request with its `AbortSignal`. A handler may
 * return `'hang'` to leave the request in flight until it is aborted, or a
 * `{ __status }` reply to fail it.
 */
function setup(handler: (path: string) => unknown) {
  const calls: Call[] = [];
  const http = vi.fn((_method: string, path: string, options?: { signal?: AbortSignal }) => {
    calls.push({ path, signal: options?.signal });
    const reply = handler(path) as { __status?: number } | 'hang';
    if (reply === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    const status = reply && typeof reply === 'object' && '__status' in reply ? reply.__status! : 200;
    return Promise.resolve({
      ok: status === 200,
      status,
      json: async () => (status === 200 ? reply : { error: 'BOOM' }),
    } as unknown as Response);
  });
  client = { adminStorage: createAdminStorageApi(http as unknown as HttpTransport) };
  return { http, calls };
}

const auditCalls = (calls: Call[], path = '/admin/storage/audit') =>
  calls.filter((c) => c.path === path || c.path.startsWith(`${path}?`));

const cursorOf = (call: Call) => new URL(call.path, 'http://x').searchParams.get('cursor');

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminStoragePage />
    </DictProvider>,
  );
}

async function startOrphanScan() {
  renderPage();
  await screen.findByRole('button', { name: d.folder.open('topics') });
  fireEvent.click(screen.getByRole('button', { name: d.scan.startOrphans }));
}

function statusRegion(): HTMLElement {
  // The scan progress is the aria-live region inside the scan section.
  const section = screen.getByRole('region', { name: d.scan.title });
  return within(section).getByRole('status');
}

const pending = (overrides: Partial<ClassifiedObject> = {}) =>
  mediaObject({ key: `topics/${TOPIC_ID}/p1.pdf`, status: 'pending', size: 100, ...overrides });

describe('StorageScanPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('walks /audit page after page until nextCursor is absent and sums scanned', async () => {
    const { calls } = setup((path) => {
      if (path.startsWith('/admin/storage/browse')) return root;
      const cursor = cursorOf({ path });
      if (cursor === null) return { objects: [orphanObject()], scanned: 1000, nextCursor: 'c1' };
      if (cursor === 'c1') return { objects: [], scanned: 1000, nextCursor: 'c2' };
      return { objects: [pending({ stale: true })], scanned: 250 };
    });

    await startOrphanScan();

    await waitFor(() => expect(statusRegion()).toHaveTextContent(d.scan.done(d.scan.scannedKeys(2250))));
    const audits = auditCalls(calls);
    expect(audits.map(cursorOf)).toEqual([null, 'c1', 'c2']);
    expect(audits[0].path).toBe('/admin/storage/audit');
  });

  it('stop aborts the in-flight request and issues no further request', async () => {
    const { calls } = setup((path) => {
      if (path.startsWith('/admin/storage/browse')) return root;
      if (cursorOf({ path }) === null) return { objects: [orphanObject()], scanned: 1000, nextCursor: 'c1' };
      return 'hang';
    });

    await startOrphanScan();
    const stop = await screen.findByRole('button', { name: d.scan.stop });
    await waitFor(() => expect(auditCalls(calls)).toHaveLength(2));
    expect(stop).toHaveFocus();

    fireEvent.click(stop);

    await waitFor(() => expect(statusRegion()).toHaveTextContent(d.scan.stopped(d.scan.scannedKeys(1000))));
    expect(auditCalls(calls)[1].signal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(auditCalls(calls)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: d.scan.stop })).not.toBeInTheDocument();
    // Results found before the stop are kept.
    expect(screen.getByRole('button', { name: /Orphan/ })).toHaveTextContent(d.scan.groupSummary(1, formatBytes(1024)));
  });

  it('a failed page shows an error; Retry resumes from the last good cursor and keeps results', async () => {
    let failC1 = true;
    const { calls } = setup((path) => {
      if (path.startsWith('/admin/storage/browse')) return root;
      const cursor = cursorOf({ path });
      if (cursor === null) return { objects: [orphanObject()], scanned: 1000, nextCursor: 'c1' };
      if (failC1) {
        failC1 = false;
        return { __status: 500 };
      }
      return { objects: [orphanObject({ key: 'topics/gone-id/two.pdf', name: 'two.pdf', size: 2048 })], scanned: 5 };
    });

    await startOrphanScan();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(d.scan.error);
    fireEvent.click(within(alert).getByRole('button', { name: d.scan.retry }));

    await waitFor(() => expect(statusRegion()).toHaveTextContent(d.scan.done(d.scan.scannedKeys(1005))));
    expect(auditCalls(calls).map(cursorOf)).toEqual([null, 'c1', 'c1']);
    expect(screen.getByRole('button', { name: /Orphan/ })).toHaveTextContent(
      d.scan.groupSummary(2, formatBytes(1024 + 2048)),
    );
  });

  it('groups results by status with count and total bytes, and opens the drawer on select', async () => {
    const deletedRow = orphanObject({ key: 'topics/x/del.mp4', name: 'del.mp4', status: 'deleted-row', hint: null, size: 4096 });
    const displaced = flyerObject({ key: `events/${EVENT_ID}/old.png`, status: 'displaced', size: 300 });
    const { calls } = setup((path) => {
      if (path.startsWith('/admin/storage/browse')) return root;
      if (path.startsWith('/admin/storage/object')) return detailOf(orphanObject());
      return {
        objects: [
          orphanObject(),
          orphanObject({ key: 'unknown/a.bin', name: 'a.bin', hint: 'unknown-shape', size: 10 }),
          deletedRow,
          displaced,
          pending({ stale: true }),
          pending({ key: `topics/${TOPIC_ID}/p2.pdf`, stale: false, size: 50 }),
        ],
        scanned: 900,
      };
    });

    await startOrphanScan();
    await waitFor(() => expect(statusRegion()).toHaveTextContent(d.scan.done(d.scan.scannedKeys(900))));

    const groups = screen.getByRole('list', { name: d.scan.resultsLabel });
    const summaries = within(groups)
      .getAllByRole('listitem')
      .filter((li) => li.hasAttribute('data-group'))
      .map((li) => [li.getAttribute('data-group'), within(li).getByTestId('group-summary').textContent]);
    expect(summaries).toEqual([
      ['orphan', d.scan.groupSummary(2, formatBytes(1034))],
      ['deleted-row', d.scan.groupSummary(1, formatBytes(4096))],
      ['stale-pending', d.scan.groupSummary(1, formatBytes(100))],
      ['displaced', d.scan.groupSummary(1, formatBytes(300))],
      ['pending', d.scan.groupSummary(1, formatBytes(50))],
    ]);
    expect(screen.getByText(d.scan.reclaimable(formatBytes(1034 + 4096)))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Orphan/ }));
    fireEvent.click(screen.getByRole('button', { name: d.openObject('topics/gone-id/stray.pdf') }));

    await screen.findByRole('dialog');
    expect(calls.some((c) => c.path === `/admin/storage/object?key=${encodeURIComponent('topics/gone-id/stray.pdf')}`)).toBe(
      true,
    );
  });

  it('"Check for missing files" lists missing-object rows with owner links', async () => {
    const media = mediaObject().references[0];
    const flyer = flyerObject().references[0];
    const rows: StorageMissingObject[] = [
      { key: media.key, status: 'missing-object', reference: media },
      { key: flyer.key, status: 'missing-object', reference: flyer },
    ];
    const { calls } = setup((path) => {
      if (path.startsWith('/admin/storage/browse')) return root;
      return cursorOf({ path }) === null
        ? { items: [rows[0]], scanned: 50, nextCursor: 'm1' }
        : { items: [rows[1]], scanned: 7 };
    });

    renderPage();
    await screen.findByRole('button', { name: d.folder.open('topics') });
    fireEvent.click(screen.getByRole('button', { name: d.scan.startMissing }));

    await waitFor(() => expect(statusRegion()).toHaveTextContent(d.scan.done(d.scan.checkedReferences(57))));
    expect(auditCalls(calls, '/admin/storage/audit/missing').map(cursorOf)).toEqual([null, 'm1']);
    expect(auditCalls(calls)).toHaveLength(0);

    const toggle = screen.getByRole('button', { name: new RegExp(d.scan.missingObject) });
    expect(toggle).toHaveTextContent(d.scan.groupSummary(2, formatBytes(2 * 1024 * 1024)));
    fireEvent.click(toggle);

    expect(screen.getByText(media.key)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '9th Kyu' })).toHaveAttribute('href', '/admin/topics');
    expect(screen.getByRole('link', { name: 'Summer Seminar' })).toHaveAttribute('href', `/admin/events/${EVENT_ID}`);
  });

  it('shows the empty message when a finished scan found nothing', async () => {
    setup((path) => (path.startsWith('/admin/storage/browse') ? root : { objects: [], scanned: 3 }));
    await startOrphanScan();
    expect(await screen.findByText(d.scan.emptyOrphans)).toBeInTheDocument();
  });
});
