import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import type { AuthoredNote } from '@web/lib/notes-api';

const mockClient = {
  notes: {
    listMine: vi.fn(),
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { MyNotesList, groupNotesByTopic } from '../MyNotesList';

const t = dictPt.notes;

function note(overrides: Partial<AuthoredNote>): AuthoredNote {
  return {
    id: 'n1',
    topicNodeId: 't1',
    authorId: 'me',
    authorName: 'Author Zed',
    body: 'hello',
    visibility: 'private',
    revision: 1,
    sharedAt: null,
    moderated: false,
    createdAt: '2026-09-27 10:00:00',
    updatedAt: '2026-09-28 12:00:00',
    topicTitle: 'Algebra',
    topicAccessible: true,
    ...overrides,
  };
}

describe('groupNotesByTopic', () => {
  it('groups by topic in order of first appearance', () => {
    const groups = groupNotesByTopic([
      note({ id: 'a', topicNodeId: 't2', topicTitle: 'Two' }),
      note({ id: 'b', topicNodeId: 't1', topicTitle: 'One' }),
      note({ id: 'c', topicNodeId: 't2', topicTitle: 'Two' }),
    ]);
    expect(groups.map((g) => g.topicNodeId)).toEqual(['t2', 't1']);
    expect(groups[0].notes.map((n) => n.id)).toEqual(['a', 'c']);
  });
});

describe('MyNotesList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups notes under a topic heading linking to the topic, with badges and last edit', async () => {
    mockClient.notes.listMine.mockResolvedValue({
      data: [
        note({ id: 'n1', topicNodeId: 't1', topicTitle: 'Algebra', visibility: 'shared', body: 'shared one', updatedAt: '2026-09-28 09:15:00' }),
        note({ id: 'n2', topicNodeId: 't2', topicTitle: 'Geometry', visibility: 'private', moderated: true, body: 'moderated one' }),
      ],
      nextCursor: null,
    });

    render(<MyNotesList />);

    const algebra = await screen.findByRole('region', { name: 'Algebra' });
    const link = within(algebra).getByRole('link', { name: 'Algebra' });
    expect(link).toHaveAttribute('href', '/catalog/t1');
    expect(algebra).toHaveTextContent(t.badges.shared);
    expect(algebra).not.toHaveTextContent(t.badges.moderated);
    expect(algebra).toHaveTextContent(t.card.editedOn('2026-09-28 09:15'));
    expect(algebra).toHaveTextContent('shared one');

    const geometry = screen.getByRole('region', { name: 'Geometry' });
    expect(geometry).toHaveTextContent(t.badges.private);
    expect(geometry).toHaveTextContent(t.badges.moderated);
    // The author line is omitted on the caller's own list.
    expect(geometry).not.toHaveTextContent('Author Zed');
  });

  it('shows a note on an inaccessible topic read-only, with the reason and no link', async () => {
    mockClient.notes.listMine.mockResolvedValue({
      data: [note({ topicTitle: 'Locked topic', topicAccessible: false, body: 'still mine' })],
      nextCursor: null,
    });

    render(<MyNotesList />);

    const group = await screen.findByRole('region', { name: 'Locked topic' });
    expect(within(group).queryByRole('link')).not.toBeInTheDocument();
    expect(within(group).getByRole('note')).toHaveTextContent(t.myNotes.inaccessible);
    expect(group).toHaveTextContent('still mine');
    expect(within(group).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('merges groups across pages when loading more', async () => {
    mockClient.notes.listMine
      .mockResolvedValueOnce({ data: [note({ id: 'n1', topicNodeId: 't1', topicTitle: 'Algebra', body: 'page one' })], nextCursor: 'c1' })
      .mockResolvedValueOnce({
        data: [
          note({ id: 'n2', topicNodeId: 't1', topicTitle: 'Algebra', body: 'page two same topic' }),
          note({ id: 'n3', topicNodeId: 't3', topicTitle: 'Calculus', body: 'page two new topic' }),
        ],
        nextCursor: null,
      });

    render(<MyNotesList />);
    fireEvent.click(await screen.findByRole('button', { name: t.myNotes.loadMore }));

    expect(await screen.findByText('page two new topic')).toBeInTheDocument();
    expect(mockClient.notes.listMine).toHaveBeenLastCalledWith('c1');
    expect(screen.getAllByRole('region')).toHaveLength(2);
    const algebra = screen.getByRole('region', { name: 'Algebra' });
    expect(algebra).toHaveTextContent('page one');
    expect(algebra).toHaveTextContent('page two same topic');
  });

  it('shows the empty state', async () => {
    mockClient.notes.listMine.mockResolvedValue({ data: [], nextCursor: null });
    render(<MyNotesList />);
    expect(await screen.findByText(t.myNotes.empty)).toBeInTheDocument();
  });

  it('renders a body containing a script tag inert', async () => {
    mockClient.notes.listMine.mockResolvedValue({
      data: [note({ body: '<script>window.__pwnedMine = true</script>ok' })],
      nextCursor: null,
    });
    const { container } = render(<MyNotesList />);
    await screen.findByRole('region', { name: 'Algebra' });
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwnedMine?: boolean }).__pwnedMine).toBeUndefined();
  });
});
