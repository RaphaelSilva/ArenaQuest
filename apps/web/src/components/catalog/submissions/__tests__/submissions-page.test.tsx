import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { SubmissionsApiError } from '@web/lib/submissions-api';
import { summary, view } from './fixtures';

const mockClient = {
  topics: { getById: vi.fn() },
  submissions: { summary: vi.fn(), listMine: vi.fn(), listClass: vi.fn(), listAll: vi.fn(), getOne: vi.fn() },
};

const mockReplace = vi.fn();
let mockSearch = new URLSearchParams();
let mockStaff = false;

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});
vi.mock('@web/hooks/use-auth', () => ({ useHasRole: () => mockStaff }));
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
import { SubmissionsButton } from '../SubmissionsButton';

const t = dictPt.submissions;

describe('SubmissionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = new URLSearchParams();
    mockStaff = false;
    mockClient.topics.getById.mockResolvedValue({ id: 't1', title: 'Kihon' });
    mockClient.submissions.listMine.mockResolvedValue({ data: [], nextCursor: null });
    mockClient.submissions.listClass.mockResolvedValue({ data: [], nextCursor: null });
    mockClient.submissions.listAll.mockResolvedValue({ data: [], nextCursor: null });
  });

  it('shows Mine and Class tabs, the quota line and the Mine tab by default', async () => {
    mockClient.submissions.summary.mockResolvedValue(summary());
    render(<SubmissionsPage topicId="t1" />);

    const mine = await screen.findByRole('tab', { name: t.tabs.mine });
    expect(mine).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: t.tabs.class })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: t.tabs.all })).not.toBeInTheDocument();
    expect(screen.getByText(t.quota.line(3, 10, '420 MB', '1 GB'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kihon' })).toHaveAttribute('href', '/catalog/t1');
    expect(await screen.findByText(t.list.empty)).toBeInTheDocument();
  });

  it('drives the active tab through ?tab=', async () => {
    mockClient.submissions.summary.mockResolvedValue(summary());
    mockSearch = new URLSearchParams('tab=class');
    render(<SubmissionsPage topicId="t1" />);

    expect(await screen.findByRole('tab', { name: t.tabs.class })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: t.tabs.mine }));
    expect(mockReplace).toHaveBeenCalledWith('/catalog/t1/submissions?tab=mine', { scroll: false });
  });

  it('hides the Class tab when sharing is off, even when ?tab=class asks for it', async () => {
    mockClient.submissions.summary.mockResolvedValue(summary({ sharingEnabled: false }));
    mockSearch = new URLSearchParams('tab=class');
    render(<SubmissionsPage topicId="t1" />);

    expect(await screen.findByRole('tab', { name: t.tabs.mine })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: t.tabs.class })).not.toBeInTheDocument();
  });

  it('gives staff All (default) and Mine, never Class, with no upload button on All', async () => {
    mockStaff = true;
    mockClient.submissions.summary.mockResolvedValue(summary({ totalCount: 4 }));
    render(<SubmissionsPage topicId="t1" />);

    expect(await screen.findByRole('tab', { name: t.tabs.all })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([t.tabs.all, t.tabs.mine]);
    expect(screen.queryByRole('tab', { name: t.tabs.class })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.upload.open })).not.toBeInTheDocument();
  });

  it('shows the not-found message when the topic is not readable', async () => {
    mockClient.topics.getById.mockRejectedValue(new Error('Topic not found'));
    mockClient.submissions.summary.mockRejectedValue(new SubmissionsApiError('NotFound', 404, 'Not found.'));
    render(<SubmissionsPage topicId="t1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(t.page.notFound);
  });
});

describe('SubmissionsPage direct link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = new URLSearchParams();
    mockStaff = false;
    mockClient.topics.getById.mockResolvedValue({ id: 't1', title: 'Kihon' });
    mockClient.submissions.summary.mockResolvedValue(summary());
    mockClient.submissions.listMine.mockResolvedValue({ data: [], nextCursor: null });
    mockClient.submissions.listClass.mockResolvedValue({ data: [], nextCursor: null });
  });

  it('opens the viewer on the linked submission, over the Class tab for a classmate’s', async () => {
    mockClient.submissions.getOne.mockResolvedValue(
      view({ id: 's9', title: 'Kata da Ana', authorName: 'Ana', isMine: false, visibility: 'shared' }),
    );
    render(<SubmissionsPage topicId="t1" submissionId="s9" />);

    const dialog = await screen.findByRole('dialog', { name: t.viewer.label('Kata da Ana') });
    expect(dialog).toHaveTextContent(t.viewer.by('Ana'));
    expect(mockClient.submissions.getOne).toHaveBeenCalledWith('t1', 's9');
    expect(screen.getByRole('tab', { name: t.tabs.class })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: t.viewer.close }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the not-found state, and no page, when the API answers 404 for the submission', async () => {
    mockClient.submissions.getOne.mockRejectedValue(new SubmissionsApiError('NotFound', 404, 'Not found.'));
    render(<SubmissionsPage topicId="t1" submissionId="hidden" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(t.page.notFound);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('switches tabs back onto the page’s own path from a direct link', async () => {
    mockClient.submissions.getOne.mockResolvedValue(view({ id: 's1', isMine: true }));
    render(<SubmissionsPage topicId="t1" submissionId="s1" />);

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: t.viewer.close }));
    fireEvent.click(screen.getByRole('tab', { name: t.tabs.class }));
    expect(mockReplace).toHaveBeenCalledWith('/catalog/t1/submissions?tab=class', { scroll: false });
  });
});

describe('SubmissionsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('links to the page with both counts', async () => {
    mockClient.submissions.summary.mockResolvedValue(summary({ usage: { topicCount: 2, bytes: 0 }, classCount: 8 }));
    render(<SubmissionsButton topicId="t1" />);

    const link = await screen.findByRole('link', { name: new RegExp(t.button.label) });
    expect(link).toHaveAttribute('href', '/catalog/t1/submissions');
    expect(await screen.findByText(t.button.mineAndClass(2, 8))).toBeInTheDocument();
    expect(t.button.mineAndClass(2, 8)).toBe('2 minhas · 8 da turma');
  });

  it('shows only the own count when sharing is off', async () => {
    mockClient.submissions.summary.mockResolvedValue(
      summary({ sharingEnabled: false, usage: { topicCount: 2, bytes: 0 }, classCount: 0 }),
    );
    render(<SubmissionsButton topicId="t1" />);

    expect(await screen.findByText(t.button.mine(2))).toBeInTheDocument();
    expect(screen.queryByText(/da turma/)).not.toBeInTheDocument();
  });

  it('still renders the button without counts when the summary fails', async () => {
    mockClient.submissions.summary.mockRejectedValue(new SubmissionsApiError('NetworkError', 0, 'x'));
    render(<SubmissionsButton topicId="t1" />);
    expect(screen.getByRole('link', { name: new RegExp(t.button.label) })).toBeInTheDocument();
  });
});
