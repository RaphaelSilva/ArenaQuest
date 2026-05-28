import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Entities } from '@arenaquest/shared/types/entities';
import { dictPt } from '@web/i18n';

const d = dictPt.admin.users;

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

// ---------------------------------------------------------------------------
// Mock useAuth hook
// ---------------------------------------------------------------------------

const mockUseAuth = vi.fn();
const mockUseHasRole = vi.fn();

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
  useHasRole: (...roles: string[]) => mockUseHasRole(...roles),
}));

// ---------------------------------------------------------------------------
// Mock useApiClient hook
// ---------------------------------------------------------------------------

const mockAdminUsers = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deactivate: vi.fn(),
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({
      adminUsers: mockAdminUsers,
    }),
  };
});

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import AdminUsersPage from '@web/app/(protected)/admin/users/page';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<Entities.Identity.User> = {}): Entities.Identity.User {
  return {
    id: 'user-1',
    name: 'Alice Admin',
    email: 'alice@example.com',
    status: 'active' as Entities.Config.UserStatus,
    roles: [{ id: 'role-admin', name: 'admin', description: 'Admin', createdAt: new Date() }],
    groups: [],
    timezone: '',
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

const MOCK_USERS = [
  makeUser(),
  makeUser({
    id: 'user-2',
    name: 'Bob Student',
    email: 'bob@example.com',
    roles: [{ id: 'role-student', name: 'student', description: 'Student', createdAt: new Date() }],
  }),
];

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function setupAdminContext() {
  mockUseAuth.mockReturnValue({
    user: MOCK_USERS[0],
    accessToken: 'mock-token',
    isLoading: false,
  });
  mockUseHasRole.mockReturnValue(true);
}

function setupStudentContext() {
  mockUseAuth.mockReturnValue({
    user: MOCK_USERS[1],
    accessToken: 'mock-token',
    isLoading: false,
  });
  mockUseHasRole.mockReturnValue(false);
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  mockAdminUsers.list.mockResolvedValue({ data: MOCK_USERS, total: 2 });
  mockAdminUsers.create.mockResolvedValue(makeUser({ id: 'user-3', name: 'New User', email: 'new@example.com' }));
  mockAdminUsers.update.mockResolvedValue(MOCK_USERS[0]);
  mockAdminUsers.deactivate.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

describe('AdminUsersPage — table', () => {
  it('renders the user table with data from the API', async () => {
    setupAdminContext();
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      expect(screen.getByText('Bob Student')).toBeInTheDocument();
    });

    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('renders the correct table headers', async () => {
    setupAdminContext();
    render(<AdminUsersPage />);

    await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument());

    expect(screen.getByText(new RegExp(d.table.nameHeader, 'i'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(d.table.emailHeader, 'i'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(d.table.rolesHeader, 'i'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(d.table.statusHeader, 'i'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(d.table.createdAtHeader, 'i'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(d.table.actionsHeader, 'i'))).toBeInTheDocument();
  });

  it('calls adminUsers.list on mount', async () => {
    setupAdminContext();
    render(<AdminUsersPage />);

    await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalled());
  });

  it('shows "No users found" when list is empty', async () => {
    setupAdminContext();
    mockAdminUsers.list.mockResolvedValue({ data: [], total: 0 });
    render(<AdminUsersPage />);

    await waitFor(() => expect(screen.getByText(new RegExp(d.table.emptyMessage, 'i'))).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Create User
// ---------------------------------------------------------------------------

describe('AdminUsersPage — Create User', () => {
  it('opens the Create User form when the button is clicked', async () => {
    setupAdminContext();
    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: new RegExp(d.createButton, 'i') }));

    expect(screen.getByRole('dialog', { name: new RegExp(d.form.createTitle, 'i') })).toBeInTheDocument();
  });

  it('calls adminUsersApi.create with the correct args on form submission', async () => {
    setupAdminContext();
    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: new RegExp(d.createButton, 'i') }));

    const dialog = screen.getByRole('dialog', { name: new RegExp(d.form.createTitle, 'i') });
    await user.type(within(dialog).getByLabelText(new RegExp(d.form.nameLabel, 'i')), 'New User');
    await user.type(within(dialog).getByLabelText(new RegExp(d.form.emailLabel, 'i')), 'new@example.com');
    await user.type(within(dialog).getByLabelText(new RegExp(d.form.passwordLabel, 'i')), 'password123');

    await user.click(within(dialog).getByRole('button', { name: new RegExp(d.form.createButton, 'i') }));

    await waitFor(() => {
      expect(mockAdminUsers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New User',
          email: 'new@example.com',
          password: 'password123',
        }),
      );
    });
  });

  it('shows a validation error when required fields are empty', async () => {
    setupAdminContext();
    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: new RegExp(d.createButton, 'i') }));

    const dialog = screen.getByRole('dialog', { name: new RegExp(d.form.createTitle, 'i') });
    await user.click(within(dialog).getByRole('button', { name: new RegExp(d.form.createButton, 'i') }));

    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toBeInTheDocument();
    });
    expect(mockAdminUsers.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Non-admin redirect
// ---------------------------------------------------------------------------

describe('AdminUsersPage — RBAC guard', () => {
  it('redirects to /dashboard when user is not an admin', async () => {
    setupStudentContext();
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
    expect(mockAdminUsers.list).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------

describe('AdminUsersPage — Deactivate', () => {
  it('calls adminUsersApi.deactivate after confirming the dialog', async () => {
    setupAdminContext();
    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument());

    const deactivateButtons = screen.getAllByRole('button', { name: new RegExp(d.actions.deactivate, 'i') });
    await user.click(deactivateButtons[0]);

    const dialog = screen.getByRole('dialog', { name: /confirm action/i });
    await user.click(within(dialog).getByRole('button', { name: new RegExp(d.confirm.confirmButton, 'i') }));

    await waitFor(() => {
      expect(mockAdminUsers.deactivate).toHaveBeenCalledWith('user-1');
    });
  });
});
