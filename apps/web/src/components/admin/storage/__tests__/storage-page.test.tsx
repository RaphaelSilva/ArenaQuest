import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminStorageApi } from '@web/lib/admin-storage-api';
import type { HttpTransport } from '@web/lib/api-client';
import {
  TOPIC_ID,
  detailOf,
  fail,
  flyerObject,
  makeTransport,
  mediaObject,
  orphanObject,
  root,
  topicsFolder,
  type Reply,
} from './fixtures';

const replace = vi.fn();
let isAdmin = true;
let http: ReturnType<typeof makeTransport>;
let client: { adminStorage: ReturnType<typeof createAdminStorageApi> };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: () => isAdmin,
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import AdminStoragePage from '@web/app/(protected)/admin/storage/page';

const d = dictEn.adminStorage;

function setup(handler: (path: string) => Reply) {
  http = makeTransport((_method, path) => handler(path));
  client = { adminStorage: createAdminStorageApi(http as unknown as HttpTransport) };
}

function browsePrefixes(): string[] {
  return http.mock.calls
    .map(([, path]) => path as string)
    .filter((path) => path.startsWith('/admin/storage/browse'))
    .map((path) => new URL(path, 'http://x').searchParams.get('prefix') ?? '<none>');
}

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminStoragePage />
    </DictProvider>,
  );
}

const topicFolderPage = {
  prefix: `topics/${TOPIC_ID}/`,
  folders: [],
  objects: [mediaObject()],
};

