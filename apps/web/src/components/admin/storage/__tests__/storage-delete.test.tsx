import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminStorageApi, type ClassifiedObject } from '@web/lib/admin-storage-api';
import type { HttpTransport } from '@web/lib/api-client';
import { formatBytes } from '../storage-format';
import { StorageDeleteButton, deleteEligibility } from '../storage-delete-action';
import { TOPIC_ID, detailOf, makeTransport, mediaObject, orphanObject, type Reply } from './fixtures';

const d = dictEn.adminStorage;
const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

let http: ReturnType<typeof makeTransport>;
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

// --- fixtures ---------------------------------------------------------------

const orphan = orphanObject(); // 1 KB, uploaded 2026-09-01 — past the grace window
const deletedRow = orphanObject({
  key: `topics/${TOPIC_ID}/old.pdf`,
  name: 'old.pdf',
  size: 2048,
  status: 'deleted-row',
  hint: null,
});
const linked = mediaObject();

/** `orphan` re-read by the server as now linked to a topic. */
const nowLinked: ClassifiedObject = {
  ...mediaObject({ key: orphan.key }),
  name: orphan.name,
  size: orphan.size,
  status: 'linked',
};

type Handlers = {
  del?: (key: string) => Reply;
  listing?: ClassifiedObject[];
  audit?: ClassifiedObject[];
};

function setup({ del = (key) => ({ deleted: true, key, size: 1024, status: 'orphan' }), listing = [orphan, deletedRow, linked], audit = [orphan, deletedRow] }: Handlers = {}) {
  http = makeTransport((method, path) => {
    const url = new URL(path, 'http://x');
    if (method === 'DELETE') return del(url.searchParams.get('key')!);
    if (url.pathname.endsWith('/object')) {
      const match = listing.find((o) => o.key === url.searchParams.get('key'));
      return match ? detailOf(match) : { __status: 404, body: { error: 'NotFound' } };
    }
    if (url.pathname.endsWith('/audit')) return { objects: audit, scanned: 10 };
    return { prefix: '', folders: [], objects: listing };
  });
  client = { adminStorage: createAdminStorageApi(http as unknown as HttpTransport) };
}

const deleteCalls = () => http.mock.calls.filter(([method]) => method === 'DELETE');

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminStoragePage />
    </DictProvider>,
  );
}

async function openDrawer(name: string) {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: d.openObject(name) }));
  return screen.findByRole('dialog', { name: d.drawer.title });
}

async function runOrphanScan() {
  renderPage();
  await screen.findByRole('button', { name: d.openObject(orphan.name) });
  fireEvent.click(screen.getByRole('button', { name: d.scan.startOrphans }));
  await screen.findByText(d.scan.reclaimable(formatBytes(orphan.size + deletedRow.size)));
}

function scanSection() {
  return screen.getByRole('region', { name: d.scan.title });
}

function listingBadge(name: string): string | null {
  const row = screen.getByRole('button', { name: d.openObject(name) }).parentElement!;
  return row.querySelector('[data-status]')?.getAttribute('data-status') ?? null;
}

// --- tests ------------------------------------------------------------------

