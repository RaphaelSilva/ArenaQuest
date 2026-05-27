'use client';

import { useState, type FormEvent } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { AccountApiError } from '@web/lib/account-api';

const LockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="3" y="6.5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5 6.5V4.5a2.5 2.5 0 015 0V6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const EyeIcon = ({ off }: { off: boolean }) =>
  off ? (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M2 2l11 11M6.3 6.4A2 2 0 019.6 9.7M4 4.5C2.5 5.7 1.5 7.5 1.5 7.5S4 12 7.5 12c1.2 0 2.3-.4 3.2-1M6 3.2C6.5 3.1 7 3 7.5 3c3.5 0 6 4.5 6 4.5s-.5 1-1.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M1.5 7.5S4 3 7.5 3 13.5 7.5 13.5 7.5 11 12 7.5 12 1.5 7.5 1.5 7.5z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );

const AlertIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.1" />
    <path d="M5.5 3.5v2.5M5.5 7.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const s = {
  inputWrap: { position: 'relative' as const, display: 'flex', alignItems: 'center' },
  inputIcon: { position: 'absolute' as const, left: 13, color: 'var(--aq-text3)', display: 'flex', alignItems: 'center', pointerEvents: 'none' as const },
  input: { width: '100%', padding: '11px 16px 11px 40px', background: 'var(--aq-bg3)', border: '1px solid var(--aq-border2)', borderRadius: 10, outline: 'none', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', fontSize: 14, color: 'var(--aq-text)', caretColor: 'var(--aq-accent)' },
  inputError: { borderColor: 'var(--aq-error)', boxShadow: '0 0 0 3px var(--aq-error-bg)' },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: 'var(--aq-text2)', letterSpacing: '0.3px', marginBottom: 6, display: 'block' },
  fieldError: { fontSize: 11, color: 'var(--aq-error)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 },
};

function Toast({ message, onDismiss, closeLabel }: { message: string; onDismiss: () => void; closeLabel: string }) {
  return (
    <div
      role="status"
      style={{ position: 'fixed', bottom: 28, right: 28, zIndex: 100, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderRadius: 10, background: 'var(--aq-accent)', color: '#0B0E17', fontWeight: 600, fontSize: 14, boxShadow: '0 8px 32px oklch(0.74 0.19 52 / 0.4)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif' }}
    >
      {message}
      <button
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0B0E17', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 4, opacity: 0.7 }}
        aria-label={closeLabel}
      >
        ×
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const dict = useDict();
  const client = useApiClient();

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ currentPw?: string; newPw?: string; confirmPw?: string }>({});

  function validate(): boolean {
    const errs: typeof fieldErrors = {};
    if (!currentPw) errs.currentPw = dict.settings.changePassword.errorRequired;
    if (!newPw) errs.newPw = dict.settings.changePassword.errorRequired;
    else if (newPw.length < 8) errs.newPw = dict.settings.changePassword.errorMinLength;
    else if (!/\d/.test(newPw)) errs.newPw = dict.settings.changePassword.errorNoDigit;
    if (!confirmPw) errs.confirmPw = dict.settings.changePassword.errorRequired;
    else if (newPw !== confirmPw) errs.confirmPw = dict.settings.changePassword.errorMismatch;
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;
    setGeneralError('');
    setLoading(true);
    try {
      await client.account.changePassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setToast(dict.settings.changePassword.successToast);
    } catch (err) {
      if (err instanceof AccountApiError && err.code === 'InvalidCurrentPassword') {
        setFieldErrors({ currentPw: dict.settings.changePassword.errorCurrentInvalid });
      } else {
        setGeneralError(dict.settings.changePassword.errorGeneral);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', color: 'var(--aq-text)' }}>
      <h1 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: '-0.4px', marginBottom: 8 }}>
        {dict.settings.title}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--aq-text3)', marginBottom: 36 }}>
        {dict.settings.subtitle}
      </p>

      <div style={{ background: 'var(--aq-bg2)', border: '1px solid var(--aq-border)', borderRadius: 14, padding: '28px 28px' }}>
        <h2 style={{ fontFamily: 'var(--font-space-grotesk)', fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
          {dict.settings.changePassword.title}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--aq-text3)', marginBottom: 24 }}>
          {dict.settings.changePassword.subtitle}
        </p>

        {generalError && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 9, background: 'var(--aq-error-bg)', border: '1px solid oklch(0.65 0.22 15 / 0.3)', marginBottom: 18, fontSize: 13, color: 'var(--aq-error)' }}>
            <AlertIcon /> {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
            <div>
              <label htmlFor="current-password" style={s.fieldLabel}>{dict.settings.changePassword.currentPasswordLabel}</label>
              <div style={s.inputWrap}>
                <span style={s.inputIcon}><LockIcon /></span>
                <input
                  id="current-password"
                  type={showPw ? 'text' : 'password'}
                  placeholder={dict.settings.changePassword.currentPasswordPlaceholder}
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  autoComplete="current-password"
                  style={{ ...s.input, paddingRight: 40, ...(fieldErrors.currentPw ? s.inputError : {}) }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--aq-text3)', display: 'flex', alignItems: 'center' }}
                  aria-label={showPw ? dict.settings.changePassword.hidePassword : dict.settings.changePassword.showPassword}
                >
                  <EyeIcon off={showPw} />
                </button>
              </div>
              {fieldErrors.currentPw && <div style={s.fieldError}><AlertIcon />{fieldErrors.currentPw}</div>}
            </div>

            <div>
              <label htmlFor="settings-new-password" style={s.fieldLabel}>{dict.settings.changePassword.newPasswordLabel}</label>
              <div style={s.inputWrap}>
                <span style={s.inputIcon}><LockIcon /></span>
                <input
                  id="settings-new-password"
                  type={showPw ? 'text' : 'password'}
                  placeholder={dict.settings.changePassword.newPasswordPlaceholder}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  autoComplete="new-password"
                  style={{ ...s.input, ...(fieldErrors.newPw ? s.inputError : {}) }}
                />
              </div>
              {fieldErrors.newPw && <div style={s.fieldError}><AlertIcon />{fieldErrors.newPw}</div>}
            </div>

            <div>
              <label htmlFor="settings-confirm-password" style={s.fieldLabel}>{dict.settings.changePassword.confirmPasswordLabel}</label>
              <div style={s.inputWrap}>
                <span style={s.inputIcon}><LockIcon /></span>
                <input
                  id="settings-confirm-password"
                  type={showPw ? 'text' : 'password'}
                  placeholder={dict.settings.changePassword.confirmPasswordPlaceholder}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  autoComplete="new-password"
                  style={{ ...s.input, ...(fieldErrors.confirmPw ? s.inputError : {}) }}
                />
              </div>
              {fieldErrors.confirmPw && <div style={s.fieldError}><AlertIcon />{fieldErrors.confirmPw}</div>}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ padding: '11px 24px', borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}
          >
            {loading ? dict.settings.changePassword.loadingButton : dict.settings.changePassword.submitButton}
          </button>
        </form>
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast('')} closeLabel={dict.settings.changePassword.closeToast} />}
    </div>
  );
}
