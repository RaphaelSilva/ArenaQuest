import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import type { ClassNote, StaffAuthoredNote, StaffNote } from '@web/lib/notes-api';

const mockClient = {
  notes: {
    getMine: vi.fn(),
    saveMine: vi.fn(),
    deleteMine: vi.fn(),
    listForTopic: vi.fn(),
    listForUser: vi.fn(),
    unshare: vi.fn(),
    clearModeration: vi.fn(),
  },
};

let currentRoles: string[] = [];

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

vi.mock('@web/hooks/use-auth', () => ({
  useHasRole: (...roles: string[]) => roles.some((r) => currentRoles.includes(r)),
}));

import { NotesPanel } from '../NotesPanel';
import { StaffUserNotesSection } from '../StaffUserNotesSection';

const t = dictPt.notes;

function classNote(overrides: Partial<ClassNote>): ClassNote {
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

function staffNote(overrides: Partial<StaffAuthoredNote>): StaffAuthoredNote {
  return {
    id: 'n1',
    topicNodeId: 't1',
    topicTitle: 'Topic one',
    authorId: 'a',
    authorName: 'Ana',
    body: 'hello',
    visibility: 'shared',
    revision: 1,
    sharedAt: '2026-09-28 12:00:00',
    moderated: false,
    moderatedAt: null,
    moderatedBy: null,
    createdAt: '2026-09-27 10:00:00',
    updatedAt: '2026-09-28 12:00:00',
    ...overrides,
  };
}

async function openClassNotes() {
  render(<NotesPanel topicId="t1" />);
  fireEvent.click(screen.getByRole('tab', { name: t.tabClass }));
  return screen.findByRole('list', { name: t.classList.label });
}

function expectNoEditOrDelete() {
  expect(screen.queryByRole('button', { name: t.delete.action })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.delete.confirmAction })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
}

describe('Class notes — staff gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.notes.getMine.mockResolvedValue(null);
    mockClient.notes.listForTopic.mockResolvedValue({
      data: [
        classNote({ id: 'shared', authorName: 'Ana', visibility: 'shared' }),
        classNote({ id: 'private', authorName: 'Bruno', visibility: 'private', sharedAt: null }),
        classNote({ id: 'moderated', authorName: 'Caio', visibility: 'private', sharedAt: null, moderated: true }),
      ],
      nextCursor: null,
    });
  });

  it.each([['admin'], ['content_creator']])('shows badges and actions to %s', async (role) => {
    currentRoles = [role];
    const list = await openClassNotes();
    const [shared, priv, moderated] = within(list).getAllByRole('listitem');

    expect(within(shared).getByText(t.badges.shared)).toBeInTheDocument();
    expect(within(shared).getByRole('button', { name: t.staff.unshare })).toBeInTheDocument();

    expect(within(priv).getByText(t.badges.private)).toBeInTheDocument();
    expect(within(priv).queryByRole('button')).not.toBeInTheDocument();

    expect(within(moderated).getByText(t.badges.moderated)).toBeInTheDocument();
    expect(within(moderated).getByRole('button', { name: t.staff.allowSharing })).toBeInTheDocument();

    expectNoEditOrDelete();
  });

  it.each([['tutor'], ['student']])('shows no badge and no staff action to %s', async (role) => {
    currentRoles = [role];
    mockClient.notes.listForTopic.mockResolvedValue({
      data: [classNote({ id: 'shared', visibility: 'shared' })],
      nextCursor: null,
    });
    const list = await openClassNotes();

    expect(within(list).queryByText(t.badges.shared)).not.toBeInTheDocument();
    expect(within(list).queryByText(t.badges.private)).not.toBeInTheDocument();
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers no staff action on the staff member’s own note', async () => {
    currentRoles = ['admin'];
    mockClient.notes.listForTopic.mockResolvedValue({
      data: [classNote({ id: 'mine', isMine: true })],
      nextCursor: null,
    });
    const list = await openClassNotes();

    expect(within(list).getByText(t.badges.shared)).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: t.staff.unshare })).not.toBeInTheDocument();
  });

  it('unshares after confirmation and turns the card private and moderated in place', async () => {
    currentRoles = ['content_creator'];
    mockClient.notes.listForTopic.mockResolvedValue({
      data: [classNote({ id: 'shared', visibility: 'shared' })],
      nextCursor: null,
    });
    const returned: StaffNote = {
      ...classNote({ id: 'shared' }),
      visibility: 'private',
      sharedAt: null,
      moderated: true,
      revision: 2,
      moderatedAt: '2026-09-28 13:00:00',
      moderatedBy: 'staff-1',
    };
    mockClient.notes.unshare.mockResolvedValue(returned);

    const list = await openClassNotes();
    fireEvent.click(within(list).getByRole('button', { name: t.staff.unshare }));
    expect(mockClient.notes.unshare).not.toHaveBeenCalled();
    expect(within(list).getByText(t.staff.confirmUnshare)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: t.staff.confirm }));

    expect(await within(list).findByText(t.badges.moderated)).toBeInTheDocument();
    expect(within(list).getByText(t.badges.private)).toBeInTheDocument();
    expect(within(list).queryByText(t.badges.shared)).not.toBeInTheDocument();
    expect(within(list).getByRole('button', { name: t.staff.allowSharing })).toBeInTheDocument();
    expect(mockClient.notes.unshare).toHaveBeenCalledWith('shared');
    expect(mockClient.notes.listForTopic).toHaveBeenCalledTimes(1);
  });

  it('cancelling the confirmation does not call the API', async () => {
    currentRoles = ['admin'];
    const list = await openClassNotes();
    const [shared] = within(list).getAllByRole('listitem');
    fireEvent.click(within(shared).getByRole('button', { name: t.staff.unshare }));
    fireEvent.click(within(shared).getByRole('button', { name: t.staff.cancel }));

    expect(mockClient.notes.unshare).not.toHaveBeenCalled();
    expect(within(shared).getByRole('button', { name: t.staff.unshare })).toBeInTheDocument();
  });

  it('shows an error and keeps the card when unshare fails', async () => {
    currentRoles = ['admin'];
    mockClient.notes.unshare.mockRejectedValue(new Error('boom'));
    const list = await openClassNotes();
    const [shared] = within(list).getAllByRole('listitem');
    fireEvent.click(within(shared).getByRole('button', { name: t.staff.unshare }));
    fireEvent.click(within(shared).getByRole('button', { name: t.staff.confirm }));

    expect(await within(shared).findByRole('alert')).toHaveTextContent(t.staff.unshareError);
    expect(within(shared).getByText(t.badges.shared)).toBeInTheDocument();
  });

  it('allow sharing again clears the moderated badge in place', async () => {
    currentRoles = ['admin'];
    mockClient.notes.clearModeration.mockResolvedValue(undefined);
    const list = await openClassNotes();
    const moderated = within(list).getAllByRole('listitem')[2];

    fireEvent.click(within(moderated).getByRole('button', { name: t.staff.allowSharing }));
    fireEvent.click(within(moderated).getByRole('button', { name: t.staff.confirm }));

    await waitFor(() => expect(within(moderated).queryByText(t.badges.moderated)).not.toBeInTheDocument());
    expect(within(moderated).getByText(t.badges.private)).toBeInTheDocument();
    expect(within(moderated).queryByRole('button')).not.toBeInTheDocument();
    expect(mockClient.notes.clearModeration).toHaveBeenCalledWith('moderated');
  });
});

