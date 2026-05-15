import type { DashboardStreak } from '@web/lib/dashboard-api';

type Props = { streak: DashboardStreak };

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function StatCardStreak({ streak }: Props) {
  const pips = streak.weekPips.length === 7 ? streak.weekPips : Array(7).fill(false);

  return (
    <article
      className="relative overflow-hidden rounded-2xl border p-5"
      style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
      aria-label="Streak"
    >
      <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: 'var(--aq-accent3)' }} />

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--aq-text3)' }}>
          Streak
        </span>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-base"
          style={{ background: 'oklch(0.68 0.17 150 / 0.18)' }}
          aria-hidden
        >
          🔥
        </span>
      </div>

      <div className="flex items-end gap-2">
        <span
          className="text-[42px] font-bold leading-none"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
          aria-label={`${streak.currentDays} day streak`}
        >
          {streak.currentDays}
        </span>
        <span className="mb-1 text-sm" style={{ color: 'var(--aq-text2)' }}>
          {streak.currentDays === 1 ? 'day' : 'days'} in a row
        </span>
      </div>

      <p className="mt-1 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
        Personal best: {streak.longestDays} {streak.longestDays === 1 ? 'day' : 'days'}
      </p>

      <div className="mt-3 flex gap-1.5" aria-label="Week activity">
        {pips.map((active, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className="h-3 w-3 rounded-full transition-colors duration-300"
              style={{
                background: active ? 'var(--aq-accent3)' : 'var(--aq-bg4)',
                boxShadow: active ? '0 0 6px oklch(0.68 0.17 150 / 0.5)' : 'none',
              }}
              aria-label={`${DAYS[i]}: ${active ? 'active' : 'inactive'}`}
            />
            <span className="text-[9px]" style={{ color: 'var(--aq-text3)' }}>{DAYS[i]}</span>
          </div>
        ))}
      </div>
    </article>
  );
}
