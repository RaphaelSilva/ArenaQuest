import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import type { AuthoredSubmission } from '@web/lib/submissions-api';
import { summary, view } from './fixtures';

const mockClient = {
  topics: { list: vi.fn() },
  submissions: {
    listMyAll: vi.fn(),
    summary: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    edit: vi.fn(),
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { MySubmissionsList } from '../MySubmissionsList';

const t = dictPt.submissions;

function row(overrides: Partial<AuthoredSubmission> & { topicTitle: string; topicAccessible: boolean }): AuthoredSubmission {
  const { isMine: _isMine, ...base } = view(overrides);
  void _isMine;
  return { ...base, ...overrides };
}

const kihonA = row({ id: 'a', title: 'Kihon A', topicNodeId: 't1', topicTitle: 'Kihon', topicAccessible: true });
const kataB = row({ id: 'b', title: 'Kata B', topicNodeId: 't2', topicTitle: 'Kata', topicAccessible: true });
const kihonC = row({ id: 'c', title: 'Kihon C', topicNodeId: 't1', topicTitle: 'Kihon', topicAccessible: true });
const lostD = row({ id: 'd', title: 'Lost D', topicNodeId: 't9', topicTitle: 'Gone topic', topicAccessible: false });

describe('MySubmissionsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups every submission by topic, linking each topic to its Demonstrations page', async () => {
    mockClient.submissions.listMyAll.mockResolvedValue({ data: [kihonA, kataB, kihonC], nextCursor: null });
    render(<MySubmissionsList />);

    const kihon = await screen.findByRole('region', { name: 'Kihon' });
    expect(within(kihon).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Kihon A', 'Kihon C']);
    expect(within(kihon).getByRole('link', { name: 'Kihon' })).toHaveAttribute(
      'href',
      '/catalog/t1/submissions',
    );
    const kata = screen.getByRole('region', { name: 'Kata' });
    expect(within(kata).getByRole('article', { name: 'Kata B' })).toBeInTheDocument();
    expect(mockClient.submissions.listMyAll).toHaveBeenCalledWith(null);

    // Accessible rows keep the full set of actions and no read-only note.
    const card = within(kihon).getByRole('article', { name: 'Kihon A' });
    expect(within(card).getByRole('button', { name: t.card.edit })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: t.card.move })).toBeInTheDocument();
    expect(within(card).queryByRole('note')).not.toBeInTheDocument();
  });

  it('explains a row on a lost topic is read-only, with no link or edit, but still offers delete and move', async () => {
    mockClient.submissions.listMyAll.mockResolvedValue({ data: [lostD], nextCursor: null });
    mockClient.topics.list.mockResolvedValue([{ id: 't1', title: 'Kihon', parentId: null, order: 1 }]);
    mockClient.submissions.summary.mockResolvedValue(summary({ usage: { topicCount: 0, bytes: 0 } }));
    mockClient.submissions.move.mockResolvedValue({ moved: [view({ id: 'd', topicNodeId: 't1' })], refused: [] });
    render(<MySubmissionsList />);

    const group = await screen.findByRole('region', { name: 'Gone topic' });
    expect(within(group).queryByRole('link')).not.toBeInTheDocument();
    const card = within(group).getByRole('article', { name: 'Lost D' });
    expect(within(card).getByRole('note')).toHaveTextContent(t.myDemonstrations.inaccessible);
    expect(within(card).queryByRole('button', { name: t.card.edit })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: t.card.delete })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: t.card.move }));
    const dialog = screen.getByRole('dialog', { name: t.move.heading(1) });
    fireEvent.click(await within(dialog).findByRole('radio', { name: /^Kihon / }));
    fireEvent.click(within(dialog).getByRole('button', { name: t.move.submit }));
    await waitFor(() => expect(mockClient.submissions.move).toHaveBeenCalledWith(['d'], 't1'));
    // The list is re-read so the rescued row shows under its new topic.
    await waitFor(() => expect(mockClient.submissions.listMyAll).toHaveBeenCalledTimes(2));
  });

  it('deletes a row on a lost topic through its own topic id', async () => {
    mockClient.submissions.listMyAll
      .mockResolvedValueOnce({ data: [lostD], nextCursor: null })
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    mockClient.submissions.remove.mockResolvedValue(undefined);
    render(<MySubmissionsList />);

    const card = await screen.findByRole('article', { name: 'Lost D' });
    fireEvent.click(within(card).getByRole('button', { name: t.card.delete }));
    fireEvent.click(within(card).getByRole('button', { name: t.delete.confirmAction }));
    await waitFor(() => expect(mockClient.submissions.remove).toHaveBeenCalledWith('t9', 'd'));
    expect(await screen.findByText(t.myDemonstrations.empty)).toBeInTheDocument();
  });

  it('opens the editor with the topic’s sharing switch read from its summary', async () => {
    mockClient.submissions.listMyAll.mockResolvedValue({ data: [kihonA], nextCursor: null });
    mockClient.submissions.summary.mockResolvedValue(summary({ sharingEnabled: false }));
    render(<MySubmissionsList />);

    fireEvent.click(await screen.findByRole('button', { name: t.card.edit }));
    const dialog = await screen.findByRole('dialog', { name: t.edit.heading });
    expect(mockClient.submissions.summary).toHaveBeenCalledWith('t1');
    expect(within(dialog).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(t.visibility.label)).not.toBeInTheDocument();
  });

  it('shows the empty state, and the error state with a retry', async () => {
    mockClient.submissions.listMyAll
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    render(<MySubmissionsList />);

    expect(await screen.findByText(t.myDemonstrations.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: dictPt.common.retry }));
    expect(await screen.findByText(t.myDemonstrations.empty)).toBeInTheDocument();
  });
});