describe('AdminStoragePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin = true;
    setup((path) => {
      const prefix = new URL(path, 'http://x').searchParams.get('prefix');
      if (prefix === '') return root;
      if (prefix === 'topics/') return topicsFolder;
      if (prefix === `topics/${TOPIC_ID}/`) return topicFolderPage;
      return { prefix, folders: [], objects: [] };
    });
  });

  it('browses the bucket root with an empty prefix and renders its folders', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: d.folder.open('topics') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.folder.open('events') })).toBeInTheDocument();
    expect(http).toHaveBeenCalledWith('GET', '/admin/storage/browse?prefix=');
    expect(browsePrefixes()).toEqual(['']);
  });

  it('navigates topics/ then a topic folder, labelling it with the topic title', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: d.folder.open('topics') }));

    const topicRow = await screen.findByRole('button', { name: d.folder.open('9th Kyu') });
    expect(within(topicRow).getByText('9th Kyu')).toBeInTheDocument();
    // An owner-shaped folder whose topic is gone is flagged, not hidden.
    expect(screen.getByText(d.folder.gone)).toBeInTheDocument();

    fireEvent.click(topicRow);
    await screen.findByRole('button', { name: d.openObject('a1-kata_final.mp4') });
    expect(browsePrefixes()).toEqual(['', 'topics/', `topics/${TOPIC_ID}/`]);

    const breadcrumb = screen.getByRole('navigation', { name: d.breadcrumbLabel });
    expect(within(breadcrumb).getByText('9th Kyu')).toHaveAttribute('aria-current', 'page');

    // The breadcrumb navigates back up.
    fireEvent.click(within(breadcrumb).getByRole('button', { name: d.root }));
    await screen.findByRole('button', { name: d.folder.open('topics') });
    expect(browsePrefixes().at(-1)).toBe('');
  });

  it('shows "Load more" only with a nextCursor and sends that cursor', async () => {
    setup((path) => {
      const params = new URL(path, 'http://x').searchParams;
      if (params.get('cursor') === 'c-2') {
        return { prefix: '', folders: [], objects: [orphanObject()] };
      }
      return { prefix: '', folders: [], objects: [mediaObject()], nextCursor: 'c-2' };
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: d.loadMore }));
    expect(await screen.findByRole('button', { name: d.openObject('stray.pdf') })).toBeInTheDocument();
    // Page one stays; page two is appended.
    expect(screen.getByRole('button', { name: d.openObject('a1-kata_final.mp4') })).toBeInTheDocument();
    expect(http).toHaveBeenCalledWith('GET', '/admin/storage/browse?prefix=&cursor=c-2');
    expect(screen.queryByRole('button', { name: d.loadMore })).not.toBeInTheDocument();
  });

  it('renders the empty and error states', async () => {
    setup(() => ({ prefix: '', folders: [], objects: [] }));
    const { unmount } = renderPage();
    expect(await screen.findByText(d.empty)).toBeInTheDocument();
    unmount();

    setup(() => fail(500, 'Boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(d.error);
  });

  describe('object drawer', () => {
    const video = mediaObject();
    const image = flyerObject();
    const pdf = orphanObject();

    beforeEach(() => {
      setup((path) => {
        const url = new URL(path, 'http://x');
        if (url.pathname.endsWith('/object')) {
          const key = url.searchParams.get('key');
          const match = [video, image, pdf].find((o) => o.key === key);
          return match ? detailOf(match) : fail(404, 'NotFound');
        }
        return { prefix: '', folders: [], objects: [video, image, pdf] };
      });
    });

    async function open(name: string) {
      renderPage();
      const row = await screen.findByRole('button', { name: d.openObject(name) });
      // jsdom does not move focus on click the way a browser does.
      row.focus();
      fireEvent.click(row);
      return screen.findByRole('dialog');
    }

    it('requests /object and shows the key, references and a video preview', async () => {
      const dialog = await open(video.name);
      await within(dialog).findByText(d.reference.kind.media);
      expect(http).toHaveBeenCalledWith(
        'GET',
        `/admin/storage/object?key=${encodeURIComponent(video.key)}`,
      );
      expect(within(dialog).getAllByText(video.key).length).toBeGreaterThan(0);
      expect(within(dialog).getByText('kata_final.mp4')).toBeInTheDocument();
      expect(within(dialog).getByText('Ana')).toBeInTheDocument();
      const player = dialog.querySelector('video');
      expect(player).toHaveAttribute('src', detailOf(video).downloadUrl);
      expect(player).toHaveAttribute('controls');
    });

    it('previews an image from the presigned URL', async () => {
      const dialog = await open(image.name);
      const img = await within(dialog).findByRole('img', { name: image.name });
      expect(img).toHaveAttribute('src', detailOf(image).downloadUrl);
      expect(within(dialog).getByText('Summer Seminar')).toBeInTheDocument();
    });

    it('previews a PDF and shows the orphan hint', async () => {
      const dialog = await open(pdf.name);
      const frame = await within(dialog).findByTitle(d.drawer.previewFrameTitle(pdf.name));
      expect(frame).toHaveAttribute('src', detailOf(pdf).downloadUrl);
      expect(within(dialog).getByText(d.hint.ownerTopicGone)).toBeInTheDocument();
      expect(within(dialog).getByText(d.drawer.noReferences)).toBeInTheDocument();
    });

    it('closes on Escape and returns focus to the row', async () => {
      await open(video.name);
      const closeButton = screen.getByRole('button', { name: d.drawer.close });
      await waitFor(() => expect(closeButton).toHaveFocus());

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: d.openObject(video.name) })).toHaveFocus();
    });

    it('traps Tab focus inside the drawer', async () => {
      const dialog = await open(video.name);
      await waitFor(() => expect(dialog.querySelector('video')).not.toBeNull());
      const closeButton = within(dialog).getByRole('button', { name: d.drawer.close });

      // Shift+Tab from the first focusable wraps to the last one inside.
      closeButton.focus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(dialog.querySelector('video'));

      // Tab from the last focusable wraps back to the first.
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(closeButton).toHaveFocus();
    });

    it('reports an object that no longer exists', async () => {
      setup((path) =>
        path.startsWith('/admin/storage/object')
          ? fail(404, 'NotFound')
          : { prefix: '', folders: [], objects: [video] },
      );
      const dialog = await open(video.name);
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(d.drawer.notFound);
    });
  });

  it('redirects a non-admin session and never browses', async () => {
    isAdmin = false;
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(http).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: d.title })).not.toBeInTheDocument();
  });
});
