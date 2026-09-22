/**
 * The admin events list.
 *
 * Two of its properties are contractual rather than cosmetic: drafts are part
 * of the list (this is the authoring board, not the public one), and there is
 * no delete control — no `DELETE /{id}` exists, so removal is the archive
 * transition and an archived row has to be recognisable as one.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dictPt } from '@web/i18n';
import type { AdminEvent } from '@web/lib/admin-events-api';

const d = dictPt.admin.events;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const mockUseAuth = vi.fn();
const mockUseHasRole = vi.fn();
vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
  useHasRole: (...roles: string[]) => mockUseHasRole(...roles),
}));

const mockAdminEvents = vi.hoisted(() => ({ list: vi.fn() }));
// One stable object, as the real `useApiClient` returns — a fresh one per
// render would re-create the page's `load` callback and re-fire its effect.
const mockClient = vi.hoisted(() => ({ adminEvents: { list: vi.fn() } }));
mockClient.adminEvents = mockAdminEvents;
vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => mockClient,
  };
});

import AdminEventsPage from '@web/app/(protected)/admin/events/page';

function makeEvent(overrides: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: 'event-1',
    slug: 'seminario',
    title: 'Seminário de outubro',
    summary: '',
    content: '',
    location: '',
    startsAt: '2026-10-10T13:00:00.000Z',
    endsAt: null,
    timezone: 'America/Sao_Paulo',
    status: 'draft',
    audience: 'members',
    flyer: { status: 'none', key: null, type: null, sizeBytes: null, name: null },
    whatsappNumber: '',
    whatsappMessage: null,
    contactLabel: '',
    createdBy: 'user-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({ isLoading: false });
  mockUseHasRole.mockReturnValue(true);
  mockAdminEvents.list.mockResolvedValue({
    data: [
      makeEvent(),
      makeEvent({ id: 'event-2', title: 'Graduação de junho', status: 'archived' }),
      makeEvent({ id: 'event-3', title: 'Treino aberto', status: 'published', audience: 'public' }),
    ],
    total: 3,
    limit: 50,
    offset: 0,
  });
});

describe('AdminEventsPage', () => {
  it('lists drafts, published and archived alike, and marks the archived one', async () => {
    render(<AdminEventsPage />);

    await waitFor(() => expect(screen.getByText('Seminário de outubro')).toBeInTheDocument());
    expect(screen.getByText('Graduação de junho')).toBeInTheDocument();
    expect(screen.getByText('Treino aberto')).toBeInTheDocument();

    // The archived row says so in words, not only by opacity. (The status
    // labels also name the filter buttons, so the assertion is scoped to the
    // row rather than to the page.)
    const archivedRow = screen.getByText('Graduação de junho').closest('li') as HTMLElement;
    expect(within(archivedRow).getByText(d.list.archivedNote)).toBeInTheDocument();
    expect(within(archivedRow).getByText(d.status.archived)).toBeInTheDocument();

    const draftRow = screen.getByText('Seminário de outubro').closest('li') as HTMLElement;
    expect(within(draftRow).getByText(d.status.draft)).toBeInTheDocument();
    expect(within(draftRow).queryByText(d.list.archivedNote)).not.toBeInTheDocument();

    const publishedRow = screen.getByText('Treino aberto').closest('li') as HTMLElement;
    expect(within(publishedRow).getByText(d.status.published)).toBeInTheDocument();
    expect(within(publishedRow).getByText(d.audienceName.public)).toBeInTheDocument();
  });

  it('filters by status through the API rather than in the browser', async () => {
    const user = userEvent.setup();
    render(<AdminEventsPage />);
    await screen.findByText('Seminário de outubro');

    await user.click(screen.getByRole('button', { name: d.status.draft }));
    await waitFor(() =>
      expect(mockAdminEvents.list).toHaveBeenLastCalledWith({ status: 'draft' }),
    );
  });

  it('renders no delete control anywhere', async () => {
    const { container } = render(<AdminEventsPage />);
    await screen.findByText('Seminário de outubro');

    const nodes = [
      ...within(container).queryAllByRole('button'),
      ...within(container).queryAllByRole('link'),
    ];
    for (const node of nodes) {
      expect(node.textContent ?? '').not.toMatch(/excluir|apagar|delete|remover/i);
    }
  });
});
