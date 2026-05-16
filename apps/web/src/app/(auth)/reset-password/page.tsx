'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi, AuthApiError } from '@web/lib/auth-api';
import { Spinner } from '@web/components/spinner';
import { Logo } from '@web/components/design-system';

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

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ newPw?: string; confirmPw?: string }>({});

  if (!token) {
    return (
      <div className="aq-anim">
        <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', borderRadius: 9, background: 'var(--aq-error-bg)', border: '1px solid oklch(0.65 0.22 15 / 0.3)', marginBottom: 24, fontSize: 13, color: 'var(--aq-error)' }}>
          <AlertIcon /> Link inválido. Solicite um novo link de redefinição.
        </div>
        <Link
          href="/forgot-password"
          style={{ display: 'block', width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', textDecoration: 'none', textAlign: 'center' }}
        >
          Solicitar novo link
        </Link>
      </div>
    );
  }

  function validate(): boolean {
    const errs: { newPw?: string; confirmPw?: string } = {};
    if (!newPw) errs.newPw = 'Campo obrigatório';
    else if (newPw.length < 8) errs.newPw = 'Mínimo 8 caracteres';
    else if (!/\d/.test(newPw)) errs.newPw = 'Inclua pelo menos um número';
    if (!confirmPw) errs.confirmPw = 'Campo obrigatório';
    else if (newPw !== confirmPw) errs.confirmPw = 'As senhas não coincidem';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;
    setError('');
    setLoading(true);
    try {
      await authApi.resetPassword(token, newPw);
      router.replace('/login?passwordReset=1');
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'InvalidToken') {
        setError('Este link expirou ou já foi usado. Solicite um novo.');
      } else if (err instanceof AuthApiError && err.code === 'RateLimited') {
        setError('Muitas tentativas. Aguarde alguns minutos.');
      } else {
        setError('Não foi possível redefinir a senha. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="aq-anim">
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
          Nova senha
        </h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.5 }}>
          Escolha uma senha com pelo menos 8 caracteres e um número.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', borderRadius: 9, background: 'var(--aq-error-bg)', border: '1px solid oklch(0.65 0.22 15 / 0.3)', marginBottom: 18, fontSize: 13, color: 'var(--aq-error)' }}>
          <AlertIcon /> {error}
          {(error.includes('expirou') || error.includes('usado')) && (
            <Link href="/forgot-password" style={{ marginLeft: 4, color: 'var(--aq-accent)', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}>Solicitar novo</Link>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          <div>
            <label htmlFor="new-password" style={s.fieldLabel}>Nova senha</label>
            <div style={s.inputWrap}>
              <span style={s.inputIcon}><LockIcon /></span>
              <input
                id="new-password"
                type={showPw ? 'text' : 'password'}
                placeholder="Mínimo 8 caracteres"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                style={{ ...s.input, paddingRight: 40, ...(fieldErrors.newPw ? s.inputError : {}) }}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--aq-text3)', display: 'flex', alignItems: 'center' }}
                aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
              >
                <EyeIcon off={showPw} />
              </button>
            </div>
            {fieldErrors.newPw && <div style={s.fieldError}><AlertIcon />{fieldErrors.newPw}</div>}
          </div>

          <div>
            <label htmlFor="confirm-password" style={s.fieldLabel}>Confirmar senha</label>
            <div style={s.inputWrap}>
              <span style={s.inputIcon}><LockIcon /></span>
              <input
                id="confirm-password"
                type={showPw ? 'text' : 'password'}
                placeholder="Repita a nova senha"
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
          style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}
        >
          {loading ? 'Redefinindo…' : 'Redefinir senha'}
        </button>
      </form>

      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--aq-text3)', marginTop: 24 }}>
        <Link href="/login" style={{ color: 'var(--aq-accent)', textDecoration: 'none', fontWeight: 500 }}>
          ← Voltar ao login
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)' }}><Spinner className="h-8 w-8" /></div>}>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)', color: 'var(--aq-text)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 420, background: 'var(--aq-bg2)', borderRadius: 16, border: '1px solid var(--aq-border)', padding: '40px 40px' }}>
          <Logo className="mb-9" />
          <ResetPasswordInner />
        </div>
      </div>
    </Suspense>
  );
}
