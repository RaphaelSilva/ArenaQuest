import type { DashboardBadge } from '@web/lib/dashboard-api';

type Props = { badges: { earned: DashboardBadge[]; locked: DashboardBadge[] } };

export function BadgesGrid({ badges }: Props) {
  const allBadges = [...badges.earned, ...badges.locked];

  if (allBadges.length === 0) {
    return (
      <section
        className="rounded-2xl border border-dashed p-8 text-center"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
        aria-label="Badges"
      >
        <p className="text-sm" style={{ color: 'var(--aq-text3)' }}>
          No badges yet. Keep learning to earn them!
        </p>
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border"
      style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
      aria-label="Badges"
    >
      <div
        className="flex items-center justify-between border-b px-5 py-4"
        style={{ borderColor: 'var(--aq-border)' }}
      >
        <h2
          className="text-[13px] font-semibold"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          Badges
        </h2>
        <span className="text-xs" style={{ color: 'var(--aq-text3)' }}>
          {badges.earned.length}/{allBadges.length} earned
        </span>
      </div>

      <ul className="grid grid-cols-4 gap-3 p-5">
        {allBadges.map((badge) => (
          <li
            key={badge.id}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-center"
            style={{
              background: badge.earned ? 'var(--aq-bg3)' : 'var(--aq-bg4)',
              opacity: badge.earned ? 1 : 0.45,
              filter: badge.earned ? 'none' : 'grayscale(1)',
            }}
            title={badge.earned ? `${badge.name} — ${badge.xpReward} XP` : `Locked: ${badge.name}`}
          >
            <span className="text-2xl" aria-hidden>{badge.emoji}</span>
            <span className="text-[9px] leading-tight" style={{ color: badge.earned ? 'var(--aq-text2)' : 'var(--aq-text3)' }}>
              {badge.name}
            </span>
            {!badge.earned && (
              <span className="text-[9px]" style={{ color: 'var(--aq-text3)' }} aria-label="Locked">🔒</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
