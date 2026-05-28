'use client';

import type { LeaderboardEntry } from '@web/lib/dashboard-api';
import { useDict } from '@web/context/dict-context';

type Props = {
  rows: LeaderboardEntry[];
  myRank: number;
  totalPlayers: number;
};

export function StatCardRanking({ rows, myRank, totalPlayers }: Props) {
  const dict = useDict();
  const top = rows.slice(0, 3);

  return (
    <article
      className="relative overflow-hidden rounded-2xl border p-5"
      style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
      aria-label={dict.dashboard.rankingCard.label}
    >
      <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: 'var(--aq-accent2)' }} />

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--aq-text3)' }}>
          {dict.dashboard.rankingCard.label}
        </span>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-base"
          style={{ background: 'var(--aq-accent2-glow)' }}
          aria-hidden
        >
          🏆
        </span>
      </div>

      <div className="flex items-end gap-2">
        <span
          className="text-[42px] font-bold leading-none"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
          aria-label={`Rank ${myRank}`}
        >
          #{myRank}
        </span>
        <span className="mb-1 text-sm" style={{ color: 'var(--aq-text2)' }}>
          {dict.dashboard.rankingCard.of} {totalPlayers}
        </span>
      </div>

      {top.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--aq-text3)' }}>
          {dict.dashboard.rankingCard.noData}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((entry) => (
            <li
              key={entry.rank}
              className="flex items-center gap-2"
              style={entry.isMe ? { opacity: 1 } : { opacity: 0.7 }}
              aria-current={entry.isMe ? 'true' : undefined}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                style={{
                  background: entry.isMe ? 'var(--aq-accent2)' : 'var(--aq-bg4)',
                  color: entry.isMe ? '#fff' : 'var(--aq-text2)',
                }}
              >
                {entry.initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between text-[11px]">
                  <span className="truncate font-medium" style={{ color: entry.isMe ? 'var(--aq-text)' : 'var(--aq-text2)' }}>
                    {entry.name}
                  </span>
                  <span style={{ color: 'var(--aq-text3)' }}>{entry.totalXp.toLocaleString()} XP</span>
                </div>
                <div
                  className="mt-0.5 h-1 overflow-hidden rounded-full"
                  style={{ background: 'var(--aq-bg4)' }}
                  role="progressbar"
                  aria-label={`${entry.name}: ${entry.pct}%`}
                  aria-valuenow={entry.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${entry.pct}%`, background: entry.isMe ? 'var(--aq-accent2)' : 'var(--aq-bg3)' }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
