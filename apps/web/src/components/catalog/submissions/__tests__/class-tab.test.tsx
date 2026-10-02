import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { view } from './fixtures';

const mockClient = {
  submissions: { listClass: vi.fn() },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { ClassTab } from '../ClassTab';

const t = dictPt.submissions;

function shared(id: string, title: string, authorName: string, isMine = false) {
  return view({
    id,
    title,
    authorName,
    authorId: isMine ? 'me' : `u-${id}`,
    isMine,
    visibility: 'shared',
    sharedAt: '2026-09-30 10:00:00',
    url: `https://r2.example/${id}.mp4`,
  });
}

describe('ClassTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists shared submissions with author names, marks the caller’s own as Você, and has no edit actions', async () => {
    mockClient.submissions.listClass.mockResolvedValue({
      data: [shared('a', 'Kata da Ana', 'Ana'), shared('b', 'Meu kata', 'Eu', true)],
      nextCursor: null,
    });
    render(<ClassTab topicId="t1" onGoToMine={vi.fn()} />);

    const list = await screen.findByRole('list', { name: t.class.label });
    const ana = within(list).getByRole('article', { name: 'Kata da Ana' });
    expect(ana).toHaveTextContent('Ana');
    expect(ana).not.toHaveTextContent(t.class.you);
    expect(ana).toHaveTextContent(t.class.sharedOn('2026-09-30 10:00'));
    const mine = within(list).getByRole('article', { name: 'Meu kata' });
    expect(mine).toHaveTextContent(t.class.you);
    expect(screen.queryByRole('button', { name: t.card.edit })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.card.delete })).not.toBeInTheDocument();
    expect(mockClient.submissions.listClass).toHaveBeenCalledWith('t1', null);
  });

  it('shows the empty state with a shortcut to Mine', async () => {
    mockClient.submissions.listClass.mockResolvedValue({ data: [], nextCursor: null });
    const onGoToMine = vi.fn();
    render(<ClassTab topicId="t1" onGoToMine={onGoToMine} />);

    expect(await screen.findByText(t.class.empty)).toBeInTheDocument();
    expect(t.class.empty).toBe('Ninguém da turma compartilhou ainda.');
    fireEvent.click(screen.getByRole('button', { name: t.class.goToMine }));
    expect(onGoToMine).toHaveBeenCalled();
  });

  it('shows the load error with a retry', async () => {
    mockClient.submissions.listClass
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    render(<ClassTab topicId="t1" onGoToMine={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(t.class.loadError);
    fireEvent.click(screen.getByRole('button', { name: t.list.retry }));
    expect(await screen.findByText(t.class.empty)).toBeInTheDocument();
  });

  it('opens a card in the viewer; Next past the last loaded item fetches the next page and shows its first item', async () => {
    mockClient.submissions.listClass
      .mockResolvedValueOnce({ data: [shared('a', 'Primeiro', 'Ana'), shared('b', 'Segundo', 'Bia')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ data: [shared('c', 'Terceiro', 'Caio')], nextCursor: null });
    render(<ClassTab topicId="t1" onGoToMine={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: t.card.open('Primeiro') }));
    expect(screen.getByRole('dialog', { name: t.viewer.label('Primeiro') })).toHaveTextContent(t.viewer.by('Ana'));
    expect(screen.getByRole('button', { name: new RegExp(t.viewer.previous) })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewer.next) }));
    expect(screen.getByRole('dialog', { name: t.viewer.label('Segundo') })).toBeInTheDocument();
    expect(mockClient.submissions.listClass).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewer.next) }));
    await waitFor(() => expect(mockClient.submissions.listClass).toHaveBeenLastCalledWith('t1', 'c2'));
    const third = await screen.findByRole('dialog', { name: t.viewer.label('Terceiro') });
    expect(third).toHaveTextContent(t.viewer.by('Caio'));
    expect(screen.getByRole('button', { name: new RegExp(t.viewer.next) })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewer.previous) }));
    expect(screen.getByRole('dialog', { name: t.viewer.label('Segundo') })).toBeInTheDocument();
  });

  it('reports a failed next page in the viewer and stays on the current item', async () => {
    mockClient.submissions.listClass
      .mockResolvedValueOnce({ data: [shared('a', 'Primeiro', 'Ana')], nextCursor: 'c2' })
      .mockRejectedValueOnce(new Error('offline'));
    render(<ClassTab topicId="t1" onGoToMine={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: t.card.open('Primeiro') }));
    const dialog = screen.getByRole('dialog', { name: t.viewer.label('Primeiro') });
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(t.viewer.next) }));
    expect(await within(dialog).findByText(t.viewer.loadNextError)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: t.viewer.label('Primeiro') })).toBeInTheDocument();
  });
});
