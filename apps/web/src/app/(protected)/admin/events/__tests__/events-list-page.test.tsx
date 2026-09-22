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

/**
 * The states the authoring list shows when there is nothing to list.
 *
 * "No events" and "the API did not answer" look the same from the component's
 * point of view — both leave `events` empty — and telling them apart matters
 * more here than on the public board: an admin shown "no events yet, create the
 * first one" while the backend is down may well go and re-create events that
 * already exist.
 */
describe('AdminEventsPage — empty, loading and failure', () => {
  it('offers a way to create the first event when the tenant has none', async () => {
    mockAdminEvents.list.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });
    render(<AdminEventsPage />);

    await waitFor(() => expect(screen.getByText(d.list.emptyTitle)).toBeInTheDocument());
    expect(screen.getByText(d.list.empty)).toBeInTheDocument();

    // The affordance is inside the empty panel itself, not only in the header
    // the admin has already scrolled past.
    const panel = screen.getByText(d.list.emptyTitle).closest('section') as HTMLElement;
    expect(within(panel).getByRole('link', { name: d.list.newButton })).toHaveAttribute(
      'href',
      '/admin/events/new',
    );
  });

  it('distinguishes an empty filter from an empty tenant', async () => {
    const user = userEvent.setup();
    render(<AdminEventsPage />);
    await screen.findByText('Seminário de outubro');

    mockAdminEvents.list.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });
    await user.click(screen.getByRole('button', { name: d.status.archived }));

    await waitFor(() => expect(screen.getByText(d.list.emptyFilteredTitle)).toBeInTheDocument());
    // Not an invitation to create: the events exist, the filter hides them.
    expect(screen.queryByText(d.list.emptyTitle)).not.toBeInTheDocument();
  });

  it('reads a failed load as a failure, never as an empty tenant', async () => {
    mockAdminEvents.list.mockRejectedValue(new Error('network down'));
    render(<AdminEventsPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(d.list.errorTitle);
    expect(screen.getByRole('alert')).toHaveTextContent(d.list.errorLoading);

    expect(screen.queryByText(d.list.emptyTitle)).not.toBeInTheDocument();
    // And no count either: "0 event(s)" would be a claim about the tenant
    // rather than about the request that failed.
    expect(screen.queryByText(d.list.countLabel(0))).not.toBeInTheDocument();
  });

  it('lets the admin retry without leaving the page', async () => {
    const user = userEvent.setup();
    mockAdminEvents.list.mockRejectedValueOnce(new Error('network down'));
    mockAdminEvents.list.mockResolvedValue({
      data: [makeEvent()],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<AdminEventsPage />);
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: d.list.retry }));
    await waitFor(() => expect(screen.getByText('Seminário de outubro')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces the load in progress rather than showing a bare page', async () => {
    let release: (() => void) | undefined;
    mockAdminEvents.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: [], total: 0, limit: 50, offset: 0 });
        }),
    );

    render(<AdminEventsPage />);

    expect(screen.getByRole('status')).toHaveTextContent(d.list.loading);
    release?.();
    await waitFor(() => expect(screen.getByText(d.list.emptyTitle)).toBeInTheDocument());
  });
});
