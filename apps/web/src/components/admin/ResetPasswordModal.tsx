'use client';

import { useState, useCallback, useEffect } from 'react';
import { useApiClient } from '@web/context/auth-context';
import type { Entities } from '@arenaquest/shared/types/entities';
import type { ResetPasswordInput } from '@web/lib/admin-users-api';
import { Spinner } from '@web/components/spinner';
import { useDict } from '@web/context/dict-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = 'confirmation' | 'loading' | 'success' | 'error';

type ResetPasswordModalProps = {
  user: Entities.Identity.User;
  onClose: () => void;
  onSuccess: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResetPasswordModal({
  user,
  onClose,
  onSuccess,
}: ResetPasswordModalProps) {
  const client = useApiClient();
  const dict = useDict();
  const d = dict.admin.users.resetPasswordModal;

  // State management
  const [phase, setPhase] = useState<Phase>('confirmation');
  const [sendEmail, setSendEmail] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);

  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Handle copy to clipboard
  const handleCopyPassword = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select and copy
      const textarea = document.createElement('textarea');
      textarea.value = tempPassword;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [tempPassword]);

  // Handle confirm button
  const handleConfirm = useCallback(async () => {
    setPhase('loading');
    setErrorMessage('');

    try {
      const input: ResetPasswordInput = {
        sendEmail,
        adminNote: adminNote || undefined,
      };

      const response = await client.adminUsers.resetPassword(user.id, input);
      setTempPassword(response.temporaryPassword);
      setPhase('success');
    } catch (err) {
      const error = err as Error & { status?: number };
      let message = d.errorGeneral;

      if (error.status === 403) {
        message = d.errorPermission;
      } else if (error.status === 404) {
        message = d.errorNotFound;
      } else if (error.status === 422) {
        message = d.errorSelfReset;
      } else if (error.status === 500) {
        message = d.errorEmailFailed;
      }

      setErrorMessage(message);
      setPhase('error');
    }
  }, [client, user.id, sendEmail, adminNote, d]);

  // Handle close success modal
  const handleCloseSuccess = useCallback(() => {
    onSuccess();
    onClose();
  }, [onSuccess, onClose]);

  // ---------------------------------------------------------------------------
  // Render confirmation phase
  // ---------------------------------------------------------------------------

  if (phase === 'confirmation') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dict.admin.users.detail.resetPasswordButton}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      >
        <div
          className="w-full max-w-sm rounded-xl p-6 shadow-xl"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <h2 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text)' }}>
            {d.confirmTitle(user.name)}
          </h2>

          <p className="mb-4 text-sm" style={{ color: 'var(--text2)' }}>
            {d.confirmMessage}
          </p>

          <label className="mb-4 flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              aria-label={d.sendEmailLabel}
            />
            <span className="text-sm">{d.sendEmailLabel}</span>
          </label>

          <div className="mb-6">
            <label
              htmlFor="admin-note"
              className="mb-2 block text-sm font-medium"
              style={{ color: 'var(--text3)' }}
            >
              {d.noteLabel}
            </label>
            <textarea
              id="admin-note"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value.slice(0, 500))}
              placeholder={d.notePlaceholder}
              maxLength={500}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg2)',
                color: 'var(--text)',
              }}
              rows={3}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
              {d.noteCharCount(adminNote.length)}
            </p>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm transition-colors"
              style={{ color: 'var(--text2)' }}
            >
              {d.cancelButton}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
              style={{ background: 'var(--accent)' }}
            >
              {d.confirmButton}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render loading phase
  // ---------------------------------------------------------------------------

  if (phase === 'loading') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={d.loadingMessage}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      >
        <div
          className="flex w-full max-w-sm flex-col items-center rounded-xl p-6 shadow-xl"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <Spinner className="mb-4 h-6 w-6 text-zinc-400" />
          <p style={{ color: 'var(--text2)' }}>{d.loadingMessage}</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render success phase
  // ---------------------------------------------------------------------------

  if (phase === 'success') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={d.successTitle}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      >
        <div
          className="w-full max-w-sm rounded-xl p-6 shadow-xl"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text)' }}>
            {d.successTitle}
          </h2>

          <p className="mb-4 text-sm" style={{ color: 'var(--text2)' }}>
            {d.successMessage}
          </p>

          <div
            className="mb-4 rounded-lg border p-4 font-mono text-sm break-all"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg2)',
              color: 'var(--text)',
            }}
          >
            {tempPassword}
          </div>

          <button
            type="button"
            onClick={handleCopyPassword}
            className="mb-4 w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              background: 'var(--accent)',
              color: '#0B0E17',
            }}
          >
            {copied ? d.copiedButton : d.copyButton}
          </button>

          <button
            type="button"
            onClick={handleCloseSuccess}
            className="w-full rounded-lg px-4 py-2 text-sm transition-colors"
            style={{ background: 'var(--bg2)', color: 'var(--text2)' }}
          >
            {d.closeButton}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render error phase
  // ---------------------------------------------------------------------------

  if (phase === 'error') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={d.failedTitle}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      >
        <div
          className="w-full max-w-sm rounded-xl p-6 shadow-xl"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--error)' }}>
            {d.failedTitle}
          </h2>

          <p className="mb-4 text-sm" style={{ color: 'var(--text)' }}>
            {errorMessage}
          </p>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setPhase('confirmation');
                setErrorMessage('');
              }}
              className="rounded-lg px-4 py-2 text-sm transition-colors"
              style={{ color: 'var(--text2)' }}
            >
              {d.cancelButton}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
              style={{ background: 'var(--accent)' }}
            >
              {d.retryButton}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
