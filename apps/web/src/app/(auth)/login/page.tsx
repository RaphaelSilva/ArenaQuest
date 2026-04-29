'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';

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

const PhoneIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M3 2h3l1.5 3.5-1.5 1a7.5 7.5 0 004 4l1-1.5L14 10.5V13.5a1 1 0 01-1 1C5.5 14.5 1 9 1 3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
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

// ─── Password strength ─────────────────────────────────────────────────────────

function getStrength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

const STRENGTH_COLORS = [
  'var(--aq-error)',
  'oklch(0.74 0.19 52)',
  'oklch(0.65 0.16 240)',
  'var(--aq-accent3)',
];
const STRENGTH_LABELS = ['Fraca', 'Razoável', 'Boa', 'Forte'];

// ─── Shared primitives ─────────────────────────────────────────────────────────

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
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email) { setError('Informe seu e-mail.'); return; }
    if (!pw) { setError('Informe sua senha.'); return; }
    setError('');
    setLoading(true);
    try {
      await login(email, pw);
      router.replace('/dashboard');
    } catch {
      setError('E-mail ou senha inválidos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="aq-anim">
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
          Bem-vindo de volta
        </h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.5 }}>
          Entre na sua conta para continuar sua jornada.
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
            <label htmlFor="login-email" style={s.fieldLabel}>E-mail</label>
            <div style={s.inputWrap}>
              <span style={s.inputIcon}><MailIcon /></span>
              <input
                id="login-email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                style={s.input}
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" style={s.fieldLabel}>Senha</label>
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
            Lembrar de mim
          </label>
          <a href="#" style={{ fontSize: 12, color: 'var(--aq-accent)', textDecoration: 'none', fontWeight: 500 }}>
            Esqueci a senha
          </a>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={loading ? 'aq-submit-btn-loading' : ''}
          style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', position: 'relative', overflow: 'hidden', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', letterSpacing: '0.2px', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}
        >
          {loading ? 'Entrando…' : 'Entrar na Arena'}
        </button>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--aq-text3)', margin: '20px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--aq-border)' }} />
        ou continue com
        <div style={{ flex: 1, height: 1, background: 'var(--aq-border)' }} />
      </div>

      <button
        type="button"
        onClick={() => {}}
        style={{ width: '100%', padding: 11, borderRadius: 10, border: '1px solid var(--aq-border2)', background: 'var(--aq-bg3)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', fontSize: 13, fontWeight: 500, color: 'var(--aq-text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'all 0.2s' }}
      >
        <GoogleIcon /> Entrar com Google
      </button>

      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--aq-text3)', marginTop: 24 }}>
        Não tem conta?{' '}
        <button onClick={onSwitch} style={{ color: 'var(--aq-accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif' }}>
          Criar conta grátis
        </button>
      </div>
    </div>
  );
}

// ─── Register form ─────────────────────────────────────────────────────────────

type RegisterErrors = Partial<Record<'firstName' | 'email' | 'pw' | 'pwConfirm' | 'terms', string>>;

