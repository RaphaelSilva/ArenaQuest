type BadgeItem = {
  id: string;
  emoji: string;
  name: string;
  earned: boolean;
};

type Props = {
  badges: BadgeItem[];
};

export function BadgesStrip({ badges }: Props) {
  if (badges.length === 0) return null;

  return (
    <div className="mb-8 flex flex-wrap gap-2.5">
      {badges.map((b) => (
        <span
          key={b.id}
          className="flex items-center gap-1.5 rounded-[20px] px-3 py-1.5 text-[12px] font-medium"
          style={
            b.earned
              ? {
                  background: 'var(--aq-accent-glow)',
                  border: '1px solid var(--aq-accent)',
                  color: 'var(--aq-accent)',
                }
              : {
                  background: 'var(--aq-bg2)',
                  border: '1px solid var(--aq-border2)',
                  color: 'var(--aq-text3)',
                  opacity: 0.5,
                }
          }
        >
          <span className="text-[14px]" aria-hidden>{b.emoji}</span>
          {b.name}
        </span>
      ))}
    </div>
  );
}
