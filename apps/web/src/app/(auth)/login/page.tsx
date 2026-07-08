'use client';

import { Suspense, useState, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@web/hooks/use-auth';
import { authApi, AuthApiError, type ValidationFieldError } from '@web/lib/auth-api';
import { Spinner } from '@web/components/spinner';
import { HeroPanel } from '@web/components/auth/hero-panel';
import { AuthTabs } from '@web/components/auth/auth-tabs';
import { PasswordStrength } from '@web/components/auth/password-strength';
import { RoleSelect } from '@web/components/auth/role-select';
import { RegisterSuccess } from '@web/components/auth/register-success';
import { useDict } from '@web/context/dict-context';
import type { Dictionary } from '@web/i18n';

const PENDING_ACTIVATION_STORAGE_KEY = 'aq_pending_activation_email';

// ─── Icons ────────────────────────────────────────────────────────────────────

const MailIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="1.5" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M1.5 5l6 4 6-4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

const LockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="3" y="6.5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5 6.5V4.5a2.5 2.5 0 015 0V6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const UserIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <circle cx="7.5" cy="5" r="3" stroke="currentColor" strokeWidth="1.2" />
    <path d="M2 13c0-3.5 2.5-5.5 5.5-5.5S13 9.5 13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const EyeIcon = ({ off }: { off: boolean }) =>
  off ? (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M2 2l11 11M6.3 6.4A2 2 0 009.6 9.7M4 4.5C2.5 5.7 1.5 7.5 1.5 7.5S4 12 7.5 12c1.2 0 2.3-.4 3.2-1M6 3.2C6.5 3.1 7 3 7.5 3c3.5 0 6 4.5 6 4.5s-.5 1-1.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M1.5 7.5S4 3 7.5 3 13.5 7.5 13.5 7.5 11 12 7.5 12 1.5 7.5 1.5 7.5z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AlertIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.1" />
    <path d="M5.5 3.5v2.5M5.5 7.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const GoogleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 48 48" fill="none">
    <path d="M44.5 20H24v8.5h11.8C34.5 33 29.8 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3l6-6C34.2 6.2 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-9 20-20 0-1.3-.2-2.7-.5-4z" fill="#FFC107" />
    <path d="M6.3 14.7l7 5.1C15.2 16 19.3 13 24 13c3.1 0 5.9 1.1 8 3l6-6C34.2 6.2 29.4 4 24 4 16.1 4 9.3 8.4 6.3 14.7z" fill="#FF3D00" />
    <path d="M24 44c5.2 0 10-2 13.5-5.2l-6.2-5.3C29.3 35.5 26.8 36 24 36c-5.7 0-10.5-3.8-12.2-9.1l-7 5.4C8.5 39.3 15.7 44 24 44z" fill="#4CAF50" />
    <path d="M44.5 20H24v8.5h11.8c-.8 2.3-2.3 4.2-4.3 5.5l6.2 5.3C41.5 36 44 30.5 44 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2" />
  </svg>
);

// ─── Shared style primitives ───────────────────────────────────────────────────

const s = {
  inputWrap: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute' as const,
    left: 13,
    color: 'var(--aq-text3)',
    display: 'flex',
    alignItems: 'center',
    pointerEvents: 'none' as const,
  },
  input: {
    width: '100%',
    padding: '11px 16px 11px 40px',
    background: 'var(--aq-bg3)',
    border: '1px solid var(--aq-border2)',
    borderRadius: 10,
    outline: 'none',
    fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
    fontSize: 14,
    color: 'var(--aq-text)',
    caretColor: 'var(--aq-accent)',
  },
  inputError: {
    borderColor: 'var(--aq-error)',
    boxShadow: '0 0 0 3px var(--aq-error-bg)',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--aq-text2)',
    letterSpacing: '0.3px',
    marginBottom: 6,
    display: 'block',
  },
  fieldError: {
    fontSize: 11,
    color: 'var(--aq-error)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
};

