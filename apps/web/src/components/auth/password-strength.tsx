'use client';

import { useDict } from '@web/context/dict-context';

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

export function PasswordStrength({ password }: { password: string }) {
  const dict = useDict();
  if (!password) return null;
  const strength = getStrength(password);
  const strengthLabels = [
    dict.auth.passwordStrength.weak,
    dict.auth.passwordStrength.fair,
    dict.auth.passwordStrength.good,
    dict.auth.passwordStrength.strong,
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: i < strength ? STRENGTH_COLORS[strength - 1] : 'var(--aq-bg4)', transition: 'background 0.3s' }} />
        ))}
      </div>
      <div style={{ fontSize: 11, marginTop: 4, color: STRENGTH_COLORS[strength - 1] ?? 'var(--aq-text3)' }}>
        <span>{dict.auth.passwordStrength.label}</span> {strengthLabels[strength - 1] ?? '—'}
      </div>
    </>
  );
}