describe('StaffUserNotesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRoles = ['admin'];
  });

  it('lists private and shared notes grouped by topic, with actions and no edit or delete', async () => {
    mockClient.notes.listForUser.mockResolvedValue({
      data: [
        staffNote({ id: 'a', topicNodeId: 't1', topicTitle: 'Topic one', body: 'shared one', visibility: 'shared' }),
        staffNote({ id: 'b', topicNodeId: 't2', topicTitle: 'Topic two', body: 'private one', visibility: 'private', sharedAt: null }),
        staffNote({ id: 'c', topicNodeId: 't1', topicTitle: 'Topic one', body: 'moderated one', visibility: 'private', moderated: true }),
      ],
      nextCursor: null,
    });

    render(<StaffUserNotesSection userId="u1" />);

    expect(screen.getByRole('heading', { name: t.staff.userSection.title })).toBeInTheDocument();
    const one = await screen.findByRole('region', { name: 'Topic one' });
    const two = screen.getByRole('region', { name: 'Topic two' });
    expect(within(one).getByText('shared one')).toBeInTheDocument();
    expect(within(one).getByText('moderated one')).toBeInTheDocument();
    expect(within(two).getByText('private one')).toBeInTheDocument();

    expect(within(one).getByRole('button', { name: t.staff.unshare })).toBeInTheDocument();
    expect(within(one).getByRole('button', { name: t.staff.allowSharing })).toBeInTheDocument();
    expect(within(two).getByText(t.badges.private)).toBeInTheDocument();
    expect(within(two).queryByRole('button')).not.toBeInTheDocument();

    expectNoEditOrDelete();
    expect(mockClient.notes.listForUser).toHaveBeenCalledWith('u1', null);
  });

  it('unshares in place from the backoffice', async () => {
    mockClient.notes.listForUser.mockResolvedValue({
      data: [staffNote({ id: 'a', visibility: 'shared' })],
      nextCursor: null,
    });
    mockClient.notes.unshare.mockResolvedValue({
      ...staffNote({ id: 'a' }),
      visibility: 'private',
      moderated: true,
      sharedAt: null,
    });

    render(<StaffUserNotesSection userId="u1" />);
    fireEvent.click(await screen.findByRole('button', { name: t.staff.unshare }));
    fireEvent.click(screen.getByRole('button', { name: t.staff.confirm }));

    expect(await screen.findByText(t.badges.moderated)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.staff.allowSharing })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mockClient.notes.listForUser.mockResolvedValue({ data: [], nextCursor: null });
    render(<StaffUserNotesSection userId="u1" />);
    expect(await screen.findByText(t.staff.userSection.empty)).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    mockClient.notes.listForUser
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: [staffNote({ body: 'after retry' })], nextCursor: null });
    render(<StaffUserNotesSection userId="u1" />);

    expect(await screen.findByText(t.staff.userSection.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: dictPt.common.retry }));
    expect(await screen.findByText('after retry')).toBeInTheDocument();
  });

  it('loads more with the cursor', async () => {
    mockClient.notes.listForUser
      .mockResolvedValueOnce({ data: [staffNote({ id: 'a', body: 'first page' })], nextCursor: 'cur/1' })
      .mockResolvedValueOnce({ data: [staffNote({ id: 'b', body: 'second page' })], nextCursor: null });
    render(<StaffUserNotesSection userId="u1" />);

    fireEvent.click(await screen.findByRole('button', { name: t.staff.userSection.loadMore }));
    expect(await screen.findByText('second page')).toBeInTheDocument();
    expect(mockClient.notes.listForUser).toHaveBeenLastCalledWith('u1', 'cur/1');
  });
});
