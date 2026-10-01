import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { SubmissionsApiError, type StaffAuthoredSubmission, type StaffSubmissionView } from '@web/lib/submissions-api';
import { summary, view } from './fixtures';

const mockClient = {
  topics: { getById: vi.fn() },
  submissions: {
    summary: vi.fn(),
    listMine: vi.fn(),
    listClass: vi.fn(),
    listAll: vi.fn(),
    listByUser: vi.fn(),
    getOne: vi.fn(),
    unshare: vi.fn(),
    clearModeration: vi.fn(),
    removeByStaff: vi.fn(),
    remove: vi.fn(),
    edit: vi.fn(),
    move: vi.fn(),
  },
};

let currentRoles: string[] = [];

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});
vi.mock('@web/hooks/use-auth', () => ({
  useHasRole: (...roles: string[]) => roles.some((r) => currentRoles.includes(r)),
  useCurrentUser: () => ({ id: 'admin-1', name: 'Admin Ana' }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/catalog/t1/submissions',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { SubmissionsButton } from '../SubmissionsButton';
import { SubmissionsPage } from '../SubmissionsPage';
import { StaffUserSubmissionsSection } from '../StaffUserSubmissionsSection';
import { staffActionsFor } from '../StaffSubmissionActions';

const t = dictPt.submissions;

function staffView(overrides: Partial<StaffSubmissionView> = {}): StaffSubmissionView {
  return {
    ...view({ isMine: false }),
    moderatedAt: null,
    moderatedBy: null,
    removedBy: null,
    removedByName: null,
    ...overrides,
  };
}

const anaShared = staffView({
  id: 'a1',
  title: 'Kata da Ana',
  authorId: 'ana',
  authorName: 'Ana',
  visibility: 'shared',
  sharedAt: '2026-09-29 13:00:00',
});
const beaPrivate = staffView({ id: 'b1', title: 'Kihon da Bea', authorId: 'bea', authorName: 'Bea' });
const anaModerated = staffView({
  id: 'a2',
  title: 'Kumite da Ana',
  authorId: 'ana',
  authorName: 'Ana',
  moderated: true,
  moderatedAt: '2026-09-29 14:00:00',
  moderatedBy: 'cc-1',
});
const beaRemoved = staffView({
  id: 'b2',
  title: 'Removida da Bea',
  authorId: 'bea',
  authorName: 'Bea',
  status: 'removed',
  url: null,
  removedAt: '2026-09-30 09:15:00',
  removedBy: 'admin-9',
  removedByName: 'Carlos',
});

async function renderAllTab(data: StaffSubmissionView[]) {
  mockClient.submissions.listAll.mockResolvedValue({ data, nextCursor: null });
  render(<SubmissionsPage topicId="t1" />);
  await screen.findByRole('tab', { name: t.tabs.all });
}

function card(title: string) {
  return screen.getByRole('article', { name: title });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentRoles = ['content_creator'];
  mockClient.topics.getById.mockResolvedValue({ id: 't1', title: 'Kihon' });
  mockClient.submissions.summary.mockResolvedValue(summary({ totalCount: 4 }));
});

describe('SubmissionsButton for staff', () => {
  it('reads Student demonstrations with the topic total', async () => {
    currentRoles = ['admin'];
    mockClient.submissions.summary.mockResolvedValue(summary({ totalCount: 7 }));
    render(<SubmissionsButton topicId="t1" />);

    const link = await screen.findByRole('link', { name: new RegExp(t.button.staffLabel) });
    expect(link).toHaveAttribute('href', '/catalog/t1/submissions');
    expect(await screen.findByText(t.button.total(7))).toBeInTheDocument();
    expect(t.button.staffLabel).toBe('Demonstrações dos alunos');
    expect(screen.queryByText(t.button.mineAndClass(3, 8))).not.toBeInTheDocument();
  });

  it('keeps the student label for a student', async () => {
    currentRoles = ['student'];
    render(<SubmissionsButton topicId="t1" />);
    expect(await screen.findByText(t.button.mineAndClass(3, 8))).toBeInTheDocument();
    expect(screen.queryByText(t.button.staffLabel)).not.toBeInTheDocument();
  });
});

describe('All tab', () => {
  it('lists every submission grouped by student, with badges and the removal details', async () => {
    await renderAllTab([anaShared, beaPrivate, anaModerated, beaRemoved]);

    expect(mockClient.submissions.listAll).toHaveBeenCalledWith('t1', null);
    const ana = await screen.findByRole('list', { name: t.staff.groupLabel('Ana') });
    const bea = screen.getByRole('list', { name: t.staff.groupLabel('Bea') });
    expect(within(ana).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'Kata da Ana',
      'Kumite da Ana',
    ]);
    expect(within(bea).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'Kihon da Bea',
      'Removida da Bea',
    ]);

    expect(within(card('Kata da Ana')).getByText(t.badges.shared)).toBeInTheDocument();
    expect(within(card('Kihon da Bea')).getByText(t.badges.private)).toBeInTheDocument();
    expect(within(card('Kumite da Ana')).getByText(t.badges.moderated)).toBeInTheDocument();
    const removed = card('Removida da Bea');
    expect(within(removed).getByText(t.staff.removedBadge)).toBeInTheDocument();
    expect(within(removed).getByText(t.staff.removedBy('Carlos', '2026-09-30 09:15'))).toBeInTheDocument();
    expect(within(removed).queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders no upload, edit, move or delete control for staff', async () => {
    currentRoles = ['admin'];
    await renderAllTab([anaShared, beaPrivate]);
    await screen.findByRole('article', { name: 'Kata da Ana' });

    for (const name of [t.upload.open, t.card.edit, t.card.move, t.card.delete, t.select.start]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(t.quota.line(3, 10, '420 MB', '1 GB'))).not.toBeInTheDocument();
  });

  it('shows the empty state when no student sent anything', async () => {
    await renderAllTab([]);
    expect(await screen.findByText(t.staff.empty)).toBeInTheDocument();
  });

  it('opens the shared viewer on a ready card', async () => {
    await renderAllTab([anaShared]);
    fireEvent.click(await screen.findByRole('button', { name: t.card.open('Kata da Ana') }));
    const dialog = await screen.findByRole('dialog', { name: t.viewer.label('Kata da Ana') });
    expect(dialog).toHaveTextContent(t.viewer.by('Ana'));
  });

  it('lets a content creator remove sharing and allow it again, but never remove', async () => {
    mockClient.submissions.unshare.mockResolvedValue({
      ...anaShared,
      visibility: 'private',
      sharedAt: null,
      moderated: true,
      moderatedAt: '2026-10-01 10:00:00',
      moderatedBy: 'cc-1',
    });
    mockClient.submissions.clearModeration.mockResolvedValue(undefined);
    await renderAllTab([anaShared, beaPrivate]);

    await screen.findByRole('article', { name: 'Kata da Ana' });
    expect(screen.queryByRole('button', { name: t.staff.remove })).not.toBeInTheDocument();
    // A private, unmoderated submission offers a content creator nothing.
    expect(within(card('Kihon da Bea')).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      t.card.open('Kihon da Bea'),
    ]);

    fireEvent.click(within(card('Kata da Ana')).getByRole('button', { name: t.staff.unshare }));
    expect(within(card('Kata da Ana')).getByText(t.staff.confirmUnshare)).toBeInTheDocument();
    fireEvent.click(within(card('Kata da Ana')).getByRole('button', { name: t.staff.confirm }));

    await waitFor(() => expect(within(card('Kata da Ana')).getByText(t.badges.moderated)).toBeInTheDocument());
    expect(mockClient.submissions.unshare).toHaveBeenCalledWith('a1');
    expect(within(card('Kata da Ana')).getByText(t.badges.private)).toBeInTheDocument();

    fireEvent.click(within(card('Kata da Ana')).getByRole('button', { name: t.staff.allowSharing }));
    expect(within(card('Kata da Ana')).getByText(t.staff.confirmAllowSharing)).toBeInTheDocument();
    fireEvent.click(within(card('Kata da Ana')).getByRole('button', { name: t.staff.confirm }));

    await waitFor(() => expect(within(card('Kata da Ana')).queryByText(t.badges.moderated)).not.toBeInTheDocument());
    expect(mockClient.submissions.clearModeration).toHaveBeenCalledWith('a1');
    expect(within(card('Kata da Ana')).queryByRole('button', { name: t.staff.allowSharing })).not.toBeInTheDocument();
    expect(mockClient.submissions.removeByStaff).not.toHaveBeenCalled();
  });

  it('lets an admin remove after a confirmation that names the file deletion and the tombstone', async () => {
    currentRoles = ['admin'];
    mockClient.submissions.removeByStaff.mockResolvedValue(undefined);
    await renderAllTab([anaShared, beaPrivate]);

    const target = await screen.findByRole('article', { name: 'Kihon da Bea' });
    fireEvent.click(within(target).getByRole('button', { name: t.staff.remove }));
    expect(within(target).getByText(t.staff.confirmRemove)).toBeInTheDocument();
    expect(t.staff.confirmRemove).toContain(t.tombstone.label);
    expect(mockClient.submissions.removeByStaff).not.toHaveBeenCalled();

    fireEvent.click(within(target).getByRole('button', { name: t.staff.remove }));
    await waitFor(() => expect(within(card('Kihon da Bea')).getByText(t.staff.removedBadge)).toBeInTheDocument());
    expect(mockClient.submissions.removeByStaff).toHaveBeenCalledWith('b1');
    expect(within(card('Kihon da Bea')).getByText(new RegExp(`^${t.staff.removedBy('Admin Ana', '').trim()}`))).toBeInTheDocument();
    expect(within(card('Kihon da Bea')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the card and shows the error when the removal fails', async () => {
    currentRoles = ['admin'];
    mockClient.submissions.removeByStaff.mockRejectedValue(new SubmissionsApiError('StorageUnavailable', 502, 'x'));
    await renderAllTab([beaPrivate]);

    const target = await screen.findByRole('article', { name: 'Kihon da Bea' });
    fireEvent.click(within(target).getByRole('button', { name: t.staff.remove }));
    fireEvent.click(within(target).getByRole('button', { name: t.staff.remove }));

    expect(await within(target).findByRole('alert')).toHaveTextContent(t.errors.storageUnavailable);
    expect(within(target).queryByText(t.staff.removedBadge)).not.toBeInTheDocument();
  });

  it('cancelling a confirmation calls nothing', async () => {
    await renderAllTab([anaShared]);
    const target = await screen.findByRole('article', { name: 'Kata da Ana' });
    fireEvent.click(within(target).getByRole('button', { name: t.staff.unshare }));
    fireEvent.click(within(target).getByRole('button', { name: t.staff.cancel }));
    expect(within(target).getByRole('button', { name: t.staff.unshare })).toBeInTheDocument();
    expect(mockClient.submissions.unshare).not.toHaveBeenCalled();
  });
});

describe('staffActionsFor', () => {
  it('offers remove to admins only and nothing on a removed submission', () => {
    expect(staffActionsFor(anaShared, false)).toEqual(['unshare']);
    expect(staffActionsFor(anaShared, true)).toEqual(['unshare', 'remove']);
    expect(staffActionsFor(anaModerated, false)).toEqual(['allow']);
    expect(staffActionsFor(beaPrivate, false)).toEqual([]);
    expect(staffActionsFor(beaPrivate, true)).toEqual(['remove']);
    expect(staffActionsFor(beaRemoved, true)).toEqual([]);
  });
});

describe('StaffUserSubmissionsSection', () => {
  function authored(v: StaffSubmissionView, topicNodeId: string, topicTitle: string): StaffAuthoredSubmission {
    return { ...v, topicNodeId, topicTitle };
  }

  it("groups the student's submissions by topic with the same badges and actions", async () => {
    currentRoles = ['admin'];
    mockClient.submissions.listByUser.mockResolvedValue({
      data: [
        authored(anaShared, 't1', 'Kihon'),
        authored(anaModerated, 't2', 'Kumite'),
        authored({ ...beaRemoved, authorId: 'ana', authorName: 'Ana' }, 't1', 'Kihon'),
      ],
      nextCursor: null,
    });
    mockClient.submissions.unshare.mockResolvedValue({ ...anaShared, visibility: 'private', moderated: true });
    render(<StaffUserSubmissionsSection userId="ana" />);

    const kihon = await screen.findByRole('list', { name: t.staff.userSection.groupLabel('Kihon') });
    expect(mockClient.submissions.listByUser).toHaveBeenCalledWith('ana', null);
    expect(within(kihon).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'Kata da Ana',
      'Removida da Bea',
    ]);
    expect(screen.getByRole('link', { name: 'Kihon' })).toHaveAttribute('href', '/catalog/t1/submissions?tab=all');
    const kumite = screen.getByRole('list', { name: t.staff.userSection.groupLabel('Kumite') });
    expect(within(kumite).getByText(t.badges.moderated)).toBeInTheDocument();
    expect(within(kumite).getByRole('button', { name: t.staff.allowSharing })).toBeInTheDocument();
    expect(screen.getByText(t.staff.removedBy('Carlos', '2026-09-30 09:15'))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: t.staff.remove })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: t.card.edit })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.card.move })).not.toBeInTheDocument();

    fireEvent.click(within(card('Kata da Ana')).getByRole('button', { name: t.staff.unshare }));
    fireEvent.click(within(card('Kata da Ana')).getByRole('button', { name: t.staff.confirm }));
    await waitFor(() => expect(within(card('Kata da Ana')).getByText(t.badges.moderated)).toBeInTheDocument());
  });

  it('hides Remove from a content creator', async () => {
    mockClient.submissions.listByUser.mockResolvedValue({ data: [authored(anaShared, 't1', 'Kihon')], nextCursor: null });
    render(<StaffUserSubmissionsSection userId="ana" />);
    expect(await screen.findByRole('button', { name: t.staff.unshare })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.staff.remove })).not.toBeInTheDocument();
  });

  it('shows the empty state and the load error with a retry', async () => {
    mockClient.submissions.listByUser.mockResolvedValueOnce({ data: [], nextCursor: null });
    const { unmount } = render(<StaffUserSubmissionsSection userId="ana" />);
    expect(await screen.findByText(t.staff.userSection.empty)).toBeInTheDocument();
    unmount();

    mockClient.submissions.listByUser.mockRejectedValueOnce(new SubmissionsApiError('NetworkError', 0, 'x'));
    render(<StaffUserSubmissionsSection userId="ana" />);
    expect(await screen.findByText(t.staff.userSection.loadError)).toBeInTheDocument();
  });
});
