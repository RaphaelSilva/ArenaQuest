import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { summary, view } from './fixtures';

const mockClient = {
  submissions: {
    listMine: vi.fn(),
    remove: vi.fn(),
    presign: vi.fn(),
    finalize: vi.fn(),
    edit: vi.fn(),
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { MineTab } from '../MineTab';

const t = dictPt.submissions;

describe('MineTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows ready cards with badges, and edit/delete actions', async () => {
    mockClient.submissions.listMine.mockResolvedValue({
      data: [view({ id: 'a', title: 'Kata A', visibility: 'shared' }), view({ id: 'b', title: 'Kata B', moderated: true })],
      nextCursor: null,
    });
    render(<MineTab topicId="t1" summary={summary()} onUsageChanged={vi.fn()} />);

    const a = await screen.findByRole('article', { name: 'Kata A' });
    expect(a).toHaveTextContent(t.badges.shared);
    expect(within(a).getByRole('button', { name: t.card.edit })).toBeInTheDocument();
    expect(within(a).getByRole('button', { name: t.card.delete })).toBeInTheDocument();
    const b = screen.getByRole('article', { name: 'Kata B' });
    expect(b).toHaveTextContent(t.badges.private);
    expect(b).toHaveTextContent(t.badges.moderated);
    expect(mockClient.submissions.listMine).toHaveBeenCalledWith('t1', null);
  });

  it('renders an interrupted upload with Discard, which deletes the pending row', async () => {
    mockClient.submissions.listMine
      .mockResolvedValueOnce({ data: [view({ id: 'p', title: 'Half', status: 'pending', url: null })], nextCursor: null })
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    mockClient.submissions.remove.mockResolvedValue(undefined);
    const onUsageChanged = vi.fn();
    render(<MineTab topicId="t1" summary={summary()} onUsageChanged={onUsageChanged} />);

    const card = await screen.findByRole('article', { name: 'Half' });
    expect(card).toHaveTextContent(t.interrupted.label);
    expect(within(card).queryByRole('button', { name: t.card.edit })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: t.interrupted.discard }));

    await waitFor(() => expect(mockClient.submissions.remove).toHaveBeenCalledWith('t1', 'p'));
    expect(await screen.findByText(t.list.empty)).toBeInTheDocument();
    expect(onUsageChanged).toHaveBeenCalled();
  });

  it('renders a tombstone as "Removido pela equipe" with only Dismiss', async () => {
    mockClient.submissions.listMine.mockResolvedValue({
      data: [view({ id: 'r', title: 'Gone', status: 'removed', url: null, removedAt: '2026-09-30 10:00:00' })],
      nextCursor: null,
    });
    mockClient.submissions.remove.mockResolvedValue(undefined);
    render(<MineTab topicId="t1" summary={summary()} onUsageChanged={vi.fn()} />);

    const card = await screen.findByRole('article', { name: t.tombstone.label });
    expect(card).toHaveTextContent(t.tombstone.label);
    const buttons = within(card).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(t.tombstone.dismiss);

    fireEvent.click(buttons[0]);
    await waitFor(() => expect(mockClient.submissions.remove).toHaveBeenCalledWith('t1', 'r'));
  });

  it('deletes a ready card only after confirmation', async () => {
    mockClient.submissions.listMine.mockResolvedValue({ data: [view({ id: 'a', title: 'Kata A' })], nextCursor: null });
    mockClient.submissions.remove.mockResolvedValue(undefined);
    render(<MineTab topicId="t1" summary={summary()} onUsageChanged={vi.fn()} />);

    const card = await screen.findByRole('article', { name: 'Kata A' });
    fireEvent.click(within(card).getByRole('button', { name: t.card.delete }));
    expect(card).toHaveTextContent(t.delete.confirm);
    expect(mockClient.submissions.remove).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: t.delete.confirmAction }));
    await waitFor(() => expect(mockClient.submissions.remove).toHaveBeenCalledWith('t1', 'a'));
  });

  it('shows the new card at the top after a successful upload', async () => {
    mockClient.submissions.listMine
      .mockResolvedValueOnce({ data: [view({ id: 'old', title: 'Old one' })], nextCursor: null })
      .mockResolvedValueOnce({
        data: [view({ id: 'new', title: 'clip' }), view({ id: 'old', title: 'Old one' })],
        nextCursor: null,
      });
    mockClient.submissions.presign.mockResolvedValue({
      submission: view({ id: 'new', status: 'pending', url: null }),
      uploadUrl: 'https://r2.example/put',
      expiresAt: '',
    });
    mockClient.submissions.finalize.mockResolvedValue(view({ id: 'new' }));
    const upload = vi.fn().mockResolvedValue(undefined);
    const onUsageChanged = vi.fn();

    render(<MineTab topicId="t1" summary={summary()} onUsageChanged={onUsageChanged} upload={upload} />);
    await screen.findByRole('article', { name: 'Old one' });

    fireEvent.click(screen.getByRole('button', { name: t.upload.open }));
    fireEvent.change(screen.getByLabelText(t.upload.fileLabel), {
      target: { files: [new File(['data'], 'clip.mp4', { type: 'video/mp4' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));

    expect(await screen.findByRole('status')).toHaveTextContent(t.upload.success);
    const list = await screen.findByRole('list', { name: t.list.label });
    await waitFor(() => expect(within(list).getAllByRole('article')[0]).toHaveAccessibleName('clip'));
    expect(onUsageChanged).toHaveBeenCalled();
  });

  it('opens a ready submission in the existing viewer', async () => {
    mockClient.submissions.listMine.mockResolvedValue({
      data: [view({ id: 'a', title: 'Kata A', contentType: 'application/pdf', originalName: 'kata.pdf' })],
      nextCursor: null,
    });
    render(<MineTab topicId="t1" summary={summary()} onUsageChanged={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: t.card.open('Kata A') }));
    const dialog = screen.getByRole('dialog', { name: t.viewer.label('Kata A') });
    expect(within(dialog).getByText('kata.pdf')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: t.viewer.close }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