// ─── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const { login } = useAuth();
  const router = useRouter();
  const dict = useDict();
  const d = dict.auth.login;
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email) { setError(d.errorEmailRequired); return; }
    if (!pw) { setError(d.errorPasswordRequired); return; }
    setError('');
    setLoading(true);
    try {
      await login(email, pw);
      // Successful login — clear any stale "check your email" hint from a
      // prior registration in this browser.
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(PENDING_ACTIVATION_STORAGE_KEY);
      }
      router.replace('/dashboard');
    } catch {
      // We can't tell wrong-password from inactive-account over the wire
      // (anti-enumeration: both collapse to 401 InvalidCredentials). The
      // localStorage hint, set on this browser when the user just
      // registered, lets us upgrade the message in that one specific
      // case without leaking account existence to anyone else.
      const pendingEmail =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(PENDING_ACTIVATION_STORAGE_KEY)
          : null;
      if (pendingEmail && pendingEmail === email.trim().toLowerCase()) {
        setError(d.errorCheckEmail);
      } else {
        setError(d.errorInvalidCredentials);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="aq-anim">
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
          {d.title}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.5 }}>
          {d.subtitle}
        </p>
      </div>

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 9, background: 'var(--aq-error-bg)', border: '1px solid oklch(0.65 0.22 15 / 0.3)', marginBottom: 18, fontSize: 13, color: 'var(--aq-error)' }}>
          <AlertIcon /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          <div>
            <label htmlFor="login-email" style={s.fieldLabel}>{d.emailLabel}</label>
            <div style={s.inputWrap}>
              <span style={s.inputIcon}><MailIcon /></span>
              <input
                id="login-email"
                type="email"
                placeholder={d.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                style={s.input}
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" style={s.fieldLabel}>{d.passwordLabel}</label>
            <div style={s.inputWrap}>
              <span style={s.inputIcon}><LockIcon /></span>
              <input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="current-password"
                style={{ ...s.input, paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--aq-text3)', display: 'flex', alignItems: 'center' }}
              >
                <EyeIcon off={showPw} />
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <label
            onClick={() => setRememberMe(!rememberMe)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--aq-text3)', cursor: 'pointer', userSelect: 'none' }}
          >
            <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${rememberMe ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: rememberMe ? 'var(--aq-accent)' : 'var(--aq-bg3)', transition: 'all 0.2s' }}>
              {rememberMe && <CheckIcon />}
            </div>
            {d.rememberMe}
          </label>
          <Link href="/forgot-password" style={{ fontSize: 12, color: 'var(--aq-accent)', textDecoration: 'none', fontWeight: 500 }}>
            {d.forgotPassword}
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={loading ? 'aq-submit-btn-loading' : ''}
          style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', position: 'relative', overflow: 'hidden', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', letterSpacing: '0.2px', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}
        >
          {loading ? d.loadingButton : d.submitButton}
        </button>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--aq-text3)', margin: '20px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--aq-border)' }} />
        {d.orContinueWith}
        <div style={{ flex: 1, height: 1, background: 'var(--aq-border)' }} />
      </div>

      <a
        href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}/v1/auth/google`}
        style={{ width: '100%', padding: 11, borderRadius: 10, border: '1px solid var(--aq-border2)', background: 'var(--aq-bg3)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', fontSize: 13, fontWeight: 500, color: 'var(--aq-text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'all 0.2s', textDecoration: 'none' }}
      >
        <GoogleIcon /> {d.googleButton}
      </a>

      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--aq-text3)', marginTop: 24 }}>
        {d.noAccount}{' '}
        <button onClick={onSwitch} style={{ color: 'var(--aq-accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif' }}>
          {d.createAccountLink}
        </button>
      </div>
    </div>
  );
}

// ─── Register form ─────────────────────────────────────────────────────────────

type RegisterErrors = Partial<Record<'firstName' | 'email' | 'pw' | 'pwConfirm' | 'terms', string>>;

/**
 * Map the API's `{ field, code }` validation errors back onto the local
 * RegisterErrors shape. The API speaks `name`/`email`/`password`; the
 * form's first-step inputs are `firstName`/`email`/`pw`. `code` carries
 * a stable identifier (TooShort, TooLong, Invalid, NoDigit) that we
 * translate into copy from the dictionary.
 */
function mapApiErrorsToFields(
  fields: ValidationFieldError[],
  d: Dictionary['auth']['register'],
): RegisterErrors {
  const next: RegisterErrors = {};
  for (const f of fields) {
    if (f.field === 'name') {
      next.firstName =
        f.code === 'TooShort' ? d.errorNameTooShort :
        f.code === 'TooLong'  ? d.errorNameTooLong :
                                d.errorNameInvalid;
    } else if (f.field === 'email') {
      next.email = d.errorEmailInvalid;
    } else if (f.field === 'password') {
      next.pw =
        f.code === 'TooShort' ? d.errorPasswordMinLength :
        f.code === 'NoDigit'  ? d.errorPasswordNoDigit :
                                d.errorPasswordInvalid;
    }
  }
  return next;
}

function RegisterForm({ onSwitch, onSuccess }: { onSwitch: () => void; onSuccess: (email: string) => void }) {
  const dict = useDict();
  const d = dict.auth.register;
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<'participant' | 'instructor'>('participant');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [loading, setLoading] = useState(false);

  function validateStep1(): boolean {
    const e: RegisterErrors = {};
    if (!firstName.trim()) e.firstName = d.errorRequired;
    if (!email.trim()) e.email = d.errorRequired;
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = d.errorEmailInvalid;
    if (!pw) e.pw = d.errorRequired;
    else if (pw.length < 8) e.pw = d.errorPasswordMinLength;
    if (pw !== pwConfirm) e.pwConfirm = d.errorPasswordsMismatch;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleStep1(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (validateStep1()) setStep(2);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!terms) { setErrors({ terms: d.errorTerms }); return; }
    setErrors({});
    setLoading(true);

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const normalizedEmail = email.trim().toLowerCase();

    try {
      await authApi.register({
        name: fullName,
        email: normalizedEmail,
        password: pw,
      });
      // Persist a hint so the LoginForm can show the activation reminder
      // if this same browser then tries to log in before activating.
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PENDING_ACTIVATION_STORAGE_KEY, normalizedEmail);
      }
      onSuccess(normalizedEmail);
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'ValidationFailed' && err.fields) {
        setErrors(mapApiErrorsToFields(err.fields, d));
        // Surface field-level errors at step 1 — bring the user back so
        // they can see the highlighted inputs.
        if (err.fields.some(f => f.field === 'name' || f.field === 'email' || f.field === 'password')) {
          setStep(1);
        }
      } else if (err instanceof AuthApiError && err.code === 'RateLimited') {
        setErrors({ terms: d.errorRateLimited });
      } else {
        setErrors({ terms: d.errorGeneral });
      }
    } finally {
      setLoading(false);
    }
  }

  // Render terms text with embedded links by splitting the template string.
  const [termsBefore, termsRest] = d.termsText.split('{termsLink}');
  const [termsMiddle, termsAfter] = termsRest.split('{privacyLink}');

  const stepIndicator = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
      {([1, 2] as const).map((n) => (
        <span key={n} style={{ display: 'contents' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: step >= n ? 'var(--aq-accent)' : 'var(--aq-bg4)', border: `2px solid ${step >= n ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-space-grotesk)', fontSize: 12, fontWeight: 700, color: step >= n ? '#0B0E17' : 'var(--aq-text3)', transition: 'all 0.3s', flexShrink: 0 }}>
            {step > n ? <CheckIcon /> : n}
          </div>
          <div style={{ fontSize: 12, color: step >= n ? 'var(--aq-text2)' : 'var(--aq-text3)', fontWeight: step === n ? 600 : 400 }}>
            {n === 1 ? d.step1Label : d.step2Label}
          </div>
          {n < 2 && <div style={{ flex: 1, height: 1, background: step > n ? 'var(--aq-accent)' : 'var(--aq-border2)', transition: 'background 0.4s' }} />}
        </span>
      ))}
    </div>
  );

  return (
    <div className="aq-anim">
      {stepIndicator}

      {step === 1 && (
        <div className="aq-anim">
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
              {d.title}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.5 }}>
              {d.subtitle}
            </p>
          </div>

          <form onSubmit={handleStep1} noValidate>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={s.fieldLabel}>{d.firstNameLabel}</label>
                  <div style={s.inputWrap}>
                    <span style={s.inputIcon}><UserIcon /></span>
                    <input type="text" placeholder={d.firstNamePlaceholder} value={firstName} onChange={(e) => setFirstName(e.target.value)} style={{ ...s.input, ...(errors.firstName ? s.inputError : {}) }} />
                  </div>
                  {errors.firstName && <div style={s.fieldError}><AlertIcon />{errors.firstName}</div>}
                </div>
                <div>
                  <label style={s.fieldLabel}>{d.lastNameLabel}</label>
                  <div style={s.inputWrap}>
                    <span style={s.inputIcon}><UserIcon /></span>
                    <input type="text" placeholder={d.lastNamePlaceholder} value={lastName} onChange={(e) => setLastName(e.target.value)} style={s.input} />
                  </div>
                </div>
              </div>

              <div>
                <label style={s.fieldLabel}>{dict.auth.login.emailLabel}</label>
                <div style={s.inputWrap}>
                  <span style={s.inputIcon}><MailIcon /></span>
                  <input type="email" placeholder={dict.auth.login.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...s.input, ...(errors.email ? s.inputError : {}) }} />
                </div>
                {errors.email && <div style={s.fieldError}><AlertIcon />{errors.email}</div>}
              </div>

              <div>
                <label style={s.fieldLabel}>{dict.auth.login.passwordLabel}</label>
                <div style={s.inputWrap}>
                  <span style={s.inputIcon}><LockIcon /></span>
                  <input type={showPw ? 'text' : 'password'} placeholder={d.passwordPlaceholder} value={pw} onChange={(e) => setPw(e.target.value)} style={{ ...s.input, paddingRight: 40, ...(errors.pw ? s.inputError : {}) }} />
                  <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--aq-text3)', display: 'flex', alignItems: 'center' }}>
                    <EyeIcon off={showPw} />
                  </button>
                </div>
                <PasswordStrength password={pw} />
                {errors.pw && <div style={s.fieldError}><AlertIcon />{errors.pw}</div>}
              </div>

              <div>
                <label style={s.fieldLabel}>{d.confirmPasswordLabel}</label>
                <div style={s.inputWrap}>
                  <span style={s.inputIcon}><LockIcon /></span>
                  <input type={showPw ? 'text' : 'password'} placeholder={d.confirmPasswordPlaceholder} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} style={{ ...s.input, ...(errors.pwConfirm ? s.inputError : {}) }} />
                </div>
                {errors.pwConfirm && <div style={s.fieldError}><AlertIcon />{errors.pwConfirm}</div>}
              </div>
            </div>

            <button type="submit" style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)' }}>
              {d.continueButton}
            </button>
          </form>
        </div>
      )}

      {step === 2 && (
        <div className="aq-anim">
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
              {d.accountTypeTitle}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.5 }}>
              {d.accountTypeSubtitle}
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
              <div>
                <label style={s.fieldLabel}>{d.accountTypeLabel}</label>
                <RoleSelect value={role} onChange={setRole} />
              </div>

              <label onClick={() => setTerms(!terms)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, color: 'var(--aq-text3)', cursor: 'pointer', userSelect: 'none' }}>
                <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${terms ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: terms ? 'var(--aq-accent)' : 'var(--aq-bg3)', transition: 'all 0.2s', marginTop: 1 }}>
                  {terms && <CheckIcon />}
                </div>
                <span>
                  {termsBefore}
                  <a href="#" style={{ color: 'var(--aq-accent)', textDecoration: 'none' }}>{d.termsLink}</a>
                  {termsMiddle}
                  <a href="#" style={{ color: 'var(--aq-accent)', textDecoration: 'none' }}>{d.privacyLink}</a>
                  {termsAfter}
                </span>
              </label>
              {errors.terms && <div style={{ ...s.fieldError, marginTop: -8 }}><AlertIcon />{errors.terms}</div>}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setStep(1)} style={{ flexShrink: 0, padding: '13px 18px', borderRadius: 10, border: '1px solid var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text2)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                {d.backButton}
              </button>
              <button
                type="submit"
                disabled={loading}
                className={loading ? 'aq-submit-btn-loading' : ''}
                style={{ flex: 1, padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', position: 'relative', overflow: 'hidden', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', opacity: loading ? 0.5 : 1 }}
              >
                {loading ? d.creatingButton : d.createButton}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--aq-text3)', marginTop: 24 }}>
        {d.hasAccount}{' '}
        <button onClick={onSwitch} style={{ color: 'var(--aq-accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif' }}>
          {d.signInLink}
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

function LoginPageInner() {
  const { isLoading } = useAuth();
  const searchParams = useSearchParams();
  const dict = useDict();
  const d = dict.auth.login;
  const [mode, setMode] = useState<'login' | 'register' | 'pending'>('login');
  const [pendingEmail, setPendingEmail] = useState('');
  // `?activated=1` lands here from the /activate page after a successful
  // activation. Initialize the banner from the URL directly (no
  // synchronous setState in an effect) and schedule dismissal after 6s.
  const initiallyActivated = searchParams?.get('activated') === '1';
  const initiallyPasswordReset = searchParams?.get('passwordReset') === '1';
  const [activatedBannerVisible, setActivatedBannerVisible] = useState(initiallyActivated);
  const [passwordResetBannerVisible, setPasswordResetBannerVisible] = useState(initiallyPasswordReset);

  useEffect(() => {
    if (!initiallyActivated) return;
    const t = setTimeout(() => setActivatedBannerVisible(false), 6000);
    return () => clearTimeout(t);
  }, [initiallyActivated]);

  useEffect(() => {
    if (!initiallyPasswordReset) return;
    const t = setTimeout(() => setPasswordResetBannerVisible(false), 6000);
    return () => clearTimeout(t);
  }, [initiallyPasswordReset]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)' }}>
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media (max-width: 767px) {
          .aq-hero-panel { display: none !important; }
          .aq-auth-panel { width: 100% !important; min-width: 0 !important; border-left: none !important; }
        }
      `}</style>
      <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--aq-bg)', color: 'var(--aq-text)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', position: 'relative', overflow: 'hidden' }}>

        {/* Background geometry */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(-45deg, transparent, transparent 60px, rgba(255,255,255,0.012) 60px, rgba(255,255,255,0.012) 61px)' }} />
          <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, oklch(0.74 0.19 52 / 0.12) 0%, transparent 70%)', top: -200, right: -100 }} />
          <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, oklch(0.65 0.16 240 / 0.10) 0%, transparent 70%)', bottom: -100, left: 200 }} />
        </div>

        <HeroPanel />

        {/* Right panel */}
        <div style={{ width: 480, minWidth: 480, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 48px', background: 'var(--aq-bg2)', borderLeft: '1px solid var(--aq-border)', position: 'relative', zIndex: 1, overflowY: 'auto' }} className="aq-auth-panel">
          {activatedBannerVisible && (
            <div role="status" style={{ marginBottom: 18, padding: '10px 14px', borderRadius: 9, background: 'oklch(0.68 0.17 150 / 0.15)', border: '1px solid var(--aq-accent3)', fontSize: 13, color: 'var(--aq-accent3)' }}>
              {d.activatedBanner}
            </div>
          )}

          {passwordResetBannerVisible && (
            <div role="status" style={{ marginBottom: 18, padding: '10px 14px', borderRadius: 9, background: 'oklch(0.68 0.17 150 / 0.15)', border: '1px solid var(--aq-accent3)', fontSize: 13, color: 'var(--aq-accent3)' }}>
              {d.passwordResetBanner}
            </div>
          )}

          {mode === 'pending' ? (
            <RegisterSuccess email={pendingEmail} onBackToLogin={() => setMode('login')} />
          ) : (
            <>
              <AuthTabs mode={mode === 'login' ? 'login' : 'register'} onChange={setMode} />

              {mode === 'login'
                ? <LoginForm onSwitch={() => setMode('register')} />
                : <RegisterForm
                    onSwitch={() => setMode('login')}
                    onSuccess={(email) => { setPendingEmail(email); setMode('pending'); }}
                  />
              }
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)' }}><Spinner className="h-8 w-8" /></div>}>
      <LoginPageInner />
    </Suspense>
  );
}
