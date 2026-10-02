import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { dictPt } from '@web/i18n/dict-pt';
import type { StaffSubmissionView } from '@web/lib/submissions-api';
import { summary, view } from './fixtures';

const mockClient = {
  topics: { getById: vi.fn(), list: vi.fn() },
  submissions: {
    summary: vi.fn(),
    listMine: vi.fn(),
    listClass: vi.fn(),
    listAll: vi.fn(),
    getOne: vi.fn(),
    presign: vi.fn(),
    finalize: vi.fn(),
    edit: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    unshare: vi.fn(),
    clearModeration: vi.fn(),
    removeByStaff: vi.fn(),
  },
};

let currentRoles: string[] = [];
let mockSearch = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});
vi.mock('@web/hooks/use-auth', () => ({
  useHasRole: (...roles: string[]) => roles.some((r) => currentRoles.includes(r)),
  useCurrentUser: () => ({ id: 'staff-1', name: 'Staff Sam' }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearch,
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/catalog/t1/submissions',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { SubmissionsPage } from '../SubmissionsPage';

const t = dictPt.submissions;
const QUOTA = t.quota.line(3, 10, '420 MB', '1 GB');

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

const ownKata = view({ id: 'own', title: 'Kata do Sam', authorId: 'staff-1', authorName: 'Staff Sam' });

beforeEach(() => {
  vi.clearAllMocks();
  currentRoles = [ROLES.ADMIN];
  mockSearch = new URLSearchParams();
  mockClient.topics.getById.mockResolvedValue({ id: 't1', title: 'Kihon' });
  mockClient.submissions.summary.mockResolvedValue(summary({ totalCount: 4 }));
  mockClient.submissions.listMine.mockResolvedValue({ data: [ownKata], nextCursor: null });
  mockClient.submissions.listClass.mockResolvedValue({ data: [], nextCursor: null });
  mockClient.submissions.listAll.mockResolvedValue({ data: [], nextCursor: null });
});

describe.each([
  ['admin', ROLES.ADMIN],
  ['content creator', ROLES.CONTENT_CREATOR],
])('SubmissionsPage for a %s', (_label, role) => {
  beforeEach(() => {
    currentRoles = [role];
  });

  it('shows All (selected by default) and Mine, with no Class tab and no quota line on All', async () => {
    render(<SubmissionsPage topicId="t1" />);

    expect(await screen.findByRole('tab', { name: t.tabs.all })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: t.tabs.mine })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('tab', { name: t.tabs.class })).not.toBeInTheDocument();
    expect(screen.queryByText(QUOTA)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.upload.open })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: t.tabs.mine }));
    expect(mockReplace).toHaveBeenCalledWith('/catalog/t1/submissions?tab=mine', { scroll: false });
  });

  it('on Mine shows the upload button, the quota line and only their own uploads', async () => {
    mockSearch = new URLSearchParams('tab=mine');
    render(<SubmissionsPage topicId="t1" />);

    expect(await screen.findByRole('tab', { name: t.tabs.mine })).toHaveAttribute('aria-selected', 'true');
    const card = await screen.findByRole('article', { name: 'Kata do Sam' });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('button', { name: t.upload.open })).toBeInTheDocument();
    expect(screen.getByText(QUOTA)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: t.card.edit })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: t.card.move })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: t.card.delete })).toBeInTheDocument();
    expect(mockClient.submissions.listMine).toHaveBeenCalledWith('t1', null);
    expect(mockClient.submissions.listAll).not.toHaveBeenCalled();
    // No moderation action on their own cards in Mine.
    for (const name of [t.staff.unshare, t.staff.allowSharing, t.staff.remove]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});

