import type { DashboardXp } from '@web/lib/dashboard-api';

type Props = { xp: DashboardXp };

export function StatCardLevel({ xp }: Props) {
  const pct = xp.xpToNextLevel > 0
    ? Math.min(100, Math.round((xp.xpInLevel / xp.xpToNextLevel) * 100))
    : 100;

  return (
    <article
      className="relative overflow-hidden rounded-2xl border p-5"
      style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
      aria-label="Level and XP"
    >
      <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: 'var(--aq-accent)' }} />

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--aq-text3)' }}>
          Level &amp; XP
        </span>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-base"
          style={{ background: 'var(--aq-accent-glow)' }}
          aria-hidden
        >
          ⚔️
        </span>
      </div>

      <div className="flex items-end gap-3">
        <span
          className="text-[42px] font-bold leading-none"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
          aria-label={`Level ${xp.level}`}
        >
          {xp.level}
        </span>
        <div className="mb-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--aq-accent)' }}>
            {xp.rankTitle}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--aq-text3)' }}>
            {xp.totalXp.toLocaleString()} XP total
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <div className="flex justify-between text-[11px]" style={{ color: 'var(--aq-text3)' }}>
          <span>{xp.xpInLevel.toLocaleString()} XP</span>
          <span>{xp.xpToNextLevel.toLocaleString()} XP to next level</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full"
          style={{ background: 'var(--aq-bg4)' }}
          role="progressbar"
          aria-label="XP progress to next level"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: 'var(--aq-accent)' }}
          />
        </div>
      </div>
    </article>
  );
}
