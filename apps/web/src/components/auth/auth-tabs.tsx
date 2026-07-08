'use client';

import { useDict } from '@web/context/dict-context';

interface AuthTabsProps {
  mode: 'login' | 'register';
  onChange: (m: 'login' | 'register') => void;
}

export function AuthTabs({ mode, onChange }: AuthTabsProps) {
  const dict = useDict();
  return (
    <div style={{ display: 'flex', background: 'var(--aq-bg3)', borderRadius: 12, padding: 4, border: '1px solid var(--aq-border)', marginBottom: 32 }}>
      {(['login', 'register'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          style={{ flex: 1, padding: 9, borderRadius: 9, border: 'none', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.22s', background: mode === m ? 'var(--aq-bg2)' : 'transparent', color: mode === m ? 'var(--aq-text)' : 'var(--aq-text3)', boxShadow: mode === m ? '0 2px 8px rgba(0,0,0,0.3)' : 'none' }}
        >
          {m === 'login' ? dict.auth.tabs.login : dict.auth.tabs.register}
        </button>
      ))}
    </div>
  );
}