describe('a staff user authoring from Mine', () => {
  beforeEach(() => {
    mockSearch = new URLSearchParams('tab=mine');
  });

  it('uploads a demonstration', async () => {
    mockClient.submissions.listMine
      .mockResolvedValueOnce({ data: [ownKata], nextCursor: null })
      .mockResolvedValueOnce({ data: [view({ id: 'new', title: 'clip' }), ownKata], nextCursor: null });
    mockClient.submissions.presign.mockResolvedValue({
      submission: view({ id: 'new', status: 'pending', url: null }),
      uploadUrl: 'https://r2.example/put',
      expiresAt: '',
    });
    mockClient.submissions.finalize.mockResolvedValue(view({ id: 'new', title: 'clip' }));
    const upload = vi.fn().mockResolvedValue(undefined);
    render(<SubmissionsPage topicId="t1" upload={upload} />);

    await screen.findByRole('article', { name: 'Kata do Sam' });
    fireEvent.click(screen.getByRole('button', { name: t.upload.open }));
    fireEvent.change(screen.getByLabelText(t.upload.fileLabel), {
      target: { files: [new File(['data'], 'clip.mp4', { type: 'video/mp4' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));

    await waitFor(() => expect(mockClient.submissions.finalize).toHaveBeenCalled());
    expect(mockClient.submissions.presign).toHaveBeenCalledWith('t1', expect.anything());
    expect(upload).toHaveBeenCalled();
    expect(await screen.findByRole('article', { name: 'clip' })).toBeInTheDocument();
    // The quota line is re-read after the upload.
    await waitFor(() => expect(mockClient.submissions.summary).toHaveBeenCalledTimes(2));
  });

  it('edits and shares their own demonstration', async () => {
    mockClient.submissions.edit.mockResolvedValue({ ...ownKata, visibility: 'shared' });
    render(<SubmissionsPage topicId="t1" />);

    const card = await screen.findByRole('article', { name: 'Kata do Sam' });
    fireEvent.click(within(card).getByRole('button', { name: t.card.edit }));
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: t.visibility.confirm }));
    fireEvent.click(screen.getByRole('button', { name: t.edit.save }));

    await waitFor(() =>
      expect(mockClient.submissions.edit).toHaveBeenCalledWith(
        't1',
        'own',
        expect.objectContaining({ visibility: 'shared' }),
      ),
    );
    expect(await screen.findByText(t.badges.shared)).toBeInTheDocument();
  });

  it('moves their own demonstration to another topic', async () => {
    mockClient.topics.list.mockResolvedValue([
      { id: 't1', title: 'Kihon', parentId: null, order: 1 },
      { id: 't2', title: 'Kata', parentId: null, order: 2 },
    ]);
    mockClient.submissions.move.mockResolvedValue({
      moved: [{ ...ownKata, topicNodeId: 't2', visibility: 'private' }],
      refused: [],
    });
    render(<SubmissionsPage topicId="t1" />);

    const card = await screen.findByRole('article', { name: 'Kata do Sam' });
    fireEvent.click(within(card).getByRole('button', { name: t.card.move }));
    const dialog = screen.getByRole('dialog', { name: t.move.heading(1) });
    fireEvent.click(await within(dialog).findByRole('radio', { name: /^Kata / }));
    fireEvent.click(within(dialog).getByRole('button', { name: t.move.submit }));

    expect(await within(dialog).findByText(t.move.resultMoved(1, 'Kata'))).toBeInTheDocument();
    expect(mockClient.submissions.move).toHaveBeenCalledWith(['own'], 't2');
  });

  it('deletes their own demonstration after confirmation', async () => {
    mockClient.submissions.remove.mockResolvedValue(undefined);
    render(<SubmissionsPage topicId="t1" />);

    const card = await screen.findByRole('article', { name: 'Kata do Sam' });
    fireEvent.click(within(card).getByRole('button', { name: t.card.delete }));
    fireEvent.click(within(card).getByRole('button', { name: t.delete.confirmAction }));
    await waitFor(() => expect(mockClient.submissions.remove).toHaveBeenCalledWith('t1', 'own'));
  });
});

describe('the All tab for staff', () => {
  it('still groups every submission by author with moderation actions and no edit or move', async () => {
    mockClient.submissions.listAll.mockResolvedValue({
      data: [
        staffView({ id: 'a1', title: 'Kata da Ana', authorId: 'ana', authorName: 'Ana', visibility: 'shared' }),
        staffView({ id: 'own', title: 'Kata do Sam', authorId: 'staff-1', authorName: 'Staff Sam' }),
      ],
      nextCursor: null,
    });
    render(<SubmissionsPage topicId="t1" />);

    const ana = await screen.findByRole('list', { name: t.staff.groupLabel('Ana') });
    expect(within(ana).getByRole('article', { name: 'Kata da Ana' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: t.staff.groupLabel('Staff Sam') })).toBeInTheDocument();
    expect(within(ana).getByRole('button', { name: t.staff.unshare })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: t.staff.remove })).toHaveLength(2);
    for (const name of [t.upload.open, t.card.edit, t.card.move, t.card.delete, t.select.start]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(mockClient.submissions.listMine).not.toHaveBeenCalled();
  });
});

describe('SubmissionsPage for a student', () => {
  it('is unchanged: Mine (default) and Class, with the quota line and upload, never All', async () => {
    currentRoles = [ROLES.STUDENT];
    render(<SubmissionsPage topicId="t1" />);

    expect(await screen.findByRole('tab', { name: t.tabs.mine })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([t.tabs.mine, t.tabs.class]);
    expect(screen.queryByRole('tab', { name: t.tabs.all })).not.toBeInTheDocument();
    expect(screen.getByText(QUOTA)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: t.upload.open })).toBeInTheDocument();
    expect(mockClient.submissions.listAll).not.toHaveBeenCalled();
  });

  it('cannot reach All through ?tab=all', async () => {
    currentRoles = [ROLES.STUDENT];
    mockSearch = new URLSearchParams('tab=all');
    render(<SubmissionsPage topicId="t1" />);
    expect(await screen.findByRole('tab', { name: t.tabs.mine })).toHaveAttribute('aria-selected', 'true');
  });
});
