import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock next/navigation (used by the page, not the tab component)
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Mock useApiClient hook
// ---------------------------------------------------------------------------

const mockListUserGrants = vi.fn();
const mockGrantUserTopic = vi.fn();
const mockRevokeUserTopic = vi.fn();
const mockListTopics = vi.fn();

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({
      adminEnrollment: {
        listUserGrants: (...args: unknown[]) => mockListUserGrants(...args),
        grantUserTopic: (...args: unknown[]) => mockGrantUserTopic(...args),
        revokeUserTopic: (...args: unknown[]) => mockRevokeUserTopic(...args),
      },
      adminTopics: {
        list: (...args: unknown[]) => mockListTopics(...args),
      },
    }),
  };
});

// ---------------------------------------------------------------------------
// Import EnrollmentsTab after mocks
// ---------------------------------------------------------------------------

import { EnrollmentsTab } from '@web/components/enrollment/enrollments-tab';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGrant(topicId = 'top1') {
  return {
    id: `g-${topicId}`,
    userId: 'u1',
    topicNodeId: topicId,
    grantedBy: 'admin',
    grantedAt: '2026-05-01T00:00:00Z',
  };
}

function makeTopic(id = 'top1', title = 'Fundamentos') {
  return {
    id,
    parentId: null,
    title,
    content: '',
    status: 'published' as const,
    archived: false,
    order: 0,
    estimatedMinutes: 10,
    tags: [],
    prerequisiteIds: [],
  };
}

const USER_ID = 'u1';

beforeEach(() => {
  vi.clearAllMocks();
  mockListUserGrants.mockResolvedValue([makeGrant()]);
  mockListTopics.mockResolvedValue([makeTopic()]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnrollmentsTab — grant flow', () => {
  it('renders granted topics after load', async () => {
    render(<EnrollmentsTab userId={USER_ID}  />);
    await waitFor(() => expect(screen.getByText('Fundamentos')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /revoke access to fundamentos/i })).toBeInTheDocument();
  });

  it('shows empty state when no grants exist', async () => {
    mockListUserGrants.mockResolvedValue([]);
    render(<EnrollmentsTab userId={USER_ID}  />);
    await waitFor(() => expect(screen.getByText(/No topics granted yet/i)).toBeInTheDocument());
  });

  it('opens topic picker on "Grant topic access" click', async () => {
    render(<EnrollmentsTab userId={USER_ID}  />);
    await waitFor(() => screen.getByText('Fundamentos'));
    await userEvent.click(screen.getByRole('button', { name: /grant topic access/i }));
    expect(screen.getByRole('dialog', { name: /grant topic access/i })).toBeInTheDocument();
  });

  it('calls grantUserTopic and adds grant after topic selection', async () => {
    const newTopic = makeTopic('top2', 'Avançado');
    mockListTopics.mockResolvedValue([makeTopic(), newTopic]);
    mockListUserGrants.mockResolvedValue([]);
    mockGrantUserTopic.mockResolvedValue({ grant: makeGrant('top2'), created: true });

    render(<EnrollmentsTab userId={USER_ID}  />);
    await waitFor(() => screen.getByRole('button', { name: /grant topic access/i }));
    await userEvent.click(screen.getByRole('button', { name: /grant topic access/i }));
    await waitFor(() => screen.getByText('Avançado'));
    await userEvent.click(screen.getByRole('button', { name: 'Avançado' }));

    expect(mockGrantUserTopic).toHaveBeenCalledWith(USER_ID, 'top2');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('EnrollmentsTab — revoke flow', () => {
  it('opens revoke dialog with cascade toggle on revoke click', async () => {
    render(<EnrollmentsTab userId={USER_ID}  />);
    await waitFor(() => screen.getByRole('button', { name: /revoke access to fundamentos/i }));
    await userEvent.click(screen.getByRole('button', { name: /revoke access to fundamentos/i }));
    expect(screen.getByRole('dialog', { name: /revoke access/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/also revoke descendant grants/i)).toBeInTheDocument();
  });

  it('calls revokeUserTopic with cascade=false by default', async () => {
    mockRevokeUserTopic.mockResolvedValue(undefined);
    render(<EnrollmentsTab userId={USER_ID}  />);
    await waitFor(() => screen.getByRole('button', { name: /revoke access to fundamentos/i }));
    await userEvent.click(screen.getByRole('button', { name: /revoke access to fundamentos/i }));
    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    await waitFor(() => expect(mockRevokeUserTopic).toHaveBeenCalledWith(USER_ID, 'top1', false));
    // Dialog should close after confirm
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('calls revokeUserTopic with cascade=true when toggle is checked', async () => {
    mockRevokeUserTopic.mockResolvedValue(undefined);
    render(<EnrollmentsTab userId={USER_ID}  />);
    await waitFor(() => screen.getByRole('button', { name: /revoke access to fundamentos/i }));
    await userEvent.click(screen.getByRole('button', { name: /revoke access to fundamentos/i }));
    await userEvent.click(screen.getByLabelText(/also revoke descendant grants/i));
    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    expect(mockRevokeUserTopic).toHaveBeenCalledWith(USER_ID, 'top1', true);
  });
});