describe('delete eligibility', () => {
  it('is visible only for orphan and deleted-row, disabled inside the 24 h grace window', () => {
    const old = '2026-09-01T00:00:00.000Z';
    for (const status of ['linked', 'pending', 'displaced'] as const) {
      expect(deleteEligibility({ status, uploadedAt: old }, NOW)).toEqual({ visible: false });
    }
    expect(deleteEligibility({ status: 'orphan', uploadedAt: old }, NOW)).toEqual({ visible: true, disabledReason: null });
    expect(deleteEligibility({ status: 'deleted-row', uploadedAt: old }, NOW)).toEqual({
      visible: true,
      disabledReason: null,
    });
    const recent = new Date(NOW - HOUR).toISOString();
    expect(deleteEligibility({ status: 'orphan', uploadedAt: recent }, NOW)).toEqual({
      visible: true,
      disabledReason: 'within-grace-window',
    });
    // Exactly 24 h is still inside the window, as on the server.
    const edge = new Date(NOW - 24 * HOUR).toISOString();
    expect(deleteEligibility({ status: 'orphan', uploadedAt: edge }, NOW)).toMatchObject({
      disabledReason: 'within-grace-window',
    });
  });

  it('the button renders nothing for linked, and a disabled button with its reason when too recent', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const onDelete = vi.fn();
    const { container, rerender } = render(
      <DictProvider value={dictEn}>
        <StorageDeleteButton object={linked} onDelete={onDelete} />
      </DictProvider>,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <DictProvider value={dictEn}>
        <StorageDeleteButton
          key="recent"
          object={orphanObject({ uploadedAt: new Date(NOW - HOUR).toISOString() })}
          onDelete={onDelete}
        />
      </DictProvider>,
    );
    const button = screen.getByRole('button', { name: d.delete.actionFor(orphan.name) });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(d.delete.tooRecent);
    expect(screen.getByText(d.delete.tooRecent)).toBeVisible();
    fireEvent.click(button);
    expect(onDelete).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('delete orphan action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    setup();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the drawer offers Delete for an orphan and not for a linked object', async () => {
    let drawer = await openDrawer(linked.name);
    await within(drawer).findByText(d.drawer.references);
    expect(within(drawer).queryByRole('button', { name: d.delete.actionFor(linked.name) })).not.toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: d.drawer.close }));

    fireEvent.click(screen.getByRole('button', { name: d.openObject(orphan.name) }));
    drawer = await screen.findByRole('dialog', { name: d.drawer.title });
    expect(await within(drawer).findByRole('button', { name: d.delete.actionFor(orphan.name) })).toBeEnabled();
  });

  it('opens a confirmation focused on Cancel; Cancel and Escape issue no request', async () => {
    const drawer = await openDrawer(orphan.name);
    fireEvent.click(await within(drawer).findByRole('button', { name: d.delete.actionFor(orphan.name) }));

    const dialog = screen.getByRole('alertdialog', { name: d.delete.title });
    expect(within(dialog).getByText(orphan.key)).toBeInTheDocument();
    expect(within(dialog).getByText(formatBytes(orphan.size))).toBeInTheDocument();
    expect(within(dialog).getByTestId('delete-dialog-status')).toHaveTextContent(d.status.orphan);
    expect(within(dialog).getByRole('button', { name: d.delete.cancel })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole('button', { name: d.delete.cancel }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // Escape closes only the confirmation; the drawer below stays open.
    fireEvent.click(within(drawer).getByRole('button', { name: d.delete.actionFor(orphan.name) }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: d.drawer.title })).toBeInTheDocument();

    expect(deleteCalls()).toHaveLength(0);
  });

  it('traps Tab inside the confirmation', async () => {
    const drawer = await openDrawer(orphan.name);
    fireEvent.click(await within(drawer).findByRole('button', { name: d.delete.actionFor(orphan.name) }));
    const dialog = screen.getByRole('alertdialog');
    const cancel = within(dialog).getByRole('button', { name: d.delete.cancel });
    const confirm = within(dialog).getByRole('button', { name: d.delete.confirm });

    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it('confirm sends DELETE with the key; the row leaves the listing and the drawer closes', async () => {
    const drawer = await openDrawer(orphan.name);
    fireEvent.click(await within(drawer).findByRole('button', { name: d.delete.actionFor(orphan.name) }));
    fireEvent.click(screen.getByRole('button', { name: d.delete.confirm }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(http).toHaveBeenCalledWith('DELETE', `/admin/storage/object?key=${encodeURIComponent(orphan.key)}`);
    expect(screen.queryByRole('dialog', { name: d.drawer.title })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.openObject(orphan.name) })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.openObject(deletedRow.name) })).toBeInTheDocument();
    expect(screen.getByText(d.delete.deleted(orphan.key))).toBeInTheDocument();
  });

  it('deleting a scan result removes it from the results, the listing and the reclaimable total', async () => {
    await runOrphanScan();
    const section = scanSection();
    fireEvent.click(within(section).getByRole('button', { name: /Orphan/ }));
    fireEvent.click(within(section).getByRole('button', { name: d.delete.actionFor(orphan.name) }));
    fireEvent.click(screen.getByRole('button', { name: d.delete.confirm }));

    await waitFor(() =>
      expect(within(section).getByText(d.scan.reclaimable(formatBytes(deletedRow.size)))).toBeInTheDocument(),
    );
    expect(deleteCalls()).toHaveLength(1);
    expect(within(section).queryByRole('button', { name: /Orphan/ })).not.toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /Deleted row/ })).toHaveTextContent(
      d.scan.groupSummary(1, formatBytes(deletedRow.size)),
    );
    expect(screen.queryByRole('button', { name: d.openObject(orphan.name) })).not.toBeInTheDocument();
  });

  it('on 409 shows the server classification and refreshes the badge in results and listing', async () => {
    setup({
      del: () => ({
        __status: 409,
        body: { error: 'StorageObjectNotDeletable', reason: 'not-deletable-status', object: nowLinked },
      }),
    });
    await runOrphanScan();
    const section = scanSection();
    expect(listingBadge(orphan.name)).toBe('orphan');
    fireEvent.click(within(section).getByRole('button', { name: /Orphan/ }));
    fireEvent.click(within(section).getByRole('button', { name: d.delete.actionFor(orphan.name) }));
    fireEvent.click(screen.getByRole('button', { name: d.delete.confirm }));

    const dialog = screen.getByRole('alertdialog');
    expect(await within(dialog).findByText(d.delete.reason.linkedToTopic('9th Kyu'))).toBeInTheDocument();
    expect(within(dialog).getByText(d.delete.refused)).toBeInTheDocument();
    expect(within(dialog).getByTestId('delete-dialog-status')).toHaveTextContent(d.status.linked);
    expect(within(dialog).queryByRole('button', { name: d.delete.confirm })).not.toBeInTheDocument();

    // The row is re-filed under the server's answer everywhere.
    expect(listingBadge(orphan.name)).toBe('linked');
    expect(within(section).getByText(d.scan.reclaimable(formatBytes(deletedRow.size)))).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /Linked/ })).toHaveTextContent(
      d.scan.groupSummary(1, formatBytes(orphan.size)),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: d.delete.close }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('on 409 within the grace window says it was uploaded less than 24 h ago', async () => {
    setup({
      del: () => ({
        __status: 409,
        body: { error: 'StorageObjectNotDeletable', reason: 'within-grace-window', object: orphan },
      }),
    });
    const drawer = await openDrawer(orphan.name);
    fireEvent.click(await within(drawer).findByRole('button', { name: d.delete.actionFor(orphan.name) }));
    fireEvent.click(screen.getByRole('button', { name: d.delete.confirm }));

    expect(await screen.findByText(d.delete.reason.tooRecent)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.openObject(orphan.name) })).toBeInTheDocument();
  });

  it('a failed delete keeps the dialog open with an error and the row in place', async () => {
    setup({ del: () => ({ __status: 500, body: { error: 'Boom' } }) });
    const drawer = await openDrawer(orphan.name);
    fireEvent.click(await within(drawer).findByRole('button', { name: d.delete.actionFor(orphan.name) }));
    fireEvent.click(screen.getByRole('button', { name: d.delete.confirm }));

    expect(await screen.findByText(d.delete.error)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.delete.confirm })).toBeEnabled();
    expect(screen.getByRole('button', { name: d.openObject(orphan.name) })).toBeInTheDocument();
  });
});
