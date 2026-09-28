import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import type { ClassNote } from '@web/lib/notes-api';

const mockClient = {
  notes: {
    listForTopic: vi.fn(),
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { ClassNotesList } from '../ClassNotesList';

const t = dictPt.notes;

function note(overrides: Partial<ClassNote>): ClassNote {
  return {
    id: 'n1',
    topicNodeId: 't1',
    authorId: 'a',
    authorName: 'Ana',
    body: 'hello',
    visibility: 'shared',
    revision: 1,
    sharedAt: '2026-09-28 12:00:00',
    moderated: false,
    createdAt: '2026-09-27 10:00:00',
    updatedAt: '2026-09-28 12:00:00',
    isMine: false,
    ...overrides,
  };
}

describe('ClassNotesList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the notes in the order returned, with author, shared date and a yours marker', async () => {
    mockClient.notes.listForTopic.mockResolvedValue({
      data: [
        note({ id: 'n2', authorName: 'Bruno', body: 'newest', sharedAt: '2026-09-28 15:30:00', isMine: true }),
        note({ id: 'n1', authorName: 'Ana', body: 'older', sharedAt: '2026-09-20 08:00:00' }),
      ],
      nextCursor: null,
    });

    render(<ClassNotesList topicId="t1" />);

    const list = await screen.findByRole('list', { name: t.classList.label });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Bruno');
    expect(items[0]).toHaveTextContent('newest');
    expect(items[0]).toHaveTextContent(t.card.yours);
    expect(items[0]).toHaveTextContent(t.card.sharedOn('2026-09-28 15:30'));
    expect(items[1]).toHaveTextContent('Ana');
    expect(items[1]).not.toHaveTextContent(t.card.yours);
    expect(screen.queryByRole('button', { name: t.classList.loadMore })).not.toBeInTheDocument();
    expect(mockClient.notes.listForTopic).toHaveBeenCalledWith('t1', null);
  });

  it('loads the next page with the cursor and appends it', async () => {
    mockClient.notes.listForTopic
      .mockResolvedValueOnce({ data: [note({ id: 'n1', body: 'first page' })], nextCursor: 'cur/1' })
      .mockResolvedValueOnce({ data: [note({ id: 'n2', body: 'second page' })], nextCursor: null });

    render(<ClassNotesList topicId="t1" />);

    fireEvent.click(await screen.findByRole('button', { name: t.classList.loadMore }));

    expect(await screen.findByText('second page')).toBeInTheDocument();
    expect(screen.getByText('first page')).toBeInTheDocument();
    expect(mockClient.notes.listForTopic).toHaveBeenLastCalledWith('t1', 'cur/1');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t.classList.loadMore })).not.toBeInTheDocument(),
    );
  });

  it('shows an empty state inviting the student to share', async () => {
    mockClient.notes.listForTopic.mockResolvedValue({ data: [], nextCursor: null });
    render(<ClassNotesList topicId="t1" />);

    expect(await screen.findByText(t.classList.empty)).toBeInTheDocument();
    expect(screen.getByText(t.classList.emptyHint)).toBeInTheDocument();
  });

  it('shows an error with a retry that reloads', async () => {
    mockClient.notes.listForTopic
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: [note({ body: 'recovered' })], nextCursor: null });
    render(<ClassNotesList topicId="t1" />);

    expect(await screen.findByText(t.classList.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: dictPt.common.retry }));
    expect(await screen.findByText('recovered')).toBeInTheDocument();
  });

  it('renders a body containing a script tag inert', async () => {
    mockClient.notes.listForTopic.mockResolvedValue({
      data: [note({ body: 'safe <script>window.__pwned = true</script> text' })],
      nextCursor: null,
    });
    const { container } = render(<ClassNotesList topicId="t1" />);

    await screen.findByRole('list', { name: t.classList.label });
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('lets a caller decorate cards with badges and actions', async () => {
    mockClient.notes.listForTopic.mockResolvedValue({ data: [note({})], nextCursor: null });
    render(
      <ClassNotesList
        topicId="t1"
        renderBadges={(n) => <span>badge-{n.id}</span>}
        renderActions={(n) => <button type="button">act-{n.id}</button>}
      />,
    );

    expect(await screen.findByText('badge-n1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'act-n1' })).toBeInTheDocument();
  });
});
