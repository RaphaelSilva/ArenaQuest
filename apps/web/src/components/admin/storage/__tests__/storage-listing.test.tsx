import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { ClassifiedObject } from '@web/lib/admin-storage-api';
import { StorageListing } from '../storage-listing';
import { EVENT_ID, flyerObject, mediaObject, orphanObject } from './fixtures';

const d = dictEn.adminStorage;

function renderListing(objects: ClassifiedObject[], hasMore = false) {
  return render(
    <DictProvider value={dictEn}>
      <StorageListing
        folders={[]}
        objects={objects}
        status="ready"
        loadingMore={false}
        hasMore={hasMore}
        selectedKey={null}
        onOpenFolder={vi.fn()}
        onSelectObject={vi.fn()}
        onLoadMore={vi.fn()}
        onRetry={vi.fn()}
      />
    </DictProvider>,
  );
}

function rowOf(name: string): HTMLElement {
  return screen.getByRole('button', { name: d.openObject(name) }).closest('li')!;
}

describe('StorageListing', () => {
  it('shows name, size, date and one badge per status', () => {
    renderListing([
      mediaObject({ key: 'k/linked.mp4', status: 'linked' }),
      mediaObject({ key: 'k/pending.mp4', status: 'pending', stale: false }),
      mediaObject({ key: 'k/stale.mp4', status: 'pending', stale: true }),
      mediaObject({ key: 'k/displaced.png', status: 'displaced' }),
      mediaObject({ key: 'k/deleted.mp4', status: 'deleted-row' }),
      orphanObject({ key: 'k/orphan.pdf', name: 'orphan.pdf' }),
    ]);

    const linked = rowOf('linked.mp4');
    expect(within(linked).getByText('2.0 MB')).toBeInTheDocument();
    expect(within(linked).getByText('2026-09-29 12:00 UTC')).toBeInTheDocument();
    expect(within(linked).getByText(d.status.linked)).toHaveAttribute('data-status', 'linked');

    expect(within(rowOf('pending.mp4')).getByText(d.status.pending)).not.toHaveAttribute('data-stale');
    expect(within(rowOf('displaced.png')).getByText(d.status.displaced)).toBeInTheDocument();
    expect(within(rowOf('deleted.mp4')).getByText(d.status.deletedRow)).toBeInTheDocument();
    expect(within(rowOf('orphan.pdf')).getByText(d.status.orphan)).toBeInTheDocument();
  });

  it('renders a stale pending apart from a fresh one', () => {
    renderListing([
      mediaObject({ key: 'k/pending.mp4', status: 'pending', stale: false }),
      mediaObject({ key: 'k/stale.mp4', status: 'pending', stale: true }),
    ]);
    const fresh = within(rowOf('pending.mp4')).getByText(d.status.pending);
    const stale = within(rowOf('stale.mp4')).getByText(d.status.stalePending);

    expect(stale).toHaveAttribute('data-stale', 'true');
    expect(stale).toHaveAttribute('title', d.staleHint);
    // A different tone on the badge itself, not only a different label.
    expect(stale.parentElement!.className).not.toBe(fresh.parentElement!.className);
  });

  it('links the owner: topic media to /admin/topics, a flyer to its event', () => {
    renderListing([mediaObject(), flyerObject(), orphanObject()]);

    const media = rowOf('a1-kata_final.mp4');
    expect(within(media).getByRole('link', { name: '9th Kyu' })).toHaveAttribute('href', '/admin/topics');
    expect(within(media).getByText(/kata_final\.mp4 · uploaded by Ana/)).toBeInTheDocument();

    expect(within(rowOf('flyer.png')).getByRole('link', { name: 'Summer Seminar' })).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_ID}`,
    );
    expect(within(rowOf('stray.pdf')).getByText(d.owner.none)).toBeInTheDocument();
  });

  it('hides "Load more" without a cursor', () => {
    const { unmount } = renderListing([mediaObject()], false);
    expect(screen.queryByRole('button', { name: d.loadMore })).not.toBeInTheDocument();
    unmount();

    renderListing([mediaObject()], true);
    expect(screen.getByRole('button', { name: d.loadMore })).toBeInTheDocument();
  });
});
