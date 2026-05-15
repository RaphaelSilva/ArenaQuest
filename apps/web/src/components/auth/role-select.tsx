type RoleValue = 'participant' | 'instructor';

interface RoleSelectProps {
  value: RoleValue;
  onChange: (v: RoleValue) => void;
}

const ROLES = [
  { key: 'participant' as const, emoji: '🏋️', title: 'Participante', sub: 'Aprender e evoluir' },
  { key: 'instructor' as const, emoji: '🎯', title: 'Instrutor', sub: 'Criar e gerenciar' },
];

const ROLE_DESCRIPTIONS: Record<RoleValue, string> = {
  participant: '🏋️ Como participante, você terá acesso aos módulos de treinamento, poderá acompanhar seu progresso, ganhar XP, subir de nível e competir no ranking.',
  instructor: '🎯 Como instrutor, você poderá criar tópicos e subtópicos, fazer upload de materiais, acompanhar o progresso dos alunos e gerenciar as trilhas de conteúdo.',
};

export function RoleSelect({ value, onChange }: RoleSelectProps) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        {ROLES.map((r) => {
          const selected = value === r.key;
          return (
            <div key={r.key} onClick={() => onChange(r.key)} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${selected ? 'var(--aq-accent)' : 'var(--aq-border2)'}`, background: selected ? 'var(--aq-accent-glow)' : 'var(--aq-bg3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.2s' }}>
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

      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--aq-bg3)', border: '1px solid var(--aq-border)', fontSize: 12, color: 'var(--aq-text2)', lineHeight: 1.6 }}>
        {ROLE_DESCRIPTIONS[value]}
      </div>
    </div>
  );
}
