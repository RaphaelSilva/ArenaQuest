import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import type { Note, SaveNoteInput, SaveNoteResult } from '@web/lib/notes-api';

const mockGetMine = vi.fn();
const mockSaveMine = vi.fn();
const mockDeleteMine = vi.fn();

// Stable client reference: the hook's load effect depends on `client`.
const mockClient = {
  notes: {
    getMine: (...args: unknown[]) => mockGetMine(...args),
    saveMine: (...args: unknown[]) => mockSaveMine(...args),
    deleteMine: (...args: unknown[]) => mockDeleteMine(...args),
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { MyNoteEditor } from '../MyNoteEditor';

const t = dictPt.notes;
const DEBOUNCE = 2000;

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    topicNodeId: 't1',
    authorId: 'me',
    authorName: 'Test User',
    body: 'old text',
    visibility: 'private',
    revision: 3,
    sharedAt: null,
    moderated: false,
    createdAt: '2026-09-28 12:00:00',
    updatedAt: '2026-09-28 12:00:00',
    ...overrides,
  };
}

const saved = (note: Note, created = false): SaveNoteResult => ({ kind: 'saved', note, created });

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Loads with real timers (RTL `findBy*` polls on them), then freezes the clock:
 * from here on only `advance()` moves time, so debounce assertions are exact
 * however slow the run is. `shouldAdvanceTime` is deliberately not used — it
 * lets wall-clock time leak into the fake clock and fire the debounce early.
 */
function freezeClock() {
  vi.useFakeTimers();
}

async function renderEditor() {
  render(<MyNoteEditor topicId="t1" />);
  const textarea = await screen.findByLabelText(t.editorLabel);
  freezeClock();
  return textarea;
}

