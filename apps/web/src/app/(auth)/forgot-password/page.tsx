'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { authApi, AuthApiError } from '@web/lib/auth-api';
import { Spinner } from '@web/components/spinner';
import { Logo } from '@web/components/design-system';

const MailIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="1.5" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M1.5 5l6 4 6-4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
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
  fieldLabel: { fontSize: 12, fontWeight: 600, color: 'var(--aq-text2)', letterSpacing: '0.3px', marginBottom: 6, display: 'block' },
};

function ForgotPasswordInner() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) { setError('Informe seu e-mail.'); return; }
    setError('');
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim().toLowerCase());
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'RateLimited') {
        setError('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
        setLoading(false);
        return;
      }
    } finally {
      setLoading(false);
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16, padding: '20px 0' }} className="aq-anim">
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'oklch(0.65 0.16 240 / 0.15)', border: '2px solid var(--aq-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
          ✉️
        </div>
        <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700 }}>
          Verifique seu e-mail
        </h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.6, maxWidth: 320 }}>
          Se esse endereço estiver cadastrado, você receberá em breve um link para redefinir sua senha.
        </p>
        <p style={{ fontSize: 12, color: 'var(--aq-text3)', lineHeight: 1.6, maxWidth: 320 }}>
          Não recebeu? Verifique a caixa de spam. O link expira em 1 hora.
        </p>
        <Link
          href="/login"
          style={{ marginTop: 8, width: '100%', display: 'block', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', textDecoration: 'none', textAlign: 'center' }}
        >
          Voltar ao login
        </Link>
      </div>
    );
  }

  return (
    <div className="aq-anim">
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
          Esqueceu a senha?
        </h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.5 }}>
          Informe seu e-mail e enviaremos um link para redefinir sua senha.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 9, background: 'var(--aq-error-bg)', border: '1px solid oklch(0.65 0.22 15 / 0.3)', marginBottom: 18, fontSize: 13, color: 'var(--aq-error)' }}>
          <AlertIcon /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: 20 }}>
          <label htmlFor="forgot-email" style={s.fieldLabel}>E-mail</label>
          <div style={s.inputWrap}>
            <span style={s.inputIcon}><MailIcon /></span>
            <input
              id="forgot-email"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              style={s.input}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}
        >
          {loading ? 'Enviando…' : 'Enviar link de redefinição'}
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

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)' }}><Spinner className="h-8 w-8" /></div>}>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)', color: 'var(--aq-text)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 420, background: 'var(--aq-bg2)', borderRadius: 16, border: '1px solid var(--aq-border)', padding: '40px 40px' }}>
          <Logo className="mb-9" />
          <ForgotPasswordInner />
        </div>
      </div>
    </Suspense>
  );
}
