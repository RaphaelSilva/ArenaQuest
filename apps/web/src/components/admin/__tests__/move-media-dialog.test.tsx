import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n';
import { DictProvider } from '@web/context/dict-context';
import { AdminMediaApiError, type Media } from '@web/lib/admin-media-api';
import type { TopicNode } from '@web/lib/admin-topics-api';

const mockAdminMedia = vi.hoisted(() => ({ move: vi.fn(), delete: vi.fn() }));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => ({ adminMedia: mockAdminMedia }) };
});

import { MoveMediaDialog, mediaMoveTargets } from '../MoveMediaDialog';
import { MediaList } from '../MediaList';

const t = dictPt.admin.topics.media.move;
const list = dictPt.admin.topics.media.list;

function topic(id: string, title: string, parentId: string | null = null, order = 0, extra: Partial<TopicNode> = {}): TopicNode {
  return { id, title, parentId, order, status: 'published', archived: false, ...extra } as TopicNode;
}

/** `t1` is the open topic; `t4` is archived. */
const tree = [
  topic('t1', 'Kihon', null, 1),
  topic('t2', 'Kata', null, 2),
  topic('t3', 'Heian Shodan', 't2', 1),
  topic('t4', 'Old', null, 3, { archived: true, status: 'archived' }),
];

function media(id: string, status: Media['status'], name = `${id}.mp4`): Media {
  return {
    id,
    topicNodeId: 't1',
    url: '',
    type: 'video/mp4',
    storageKey: `topics/t1/${id}`,
    sizeBytes: 1024,
    originalName: name,
    uploadedById: 'u1',
    status,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

function renderDialog(overrides: Partial<Parameters<typeof MoveMediaDialog>[0]> = {}) {
  const props = {
    topicId: 't1',
    media: { id: 'm1', originalName: 'kata.mp4' },
    topics: tree,
    onMoved: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <DictProvider value={dictPt}>
      <MoveMediaDialog {...props} />
    </DictProvider>,
  );
  return props;
}

describe('mediaMoveTargets', () => {
  it('orders the tree depth-first, drops archived topics and excludes the current one', () => {
    expect(mediaMoveTargets(tree, 't1')).toEqual([
      { id: 't2', title: 'Kata', depth: 0 },
      { id: 't3', title: 'Heian Shodan', depth: 1 },
    ]);
  });

  it('keeps a topic whose parent is missing, as a root', () => {
    expect(mediaMoveTargets([topic('c', 'Child', 'gone')], 't1')).toEqual([{ id: 'c', title: 'Child', depth: 0 }]);
  });
});

describe('MoveMediaDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a labelled modal that starts on Cancel and lists only valid targets', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: t.heading });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: t.cancel })).toHaveFocus();
    expect(screen.getByText(t.itemLabel('kata.mp4'))).toBeInTheDocument();

    const options = within(dialog).getAllByRole('radio');
    expect(options.map((o) => (o as HTMLInputElement).value)).toEqual(['t2', 't3']);
    expect(screen.queryByRole('radio', { name: 'Kihon' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Old' })).toBeNull();
  });

  it('keeps confirm disabled until a target is chosen, then sends the chosen target', async () => {
    mockAdminMedia.move.mockResolvedValue(media('m1', 'ready'));
    const props = renderDialog();
    const confirm = screen.getByRole('button', { name: t.confirm });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Heian Shodan' }));
    expect(screen.getByText(t.destination('Heian Shodan'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.confirm }));

    await waitFor(() => expect(props.onMoved).toHaveBeenCalledWith('Heian Shodan'));
    expect(mockAdminMedia.move).toHaveBeenCalledWith('t1', 'm1', 't3');
  });

  it('cancel and Escape close without sending anything', () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Kata' }));
    fireEvent.click(screen.getByRole('button', { name: t.cancel }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(mockAdminMedia.move).not.toHaveBeenCalled();
  });

  it('keeps focus inside the dialog on Tab and Shift+Tab', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const cancel = screen.getByRole('button', { name: t.cancel });
    const firstRadio = screen.getByRole('radio', { name: 'Kata' });

    // Confirm is disabled, so Cancel is the last focusable element: Tab wraps to the first.
    cancel.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(firstRadio).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it.each([
    [409, 'MediaNotReady', 'only ready media can be moved', t.errors.notReady],
    [404, 'NotFound', undefined, t.errors.mediaGone],
    [403, 'Forbidden', undefined, t.errors.forbidden],
    [400, 'SameTopic', 'target topic equals the current topic', t.errors.sameTopic],
    [500, 'InternalError', undefined, t.errors.generic],
  ])('on %s stays open and shows the matching message', async (status, code, detail, message) => {
    mockAdminMedia.move.mockRejectedValue(new AdminMediaApiError(status, code, detail));
    const props = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Kata' }));
    fireEvent.click(screen.getByRole('button', { name: t.confirm }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(props.onMoved).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('on a 404 for the target drops it from the picker and asks for another one', async () => {
    mockAdminMedia.move.mockRejectedValue(new AdminMediaApiError(404, 'NotFound', 'target topic not found'));
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Kata' }));
    fireEvent.click(screen.getByRole('button', { name: t.confirm }));

    expect(await screen.findByText(t.errors.targetGone)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Kata' })).toBeNull();
    expect(screen.getByRole('button', { name: t.confirm })).toBeDisabled();
  });

  it('says so when there is no other topic', () => {
    renderDialog({ topics: [topic('t1', 'Kihon')] });
    expect(screen.getByText(t.noTargets)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.confirm })).toBeDisabled();
  });
});

describe('MediaList move action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderList(onMediaMoved = vi.fn()) {
    render(
      <DictProvider value={dictPt}>
        <MediaList
          topicId="t1"
          media={[media('ready1', 'ready', 'ready.mp4'), media('pending1', 'pending', 'pending.mp4')]}
          onMediaDeleted={vi.fn()}
          topics={tree}
          onMediaMoved={onMediaMoved}
        />
      </DictProvider>,
    );
    return onMediaMoved;
  }

  it('offers "Move to…" only on ready items', () => {
    renderList();
    const items = screen.getAllByRole('listitem');
    const ready = items.find((li) => within(li).queryByText('ready.mp4'))!;
    const pending = items.find((li) => within(li).queryByText('pending.mp4'))!;
    expect(within(ready).getByRole('button', { name: list.moveTo })).toBeInTheDocument();
    expect(within(pending).queryByRole('button', { name: list.moveTo })).toBeNull();
  });

  it('opens the dialog for the item and reports the destination after a move', async () => {
    mockAdminMedia.move.mockResolvedValue(media('ready1', 'ready'));
    const onMediaMoved = renderList();
    fireEvent.click(screen.getByRole('button', { name: list.moveTo }));

    const dialog = screen.getByRole('dialog', { name: t.heading });
    expect(within(dialog).getByText(t.itemLabel('ready.mp4'))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Kata' }));
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirm }));

    await waitFor(() => expect(onMediaMoved).toHaveBeenCalledWith('Kata'));
    expect(mockAdminMedia.move).toHaveBeenCalledWith('t1', 'ready1', 't2');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
