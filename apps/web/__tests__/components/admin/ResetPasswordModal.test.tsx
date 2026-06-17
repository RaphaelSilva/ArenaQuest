import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Entities } from '@arenaquest/shared/types/entities';
import { ResetPasswordModal } from '@web/components/admin/ResetPasswordModal';
import { dictPt } from '@web/i18n';

// ---------------------------------------------------------------------------
// Mock useApiClient hook
// ---------------------------------------------------------------------------

const mockAdminUsers = vi.hoisted(() => ({
  resetPassword: vi.fn(),
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
// Mock navigator.clipboard (will be set in each test)
// ---------------------------------------------------------------------------

const mockClipboardWriteText = vi.fn();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<Entities.Identity.User> = {}): Entities.Identity.User {
  return {
    id: 'user-1',
    name: 'Bob Student',
    email: 'bob@example.com',
    status: 'active' as Entities.Config.UserStatus,
    roles: [{ id: 'role-student', name: 'student', description: 'Student', createdAt: new Date() }],
    groups: [],
    timezone: '',
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

const MOCK_USER = makeUser();

const MOCK_RESET_RESPONSE = {
  userId: MOCK_USER.id,
  temporaryPassword: 'temp-password-123456',
  emailSent: false,
  resetAt: new Date().toISOString(),
};

const d = dictPt.admin.users.resetPasswordModal;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResetPasswordModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminUsers.resetPassword.mockClear();
    mockClipboardWriteText.mockClear();
  });

  describe('confirmation phase', () => {
    it('renders confirmation dialog with user name', () => {
      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByText(new RegExp(d.confirmTitle(MOCK_USER.name), 'i'))).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(d.confirmMessage, 'i'))
      ).toBeInTheDocument();
    });

    it('renders email checkbox and note field', () => {
      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const emailCheckbox = screen.getByLabelText(new RegExp(d.sendEmailLabel, 'i'));
      expect(emailCheckbox).toBeInTheDocument();
      expect(emailCheckbox).not.toBeChecked();

      const noteField = screen.getByLabelText(new RegExp(d.noteLabel, 'i'));
      expect(noteField).toBeInTheDocument();
    });

    it('closes modal on cancel button click', async () => {
      const user = userEvent.setup();
      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const cancelButton = screen.getByRole('button', { name: new RegExp(d.cancelButton, 'i') });
      await user.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('closes modal on Escape key press', async () => {
      const user = userEvent.setup();
      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      await user.keyboard('{Escape}');
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('toggles email checkbox on click', async () => {
      const user = userEvent.setup();
      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const emailCheckbox = screen.getByLabelText(new RegExp(d.sendEmailLabel, 'i'));
      expect(emailCheckbox).not.toBeChecked();

      await user.click(emailCheckbox);
      expect(emailCheckbox).toBeChecked();

      await user.click(emailCheckbox);
      expect(emailCheckbox).not.toBeChecked();
    });

    it('accepts input in note field and enforces 500 char limit', async () => {
      const user = userEvent.setup();
      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const noteField = screen.getByLabelText(new RegExp(d.noteLabel, 'i')) as HTMLTextAreaElement;
      const longText = 'a'.repeat(600);
      await user.type(noteField, longText);

      expect(noteField.value).toHaveLength(500);
      expect(screen.getByText(new RegExp(d.noteCharCount(500), 'i'))).toBeInTheDocument();
      // Typing 600 chars re-renders the controlled textarea 600× (~1.5s on its own); give
      // generous headroom so parallel-suite CPU contention can't push it past the timeout.
    }, 15000);

    it('calls API with correct payload on confirm', async () => {
      const user = userEvent.setup();
      mockAdminUsers.resetPassword.mockResolvedValueOnce(MOCK_RESET_RESPONSE);

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const emailCheckbox = screen.getByLabelText(new RegExp(d.sendEmailLabel, 'i'));
      const noteField = screen.getByLabelText(new RegExp(d.noteLabel, 'i'));
      const confirmButton = screen.getByRole('button', { name: new RegExp(d.confirmButton, 'i') });

      await user.click(emailCheckbox);
      await user.type(noteField, 'Test note');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(mockAdminUsers.resetPassword).toHaveBeenCalledWith(MOCK_USER.id, {
          sendEmail: true,
          adminNote: 'Test note',
        });
      });
    });

    it('sends API call without adminNote when empty', async () => {
      const user = userEvent.setup();
      mockAdminUsers.resetPassword.mockResolvedValueOnce(MOCK_RESET_RESPONSE);

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const confirmButton = screen.getByRole('button', { name: new RegExp(d.confirmButton, 'i') });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(mockAdminUsers.resetPassword).toHaveBeenCalledWith(MOCK_USER.id, {
          sendEmail: false,
          adminNote: undefined,
        });
      });
    });
  });

  describe('loading phase', () => {
    it('shows loading spinner during API call', async () => {
      const user = userEvent.setup();
      mockAdminUsers.resetPassword.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(MOCK_RESET_RESPONSE), 100))
      );

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const confirmButton = screen.getByRole('button', { name: new RegExp(d.confirmButton, 'i') });
      await user.click(confirmButton);

      expect(screen.getByText(new RegExp(d.loadingMessage, 'i'))).toBeInTheDocument();
    });
  });

  describe('success phase', () => {
    it('displays temporary password after successful reset', async () => {
      const user = userEvent.setup();
      mockAdminUsers.resetPassword.mockResolvedValueOnce(MOCK_RESET_RESPONSE);

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const confirmButton = screen.getByRole('button', { name: new RegExp(d.confirmButton, 'i') });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(new RegExp(d.successTitle, 'i'))).toBeInTheDocument();
        expect(screen.getByText(MOCK_RESET_RESPONSE.temporaryPassword)).toBeInTheDocument();
      });
    });

    it('shows copy button in success modal', async () => {
      const user = userEvent.setup();
      mockAdminUsers.resetPassword.mockResolvedValueOnce(MOCK_RESET_RESPONSE);

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const confirmButton = screen.getByRole('button', { name: new RegExp(d.confirmButton, 'i') });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: new RegExp(d.copyButton, 'i') })).toBeInTheDocument();
      });
    });

    it('calls onSuccess and onClose when close button clicked', async () => {
      const user = userEvent.setup();
      mockAdminUsers.resetPassword.mockResolvedValueOnce(MOCK_RESET_RESPONSE);

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const confirmButton = screen.getByRole('button', { name: new RegExp(d.confirmButton, 'i') });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: new RegExp(d.closeButton, 'i') })).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: new RegExp(d.closeButton, 'i') });
      await user.click(closeButton);

      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('shows error modal on API failure', async () => {
      const user = userEvent.setup();
      const error = new Error('API Error') as Error & { status?: number };
      error.status = 500;
      mockAdminUsers.resetPassword.mockRejectedValueOnce(error);

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const confirmButton = screen.getByRole('button', { name: new RegExp(`^${d.confirmButton}$`, 'i') });
      await user.click(confirmButton);

      // Wait for error state to appear
      await waitFor(() => {
        expect(screen.getByText(new RegExp(d.failedTitle, 'i'))).toBeInTheDocument();
      });

      // Error modal should have Cancel and Retry buttons
      expect(screen.getByRole('button', { name: new RegExp(`^${d.cancelButton}$`, 'i') })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: new RegExp(`^${d.retryButton}$`, 'i') })).toBeInTheDocument();
    });

    it('displays specific error message for 403 Forbidden', async () => {
      const user = userEvent.setup();
      const error = new Error('Forbidden') as Error & { status?: number };
      error.status = 403;
      mockAdminUsers.resetPassword.mockRejectedValueOnce(error);

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const confirmButton = screen.getByRole('button', { name: new RegExp(`^${d.confirmButton}$`, 'i') });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(new RegExp(d.failedTitle, 'i'))).toBeInTheDocument();
      });

      // The error message should be shown in the modal
      expect(screen.getByText(new RegExp(d.errorPermission, 'i'))).toBeInTheDocument();
    });

    it('displays specific error message for 404 Not Found', async () => {
      const user = userEvent.setup();
      const error = new Error('Not Found') as Error & { status?: number };
      error.status = 404;
      mockAdminUsers.resetPassword.mockRejectedValueOnce(error);

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const confirmButton = screen.getByRole('button', { name: new RegExp(`^${d.confirmButton}$`, 'i') });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(new RegExp(d.errorNotFound, 'i'))).toBeInTheDocument();
      });
    });

    it('displays specific error message for 422 Self-Reset', async () => {
      const user = userEvent.setup();
      const error = new Error('Self Reset Not Allowed') as Error & { status?: number };
      error.status = 422;
      mockAdminUsers.resetPassword.mockRejectedValueOnce(error);

      render(
        <ResetPasswordModal
          user={MOCK_USER}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const confirmButton = screen.getByRole('button', { name: new RegExp(`^${d.confirmButton}$`, 'i') });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(new RegExp(d.errorSelfReset, 'i'))).toBeInTheDocument();
      });
    });
  });
});