function type(textarea: HTMLElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

const writeText = vi.fn();

describe('MyNoteEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('autosaves once after the debounce with the held revision, saving → saved', async () => {
    mockGetMine.mockResolvedValue(makeNote());
    let resolveSave!: (r: SaveNoteResult) => void;
    mockSaveMine.mockImplementationOnce(() => new Promise((r) => { resolveSave = r; }));

    const textarea = await renderEditor();
    expect(textarea).toHaveValue('old text');

    type(textarea, 'new');
    type(textarea, 'new text');
    await advance(DEBOUNCE - 1);
    expect(mockSaveMine).not.toHaveBeenCalled();

    await advance(1);
    expect(mockSaveMine).toHaveBeenCalledTimes(1);
    expect(mockSaveMine).toHaveBeenCalledWith('t1', { body: 'new text', baseRevision: 3 });
    expect(screen.getByText(t.saveState.saving)).toBeInTheDocument();

    await act(async () => resolveSave(saved(makeNote({ body: 'new text', revision: 4 }))));
    expect(screen.getByText(t.saveState.saved)).toBeInTheDocument();

    // The next save carries the revision the response returned.
    mockSaveMine.mockResolvedValueOnce(saved(makeNote({ body: 'newer', revision: 5 })));
    type(textarea, 'newer');
    await advance(DEBOUNCE);
    expect(mockSaveMine).toHaveBeenLastCalledWith('t1', { body: 'newer', baseRevision: 4 });
  });

  it('sends revision 0 for a first note and never autosaves an empty body', async () => {
    mockGetMine.mockResolvedValue(null);
    mockSaveMine.mockResolvedValue(saved(makeNote({ body: 'hi', revision: 1 }), true));

    const textarea = await renderEditor();
    type(textarea, '   ');
    await advance(DEBOUNCE * 2);
    expect(mockSaveMine).not.toHaveBeenCalled();

    type(textarea, 'hi');
    await advance(DEBOUNCE);
    expect(mockSaveMine).toHaveBeenCalledWith('t1', { body: 'hi', baseRevision: 0 });
  });

  it('shows the counter against NOTE_BODY_MAX and refuses to save over the limit', async () => {
    const { NOTE_BODY_MAX } = await import('@arenaquest/shared/domain/notes/limits');
    mockGetMine.mockResolvedValue(null);

    const textarea = await renderEditor();
    expect(screen.getByText(t.counter(0, NOTE_BODY_MAX))).toBeInTheDocument();

    type(textarea, 'x'.repeat(NOTE_BODY_MAX + 1));
    await advance(DEBOUNCE);
    expect(mockSaveMine).not.toHaveBeenCalled();
    expect(screen.getByText(t.overLimit(NOTE_BODY_MAX))).toBeInTheDocument();
    expect(screen.getByText(t.saveState.overLimit)).toBeInTheDocument();
  });

  describe('on 409 NOTE_STALE', () => {
    const latest = makeNote({ body: 'from the other tab', revision: 7 });

    async function reachConflict(current: Note | null) {
      mockGetMine.mockResolvedValue(makeNote());
      mockSaveMine.mockResolvedValueOnce({ kind: 'stale', current });
      const textarea = await renderEditor();
      type(textarea, 'my local text');
      await advance(DEBOUNCE);
      return textarea;
    }

    it('pauses autosave and shows the banner', async () => {
      const textarea = await reachConflict(latest);

      expect(screen.getByText(t.conflict.stale)).toBeInTheDocument();
      expect(screen.getByText(t.saveState.conflict)).toBeInTheDocument();

      type(textarea, 'my local text, continued');
      await advance(DEBOUNCE * 3);
      expect(mockSaveMine).toHaveBeenCalledTimes(1);
      expect(textarea).toHaveValue('my local text, continued');
    });

    it('Load latest replaces the text, holds the new revision and copies the unsaved text', async () => {
      const textarea = await reachConflict(latest);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: t.conflict.loadLatest }));
      });

      expect(writeText).toHaveBeenCalledWith('my local text');
      expect(textarea).toHaveValue('from the other tab');
      expect(screen.queryByText(t.conflict.stale)).not.toBeInTheDocument();
      expect(screen.getByText(t.conflict.copied)).toBeInTheDocument();

      // Autosave resumes on the loaded revision.
      mockSaveMine.mockResolvedValueOnce(saved(makeNote({ revision: 8 })));
      type(textarea, 'from the other tab, edited');
      await advance(DEBOUNCE);
      expect(mockSaveMine).toHaveBeenLastCalledWith('t1', {
        body: 'from the other tab, edited',
        baseRevision: 7,
      });
    });

    it('Keep mine re-sends the local text on the current revision', async () => {
      await reachConflict(latest);
      mockSaveMine.mockResolvedValueOnce(saved(makeNote({ body: 'my local text', revision: 8 })));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: t.conflict.keepMine }));
      });

      expect(mockSaveMine).toHaveBeenLastCalledWith('t1', { body: 'my local text', baseRevision: 7 });
      expect(screen.queryByText(t.conflict.stale)).not.toBeInTheDocument();
      expect(screen.getByText(t.saveState.saved)).toBeInTheDocument();
    });

    it('offers Recreate / Discard when the note was deleted elsewhere', async () => {
      await reachConflict(null);

      expect(screen.getByText(t.conflict.deleted)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t.conflict.loadLatest })).not.toBeInTheDocument();

      mockSaveMine.mockResolvedValueOnce(saved(makeNote({ body: 'my local text', revision: 1 }), true));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: t.conflict.recreate }));
      });
      expect(mockSaveMine).toHaveBeenLastCalledWith('t1', { body: 'my local text', baseRevision: 0 });
    });

    it('Discard clears the editor to the empty state', async () => {
      const textarea = await reachConflict(null);

      fireEvent.click(screen.getByRole('button', { name: t.conflict.discard }));

      expect(textarea).toHaveValue('');
      expect(screen.queryByText(t.conflict.deleted)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t.delete.action })).not.toBeInTheDocument();
    });

    it('shows the moderation banner when the stored note is moderated', async () => {
      await reachConflict(makeNote({ revision: 7, moderated: true }));
      expect(screen.getByText(t.moderated)).toBeInTheDocument();
    });
  });

  it('shows the audience line naming staff and requires confirmation to share', async () => {
    mockGetMine.mockResolvedValue(makeNote());
    mockSaveMine.mockResolvedValue(saved(makeNote({ visibility: 'shared', revision: 4 })));
    await renderEditor();

    expect(screen.getByText(t.visibility.audiencePrivate)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: t.visibility.label });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(screen.getByText(t.visibility.confirmShare)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.visibility.cancel }));
    expect(mockSaveMine).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.visibility.confirm }));
    });
    expect(mockSaveMine).toHaveBeenCalledWith('t1', { body: 'old text', visibility: 'shared', baseRevision: 3 });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(t.visibility.audienceShared)).toBeInTheDocument();
  });

  it('shows the moderation banner and disables the switch on a moderated note', async () => {
    mockGetMine.mockResolvedValue(makeNote({ moderated: true }));
    await renderEditor();

    expect(screen.getByText(t.moderated)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: t.visibility.label })).toBeDisabled();
  });

  it('marks the note moderated when sharing is refused with NOTE_MODERATED', async () => {
    mockGetMine.mockResolvedValue(makeNote());
    mockSaveMine.mockResolvedValue({ kind: 'moderated' });
    await renderEditor();

    fireEvent.click(screen.getByRole('switch', { name: t.visibility.label }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.visibility.confirm }));
    });

    expect(screen.getByText(t.moderated)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: t.visibility.label })).toBeDisabled();
  });

  it('deletes only after confirmation and resets to the empty state', async () => {
    mockGetMine.mockResolvedValue(makeNote());
    mockDeleteMine.mockResolvedValue(undefined);
    const textarea = await renderEditor();

    fireEvent.click(screen.getByRole('button', { name: t.delete.action }));
    expect(mockDeleteMine).not.toHaveBeenCalled();
    expect(screen.getByText(t.delete.confirm)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.delete.confirmAction }));
    });
    expect(mockDeleteMine).toHaveBeenCalledWith('t1');
    expect(textarea).toHaveValue('');

    // The next note is a create again.
    mockSaveMine.mockResolvedValue(saved(makeNote({ revision: 1 }), true));
    type(textarea, 'fresh');
    await advance(DEBOUNCE);
    expect(mockSaveMine).toHaveBeenLastCalledWith('t1', { body: 'fresh', baseRevision: 0 });
  });

  it('renders the preview through the Markdown viewer', async () => {
    mockGetMine.mockResolvedValue(makeNote({ body: 'the **key** idea' }));
    render(<MyNoteEditor topicId="t1" />);
    await screen.findByLabelText(t.editorLabel);

    fireEvent.click(screen.getByRole('button', { name: t.preview }));
    const strong = await screen.findByText('key');
    expect(strong.tagName).toBe('STRONG');
  });

  it('shows the load error with a retry', async () => {
    mockGetMine.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(null);
    render(<MyNoteEditor topicId="t1" />);

    expect(await screen.findByText(t.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: dictPt.common.retry }));
    expect(await screen.findByLabelText(t.editorLabel)).toBeInTheDocument();
  });

  describe('two tabs on the same note', () => {
    /** In-memory server implementing the revision check of PUT /notes/me. */
    function createFakeServer() {
      let stored: Note | null = null;
      return {
        get stored() { return stored; },
        getMine: async () => stored,
        saveMine: async (_topicId: string, input: SaveNoteInput): Promise<SaveNoteResult> => {
          const currentRevision = stored?.revision ?? 0;
          if (input.baseRevision !== currentRevision) return { kind: 'stale', current: stored };
          const created = stored === null;
          stored = makeNote({
            ...(stored ?? {}),
            body: input.body,
            visibility: input.visibility ?? stored?.visibility ?? 'private',
            revision: currentRevision + 1,
          });
          return { kind: 'saved', note: stored, created };
        },
      };
    }

    it('the second save gets the banner and no text is lost unless Keep mine is pressed', async () => {
      const server = createFakeServer();
      mockGetMine.mockImplementation(server.getMine);
      mockSaveMine.mockImplementation(server.saveMine);

      render(
        <>
          <div data-testid="tab-a"><MyNoteEditor topicId="t1" /></div>
          <div data-testid="tab-b"><MyNoteEditor topicId="t1" /></div>
        </>,
      );
      const tabA = within(screen.getByTestId('tab-a'));
      const tabB = within(screen.getByTestId('tab-b'));
      const editorA = await tabA.findByLabelText(t.editorLabel);
      const editorB = await tabB.findByLabelText(t.editorLabel);
      freezeClock();

      type(editorA, 'text from A');
      await advance(DEBOUNCE);
      expect(server.stored?.body).toBe('text from A');
      expect(tabA.getByText(t.saveState.saved)).toBeInTheDocument();

      type(editorB, 'text from B');
      await advance(DEBOUNCE);
      expect(tabB.getByText(t.conflict.stale)).toBeInTheDocument();
      expect(server.stored?.body).toBe('text from A');
      expect(editorB).toHaveValue('text from B');

      // Paused: further typing in B sends nothing.
      const calls = mockSaveMine.mock.calls.length;
      type(editorB, 'text from B, more');
      await advance(DEBOUNCE * 2);
      expect(mockSaveMine.mock.calls.length).toBe(calls);
      expect(server.stored?.body).toBe('text from A');
      expect(editorA).toHaveValue('text from A');

      await act(async () => {
        fireEvent.click(tabB.getByRole('button', { name: t.conflict.keepMine }));
      });
      expect(server.stored?.body).toBe('text from B, more');
      expect(server.stored?.revision).toBe(2);
    });
  });
});
