import type { WeeklyChallenge } from '@web/lib/dashboard-api';

type Props = { challenges: WeeklyChallenge[] };

export function WeeklyChallenges({ challenges }: Props) {
  if (challenges.length === 0) {
    return (
      <section
        className="rounded-2xl border border-dashed p-8 text-center"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
        aria-label="Weekly challenges"
      >
        <p className="text-sm" style={{ color: 'var(--aq-text3)' }}>
          No weekly challenges this week.
        </p>
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border"
      style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
      aria-label="Weekly challenges"
    >
      <div
        className="border-b px-5 py-4"
        style={{ borderColor: 'var(--aq-border)' }}
      >
        <h2
          className="text-[13px] font-semibold"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          Weekly Challenges
        </h2>
      </div>

      <ul className="divide-y px-5 pb-4" style={{ borderColor: 'var(--aq-border)' }}>
        {challenges.map((ch) => {
          const pct = ch.targetValue > 0
            ? Math.min(100, Math.round((ch.currentValue / ch.targetValue) * 100))
            : 0;
          return (
            <li key={ch.id} className="py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: 'var(--aq-text)' }}>
                  {ch.title}
                </span>
                <span
                  className="ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)' }}
                >
                  +{ch.xpReward} XP
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  className="flex-1 h-1.5 overflow-hidden rounded-full"
                  style={{ background: 'var(--aq-bg4)' }}
                  role="progressbar"
                  aria-label={`${ch.title}: ${pct}%`}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: 'var(--aq-accent2)' }}
                  />
                </div>
                <span className="shrink-0 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
                  {ch.currentValue}/{ch.targetValue}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
