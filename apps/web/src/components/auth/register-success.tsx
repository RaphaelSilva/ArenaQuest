'use client';

import { useDict } from '@web/context/dict-context';

interface RegisterSuccessProps {
  email: string;
  onBackToLogin: () => void;
}

export function RegisterSuccess({ email, onBackToLogin }: RegisterSuccessProps) {
  const dict = useDict();
  const d = dict.auth.registerSuccess;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16, padding: '20px 0' }} className="aq-anim">
      <div className="aq-success-icon" style={{ width: 72, height: 72, borderRadius: '50%', background: 'oklch(0.65 0.16 240 / 0.15)', border: '2px solid var(--aq-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
        ✉️
      </div>
      <h2 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700 }}>
        {d.title}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.6, maxWidth: 320 }}>
        {d.message(email)}
      </p>
      <p style={{ fontSize: 12, color: 'var(--aq-text3)', lineHeight: 1.6, maxWidth: 320 }}>
        {d.spamHint}
      </p>
      <button
        type="button"
        onClick={onBackToLogin}
        style={{ marginTop: 8, width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)' }}
      >
        {d.backButton}
      </button>
    </div>
  );
}
