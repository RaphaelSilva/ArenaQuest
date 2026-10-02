import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import {
  createAdminStorageApi,
  type ClassifiedObject,
  type StorageMissingObject,
  type SubmissionStorageReference,
} from '@web/lib/admin-storage-api';
import type { HttpTransport } from '@web/lib/api-client';
import { formatBytes } from '../storage-format';
import { StorageDeleteButton } from '../storage-delete-action';
import { StorageListing } from '../storage-listing';
import { TOPIC_ID, detailOf, makeTransport, submissionObject, type Reply } from './fixtures';

const d = dictEn.adminStorage;

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

const linked = submissionObject();
const reference = linked.references[0] as SubmissionStorageReference;

function withReference(patch: Partial<SubmissionStorageReference>, overrides: Partial<ClassifiedObject> = {}) {
  return submissionObject({ ...overrides, references: [{ ...reference, ...patch }] });
}

function setup(handler: (path: string) => Reply) {
  http = makeTransport((_method, path) => handler(path));
  client = { adminStorage: createAdminStorageApi(http as unknown as HttpTransport) };
}

function wrap(children: React.ReactNode) {
  return <DictProvider value={dictEn}>{children}</DictProvider>;
}

function renderListing(objects: ClassifiedObject[]) {
  return render(
    wrap(
      <StorageListing
        folders={[]}
        objects={objects}
        status="ready"
        loadingMore={false}
        hasMore={false}
        selectedKey={null}
        onOpenFolder={vi.fn()}
        onSelectObject={vi.fn()}
        onLoadMore={vi.fn()}
        onRetry={vi.fn()}
      />,
    ),
  );
}

const rowOf = (name: string) => screen.getByRole('button', { name: d.openObject(name) }).closest('li')!;

describe('submission owner — listing', () => {
  it('shows title, original name and author, linked to the topic', () => {
    renderListing([linked]);
    const row = rowOf(linked.name);
    expect(within(row).getByText(d.owner.submission('Kata, 2nd attempt'))).toBeInTheDocument();
    expect(within(row).getByText(`IMG_0042.MOV · ${d.owner.submittedBy('Student A')}`)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: '9th Kyu' })).toHaveAttribute(
      'href',
      `/catalog/${TOPIC_ID}/submissions`,
    );
  });

  it('degrades without a topic or an author', () => {
    renderListing([withReference({ topic: null, author: null })]);
    const row = rowOf(linked.name);
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    expect(within(row).getByText(d.owner.topicGone)).toBeInTheDocument();
    expect(within(row).getByText(`IMG_0042.MOV · ${d.owner.submittedBy(d.owner.unknownAuthor)}`)).toBeInTheDocument();
  });

  it('labels the submissions/ root folder', () => {
    render(
      wrap(
        <StorageListing
          folders={[{ prefix: 'submissions/', name: 'submissions', owner: null, ownerGone: false }]}
          objects={[]}
          status="ready"
          loadingMore={false}
          hasMore={false}
          selectedKey={null}
          onOpenFolder={vi.fn()}
          onSelectObject={vi.fn()}
          onLoadMore={vi.fn()}
          onRetry={vi.fn()}
        />,
      ),
    );
    const folder = screen.getByRole('button', { name: d.folder.open(d.folder.submissionsRoot) });
    expect(within(folder).getByText('submissions')).toBeInTheDocument();
  });

  it('offers no Delete for a linked or pending submission object', () => {
    for (const status of ['linked', 'pending'] as const) {
      const { container, unmount } = render(
        wrap(<StorageDeleteButton object={submissionObject({ status })} onDelete={vi.fn()} />),
      );
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe('submission owner — page', () => {
  const pending = withReference(
    { status: 'pending' },
    { key: 'submissions/student-a/p-kata.mp4', name: 'p-kata.mp4', status: 'pending' },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    setup((path) => {
      const url = new URL(path, 'http://x');
      if (url.pathname.endsWith('/object')) {
        const match = [linked, pending].find((o) => o.key === url.searchParams.get('key'));
        return match ? detailOf(match) : { __status: 404, body: { error: 'NotFound' } };
      }
      return { prefix: '', folders: [], objects: [linked, pending] };
    });
  });

  async function openDrawer(name: string) {
    render(wrap(<AdminStoragePage />));
    fireEvent.click(await screen.findByRole('button', { name: d.openObject(name) }));
    return screen.findByRole('dialog', { name: d.drawer.title });
  }

  it('the drawer lists the submission reference with its status, author and topic, and no Delete', async () => {
    const drawer = await openDrawer(linked.name);
    await within(drawer).findByText(d.reference.kind.submission);
    expect(within(drawer).getByText('Kata, 2nd attempt')).toBeInTheDocument();
    expect(within(drawer).getByText('Student A')).toBeInTheDocument();
    expect(within(drawer).getByText('9th Kyu')).toBeInTheDocument();
    expect(within(drawer).getByText('IMG_0042.MOV')).toBeInTheDocument();
    expect(within(drawer).getByText(d.reference.submissionStatus.ready)).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: d.delete.actionFor(linked.name) })).not.toBeInTheDocument();
  });

  it('a pending submission shows its record status and no Delete', async () => {
    const drawer = await openDrawer(pending.name);
    const item = (await within(drawer).findByText(d.reference.kind.submission)).closest('li')!;
    expect(within(item).getByText(d.reference.submissionStatus.pending)).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: d.delete.actionFor(pending.name) })).not.toBeInTheDocument();
  });

  it('a missing-object row for a submission renders its owner and counts its bytes', async () => {
    const rows: StorageMissingObject[] = [{ key: reference.key, status: 'missing-object', reference }];
    setup((path) => {
      if (path.startsWith('/admin/storage/browse')) return { prefix: '', folders: [], objects: [] };
      return { items: rows, scanned: 1 };
    });
    render(wrap(<AdminStoragePage />));
    await screen.findByText(d.empty);
    fireEvent.click(screen.getByRole('button', { name: d.scan.startMissing }));

    const toggle = await screen.findByRole('button', { name: new RegExp(d.scan.missingObject) });
    await waitFor(() => expect(toggle).toHaveTextContent(d.scan.groupSummary(1, formatBytes(reference.sizeBytes))));
    fireEvent.click(toggle);
    expect(screen.getByText(d.owner.submission('Kata, 2nd attempt'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '9th Kyu' })).toHaveAttribute('href', `/catalog/${TOPIC_ID}/submissions`);
  });
});