function RegisterForm({ onSwitch, onSuccess }: { onSwitch: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<'participant' | 'instructor'>('participant');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [loading, setLoading] = useState(false);
  const strength = getStrength(pw);

  function validateStep1(): boolean {
    const e: RegisterErrors = {};
    if (!firstName.trim()) e.firstName = 'Campo obrigatório';
    if (!email.trim()) e.email = 'Campo obrigatório';
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'E-mail inválido';
    if (!pw) e.pw = 'Campo obrigatório';
    else if (pw.length < 8) e.pw = 'Mínimo 8 caracteres';
    if (pw !== pwConfirm) e.pwConfirm = 'Senhas não coincidem';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleStep1(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (validateStep1()) setStep(2);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!terms) { setErrors({ terms: 'Aceite os termos para continuar' }); return; }
    setErrors({});
    setLoading(true);
    setTimeout(() => { setLoading(false); onSuccess(); }, 1600);
  }

  const stepIndicator = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
      {([1, 2] as const).map((n) => (
        <span key={n} style={{ display: 'contents' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: step >= n ? 'var(--aq-accent)' : 'var(--aq-bg4)', border: `2px solid ${step >= n ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-space-grotesk)', fontSize: 12, fontWeight: 700, color: step >= n ? '#0B0E17' : 'var(--aq-text3)', transition: 'all 0.3s', flexShrink: 0 }}>
            {step > n ? <CheckIcon /> : n}
          </div>
          <div style={{ fontSize: 12, color: step >= n ? 'var(--aq-text2)' : 'var(--aq-text3)', fontWeight: step === n ? 600 : 400 }}>
            {n === 1 ? 'Suas informações' : 'Tipo de conta'}
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
              Criar sua conta
            </h2>
            <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.5 }}>
              Comece sua jornada de alta performance hoje.
            </p>
          </div>

          <form onSubmit={handleStep1} noValidate>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={s.fieldLabel}>Nome</label>
                  <div style={s.inputWrap}>
                    <span style={s.inputIcon}><UserIcon /></span>
                    <input type="text" placeholder="João" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={{ ...s.input, ...(errors.firstName ? s.inputError : {}) }} />
                  </div>
                  {errors.firstName && <div style={s.fieldError}><AlertIcon />{errors.firstName}</div>}
                </div>
                <div>
                  <label style={s.fieldLabel}>Sobrenome</label>
                  <div style={s.inputWrap}>
                    <span style={s.inputIcon}><UserIcon /></span>
                    <input type="text" placeholder="Silva" value={lastName} onChange={(e) => setLastName(e.target.value)} style={s.input} />
                  </div>
                </div>
              </div>

              <div>
                <label style={s.fieldLabel}>E-mail</label>
                <div style={s.inputWrap}>
                  <span style={s.inputIcon}><MailIcon /></span>
                  <input type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...s.input, ...(errors.email ? s.inputError : {}) }} />
                </div>
                {errors.email && <div style={s.fieldError}><AlertIcon />{errors.email}</div>}
              </div>

              <div>
                <label style={s.fieldLabel}>
                  Telefone <span style={{ color: 'var(--aq-text3)', fontWeight: 400 }}>(opcional)</span>
                </label>
                <div style={s.inputWrap}>
                  <span style={s.inputIcon}><PhoneIcon /></span>
                  <input type="tel" placeholder="+55 (11) 9 0000-0000" value={phone} onChange={(e) => setPhone(e.target.value)} style={s.input} />
                </div>
              </div>

              <div>
                <label style={s.fieldLabel}>Senha</label>
                <div style={s.inputWrap}>
                  <span style={s.inputIcon}><LockIcon /></span>
                  <input type={showPw ? 'text' : 'password'} placeholder="Mínimo 8 caracteres" value={pw} onChange={(e) => setPw(e.target.value)} style={{ ...s.input, paddingRight: 40, ...(errors.pw ? s.inputError : {}) }} />
                  <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--aq-text3)', display: 'flex', alignItems: 'center' }}>
                    <EyeIcon off={showPw} />
                  </button>
                </div>
                {pw && (
                  <>
                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: i < strength ? STRENGTH_COLORS[strength - 1] : 'var(--aq-bg4)', transition: 'background 0.3s' }} />
                      ))}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 4, color: STRENGTH_COLORS[strength - 1] ?? 'var(--aq-text3)' }}>
                      Força: {STRENGTH_LABELS[strength - 1] ?? '—'}
                    </div>
                  </>
                )}
                {errors.pw && <div style={s.fieldError}><AlertIcon />{errors.pw}</div>}
              </div>

              <div>
                <label style={s.fieldLabel}>Confirmar senha</label>
                <div style={s.inputWrap}>
                  <span style={s.inputIcon}><LockIcon /></span>
                  <input type={showPw ? 'text' : 'password'} placeholder="Repita a senha" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} style={{ ...s.input, ...(errors.pwConfirm ? s.inputError : {}) }} />
                </div>
                {errors.pwConfirm && <div style={s.fieldError}><AlertIcon />{errors.pwConfirm}</div>}
              </div>
            </div>

            <button type="submit" style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)' }}>
              Continuar →
            </button>
          </form>
        </div>
      )}

      {step === 2 && (
        <div className="aq-anim">
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
              Como você vai usar?
            </h2>
            <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.5 }}>
              Isso personaliza sua experiência na plataforma.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
              <div>
                <label style={s.fieldLabel}>Tipo de conta</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {([
                    { key: 'participant' as const, emoji: '🏋️', title: 'Participante', sub: 'Aprender e evoluir' },
                    { key: 'instructor' as const, emoji: '🎯', title: 'Instrutor', sub: 'Criar e gerenciar' },
                  ]).map((r) => {
                    const selected = role === r.key;
                    return (
                      <div key={r.key} onClick={() => setRole(r.key)} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${selected ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, background: selected ? 'var(--aq-accent-glow)' : 'var(--aq-bg3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.2s' }}>
                        <span style={{ fontSize: 18 }}>{r.emoji}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--aq-text)' }}>{r.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--aq-text3)', marginTop: 1 }}>{r.sub}</div>
                        </div>
                        <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${selected ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, background: selected ? 'var(--aq-accent)' : 'transparent', flexShrink: 0, transition: 'all 0.2s', position: 'relative' }}>
                          {selected && <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: '#0B0E17' }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--aq-bg3)', border: '1px solid var(--aq-border)', fontSize: 12, color: 'var(--aq-text2)', lineHeight: 1.6 }}>
                {role === 'participant'
                  ? '🏋️ Como participante, você terá acesso aos módulos de treinamento, poderá acompanhar seu progresso, ganhar XP, subir de nível e competir no ranking.'
                  : '🎯 Como instrutor, você poderá criar tópicos e subtópicos, fazer upload de materiais, acompanhar o progresso dos alunos e gerenciar as trilhas de conteúdo.'}
              </div>

              <label onClick={() => setTerms(!terms)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, color: 'var(--aq-text3)', cursor: 'pointer', userSelect: 'none' }}>
                <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${terms ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: terms ? 'var(--aq-accent)' : 'var(--aq-bg3)', transition: 'all 0.2s', marginTop: 1 }}>
                  {terms && <CheckIcon />}
                </div>
                <span>
                  Concordo com os <a href="#" style={{ color: 'var(--aq-accent)', textDecoration: 'none' }}>Termos de Uso</a> e a <a href="#" style={{ color: 'var(--aq-accent)', textDecoration: 'none' }}>Política de Privacidade</a> do ArenaQuest.
                </span>
              </label>
              {errors.terms && <div style={{ ...s.fieldError, marginTop: -8 }}><AlertIcon />{errors.terms}</div>}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setStep(1)} style={{ flexShrink: 0, padding: '13px 18px', borderRadius: 10, border: '1px solid var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text2)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                ← Voltar
              </button>
              <button
                type="submit"
                disabled={loading}
                className={loading ? 'aq-submit-btn-loading' : ''}
                style={{ flex: 1, padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', position: 'relative', overflow: 'hidden', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', opacity: loading ? 0.5 : 1 }}
              >
                {loading ? 'Criando conta…' : 'Criar conta'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--aq-text3)', marginTop: 24 }}>
        Já tem conta?{' '}
        <button onClick={onSwitch} style={{ color: 'var(--aq-accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif' }}>
          Entrar
        </button>
      </div>
    </div>
  );
}

// ─── Success state ─────────────────────────────────────────────────────────────

function SuccessState() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.replace('/dashboard'), 3000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16, padding: '20px 0' }} className="aq-anim">
      <div className="aq-success-icon" style={{ width: 72, height: 72, borderRadius: '50%', background: 'oklch(0.68 0.17 150 / 0.15)', border: '2px solid var(--aq-accent3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
        🏆
      </div>
      <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700 }}>
        Arena desbloqueada!
      </h2>
      <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.6, maxWidth: 280 }}>
        Sua conta foi criada com sucesso. Preparando sua experiência…
      </p>
      <div style={{ width: '100%', height: 4, background: 'var(--aq-bg4)', borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
        <div className="aq-progress-bar" style={{ height: '100%', background: 'linear-gradient(90deg, var(--aq-accent), var(--aq-accent3))', borderRadius: 4 }} />
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { isLoading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'success'>('login');

  if (isLoading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)' }}>
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--aq-bg)', color: 'var(--aq-text)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', position: 'relative', overflow: 'hidden' }}>

      {/* Background geometry */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(-45deg, transparent, transparent 60px, rgba(255,255,255,0.012) 60px, rgba(255,255,255,0.012) 61px)' }} />
        <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, oklch(0.74 0.19 52 / 0.12) 0%, transparent 70%)', top: -200, right: -100 }} />
        <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, oklch(0.65 0.16 240 / 0.10) 0%, transparent 70%)', bottom: -100, left: 200 }} />
      </div>

      {/* Left panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 64px', position: 'relative', zIndex: 1, maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 56 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--aq-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontWeight: 700, fontSize: 18, color: '#0B0E17', boxShadow: '0 0 24px oklch(0.74 0.19 52 / 0.4)' }}>
            AQ
          </div>
          <div style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontWeight: 700, fontSize: 20, letterSpacing: '-0.4px' }}>
            Arena<span style={{ color: 'var(--aq-accent)' }}>Quest</span>
          </div>
        </div>

        <div style={{ marginBottom: 48 }}>
          <h1 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 38, fontWeight: 700, letterSpacing: '-1px', lineHeight: 1.1, marginBottom: 14 }}>
            Treine com<br />propósito.<br />
            <span style={{ color: 'var(--aq-accent)' }}>Evolua com dados.</span>
          </h1>
          <p style={{ fontSize: 15, color: 'var(--aq-text2)', lineHeight: 1.6, maxWidth: 340 }}>
            Plataforma de aprendizado para atletas e instrutores que levam a performance a sério.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {[
            { icon: '⚡', bg: 'oklch(0.74 0.19 52 / 0.12)', title: 'Trilhas de Conteúdo', desc: 'Módulos estruturados com vídeos, PDFs e fotos em hierarquia clara.' },
            { icon: '🏆', bg: 'oklch(0.65 0.16 240 / 0.12)', title: 'Gamificação Completa', desc: 'XP, níveis, badges, missões diárias e ranking entre participantes.' },
            { icon: '📊', bg: 'oklch(0.68 0.17 150 / 0.12)', title: 'Progresso em Tempo Real', desc: 'Dashboards detalhados para acompanhar sua evolução contínua.' },
          ].map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, border: '1px solid var(--aq-border2)', background: f.bg }}>
                {f.icon}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--aq-text)' }}>{f.title}</div>
                <div style={{ fontSize: 12, color: 'var(--aq-text3)', marginTop: 2, lineHeight: 1.4 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ width: 480, minWidth: 480, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 48px', background: 'var(--aq-bg2)', borderLeft: '1px solid var(--aq-border)', position: 'relative', zIndex: 1, overflowY: 'auto' }}>
        {mode === 'success' ? (
          <SuccessState />
        ) : (
          <>
            <div style={{ display: 'flex', background: 'var(--aq-bg3)', borderRadius: 12, padding: 4, border: '1px solid var(--aq-border)', marginBottom: 32 }}>
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{ flex: 1, padding: 9, borderRadius: 9, border: 'none', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.22s', background: mode === m ? 'var(--aq-bg2)' : 'transparent', color: mode === m ? 'var(--aq-text)' : 'var(--aq-text3)', boxShadow: mode === m ? '0 2px 8px rgba(0,0,0,0.3)' : 'none' }}
                >
                  {m === 'login' ? 'Entrar' : 'Criar conta'}
                </button>
              ))}
            </div>

            {mode === 'login'
              ? <LoginForm onSwitch={() => setMode('register')} />
              : <RegisterForm onSwitch={() => setMode('login')} onSuccess={() => setMode('success')} />
            }
          </>
        )}
      </div>
    </div>
  );
}
