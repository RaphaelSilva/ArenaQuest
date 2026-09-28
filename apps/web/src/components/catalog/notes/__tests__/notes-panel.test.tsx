import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';

const mockClient = {
  notes: {
    getMine: vi.fn().mockResolvedValue(null),
    saveMine: vi.fn(),
    deleteMine: vi.fn(),
    listForTopic: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { NotesPanel } from '../NotesPanel';

const t = dictPt.notes;

describe('NotesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.notes.getMine.mockResolvedValue(null);
    mockClient.notes.listForTopic.mockResolvedValue({ data: [], nextCursor: null });
  });

  it('opens on My note with an accessible tablist', async () => {
    render(<NotesPanel topicId="t1" />);

    expect(screen.getByRole('tablist', { name: t.tabsLabel })).toBeInTheDocument();
    const mine = screen.getByRole('tab', { name: t.tabMine });
    expect(mine).toHaveAttribute('aria-selected', 'true');
    expect(mine).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('tab', { name: t.tabClass })).toHaveAttribute('tabIndex', '-1');
    expect(await screen.findByLabelText(t.editorLabel)).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys and shows the class notes list by default', async () => {
    render(<NotesPanel topicId="t1" />);
    await screen.findByLabelText(t.editorLabel);

    const mine = screen.getByRole('tab', { name: t.tabMine });
    mine.focus();
    fireEvent.keyDown(mine, { key: 'ArrowRight' });

    const cls = screen.getByRole('tab', { name: t.tabClass });
    expect(cls).toHaveAttribute('aria-selected', 'true');
    expect(cls).toHaveFocus();
    expect(await screen.findByText(t.classList.empty)).toBeInTheDocument();
    expect(mockClient.notes.listForTopic).toHaveBeenCalledWith('t1', null);

    fireEvent.keyDown(cls, { key: 'ArrowLeft' });
    expect(mine).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the classNotes slot in the Class notes tab', async () => {
    render(<NotesPanel topicId="t1" classNotes={<p>slot content</p>} />);
    await screen.findByLabelText(t.editorLabel);
    fireEvent.click(screen.getByRole('tab', { name: t.tabClass }));

    expect(screen.getByText('slot content')).toBeInTheDocument();
    expect(mockClient.notes.listForTopic).not.toHaveBeenCalled();
  });
});
