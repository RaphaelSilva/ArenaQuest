'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import { getDashboard, type DashboardPayload } from '@web/lib/dashboard-api';
import { StatCardLevel } from './StatCardLevel';
import { StatCardStreak } from './StatCardStreak';
import { StatCardRanking } from './StatCardRanking';
import { DailyTasks } from './DailyTasks';
import { WeeklyChallenges } from './WeeklyChallenges';
import { MissionsList } from './MissionsList';
import { BadgesGrid } from './BadgesGrid';
import { Roadmap } from './Roadmap';
import { DashboardSkeleton } from './DashboardSkeleton';
import { ThemeToggle } from './ThemeToggle';

function getGreeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardContent() {
  const { accessToken, user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const firstName = user?.name?.split(' ')[0] ?? '';

  useEffect(() => {
    if (authLoading) return;
    if (!accessToken) return; // protected layout redirects before this persists
    getDashboard(accessToken)
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      })
      .finally(() => setLoading(false));
  }, [accessToken, authLoading]);

  if (loading) return <DashboardSkeleton />;

  const now = new Date();

  return (
    <div className="flex flex-col gap-6" style={{ padding: '28px 32px 40px' }}>
      {/* Greeting row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-[22px] font-bold tracking-tight"
            style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.3px' }}
          >
            {getGreeting(now)}{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--aq-text2)' }}>
            Track your progress and keep the momentum going.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <time
            className="hidden text-right text-xs sm:block"
            style={{ color: 'var(--aq-text3)' }}
            dateTime={now.toISOString().slice(0, 10)}
          >
            {now.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'short' })}
          </time>
          <ThemeToggle />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--aq-error-bg)', color: 'var(--aq-error)' }}
        >
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCardLevel xp={data.xp} />
            <StatCardStreak streak={data.streak} />
            {data.leaderboard.rows.length > 0 && (
              <StatCardRanking
                rows={data.leaderboard.rows}
                myRank={data.leaderboard.myRank}
                totalPlayers={data.leaderboard.totalPlayers}
              />
            )}
          </div>

          {/* Main 2-col grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left column */}
            <div className="flex flex-col gap-4">
              {data.daily.length > 0 && <DailyTasks tasks={data.daily} />}
              {data.missions !== null && <MissionsList missions={data.missions} />}
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-4">
              {data.weekly.length > 0 && <WeeklyChallenges challenges={data.weekly} />}
              {data.badges.earned.length > 0 && <BadgesGrid badges={data.badges} />}
            </div>
          </div>

          {/* Roadmap */}
          {data.roadmap.length > 0 && <Roadmap nodes={data.roadmap} />}
        </>
      )}
    </div>
  );
}
