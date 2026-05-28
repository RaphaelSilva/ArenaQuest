'use client';

import { useDict } from '@web/context/dict-context';

type RoleValue = 'participant' | 'instructor';

interface RoleSelectProps {
  value: RoleValue;
  onChange: (v: RoleValue) => void;
}

export function RoleSelect({ value, onChange }: RoleSelectProps) {
  const dict = useDict();
  const r = dict.auth.role;

  const roles = [
    { key: 'participant' as const, emoji: '🏋️', title: r.participantTitle, sub: r.participantSub },
    { key: 'instructor' as const, emoji: '🎯', title: r.instructorTitle, sub: r.instructorSub },
  ];

  const roleDescriptions: Record<RoleValue, string> = {
    participant: r.participantDesc,
    instructor: r.instructorDesc,
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        {roles.map((role) => {
          const selected = value === role.key;
          return (
            <div key={role.key} onClick={() => onChange(role.key)} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${selected ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, background: selected ? 'var(--aq-accent-glow)' : 'var(--aq-bg3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.2s' }}>
              <span style={{ fontSize: 18 }}>{role.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--aq-text)' }}>{role.title}</div>
                <div style={{ fontSize: 11, color: 'var(--aq-text3)', marginTop: 1 }}>{role.sub}</div>
              </div>
              <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${selected ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, background: selected ? 'var(--aq-accent)' : 'transparent', flexShrink: 0, transition: 'all 0.2s', position: 'relative' }}>
                {selected && <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: '#0B0E17' }} />}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--aq-bg3)', border: '1px solid var(--aq-border)', fontSize: 12, color: 'var(--aq-text2)', lineHeight: 1.6 }}>
        {roleDescriptions[value]}
      </div>
    </div>
  );
}
