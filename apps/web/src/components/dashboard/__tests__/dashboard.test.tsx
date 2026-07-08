import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { StatCardLevel } from '../StatCardLevel';
import { DailyTasks } from '../DailyTasks';
import type { DashboardXp, DailyQuest } from '@web/lib/dashboard-api';

// ---------------------------------------------------------------------------
// StatCardLevel
// ---------------------------------------------------------------------------

const XP_FULL: DashboardXp = {
  totalXp: 1240,
  level: 12,
  rankTitle: 'Aspirante',
  xpInLevel: 240,
  xpToNextLevel: 760,
};

describe('StatCardLevel', () => {
  it('renders level number and rank title', () => {
    render(<StatCardLevel xp={XP_FULL} />);
    expect(screen.getByLabelText(/Level 12/i)).toBeInTheDocument();
    expect(screen.getByText('Aspirante')).toBeInTheDocument();
  });

  it('renders total XP', () => {
    render(<StatCardLevel xp={XP_FULL} />);
    expect(screen.getByText(dictPt.dashboard.levelCard.xpTotal(1240))).toBeInTheDocument();
  });

  it('renders the XP progress bar with correct aria attributes', () => {
    render(<StatCardLevel xp={XP_FULL} />);
    const bar = screen.getByRole('progressbar', { name: dictPt.dashboard.levelCard.xpProgressLabel });
    // 240 / 760 ≈ 31.58 → rounds to 32%
    expect(bar).toHaveAttribute('aria-valuenow', '32');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('does not show NaN when xpToNextLevel is 0', () => {
    const xp: DashboardXp = { ...XP_FULL, xpToNextLevel: 0, xpInLevel: 0 };
    render(<StatCardLevel xp={xp} />);
    const bar = screen.getByRole('progressbar', { name: dictPt.dashboard.levelCard.xpProgressLabel });
    expect(bar.getAttribute('aria-valuenow')).not.toBe('NaN');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('does not crash with all-zero XP', () => {
    const xp: DashboardXp = { totalXp: 0, level: 1, rankTitle: 'Novice', xpInLevel: 0, xpToNextLevel: 0 };
    render(<StatCardLevel xp={xp} />);
    expect(screen.getByText('Novice')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DailyTasks
// ---------------------------------------------------------------------------

const TASKS: DailyQuest[] = [
  { id: 'd1', title: 'Complete a nutrition lesson', xpReward: 50, currentValue: 1, targetValue: 1, completed: true },
  { id: 'd2', title: 'Watch workout video', xpReward: 30, currentValue: 0, targetValue: 1, completed: false },
  { id: 'd3', title: 'Log meals', xpReward: 20, currentValue: 0, targetValue: 1, completed: false },
];

describe('DailyTasks', () => {
  it('renders all task titles', () => {
    render(<DailyTasks tasks={TASKS} />);
    expect(screen.getByText('Complete a nutrition lesson')).toBeInTheDocument();
    expect(screen.getByText('Watch workout video')).toBeInTheDocument();
    expect(screen.getByText('Log meals')).toBeInTheDocument();
  });

  it('renders the correct completed/total count', () => {
    render(<DailyTasks tasks={TASKS} />);
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('renders the progress bar with the correct percentage', () => {
    render(<DailyTasks tasks={TASKS} />);
    const bar = screen.getByRole('progressbar', { name: dictPt.dashboard.dailyTasks.progressLabel });
    expect(bar).toHaveAttribute('aria-valuenow', '33');
  });

  it('renders XP reward for each task', () => {
    render(<DailyTasks tasks={TASKS} />);
    expect(screen.getByText('+50 XP')).toBeInTheDocument();
    expect(screen.getByText('+30 XP')).toBeInTheDocument();
  });

  it('shows empty state when there are no tasks', () => {
    render(<DailyTasks tasks={[]} />);
    expect(screen.getByText(dictPt.dashboard.dailyTasks.empty)).toBeInTheDocument();
  });

  it('shows all tasks as completed when all are done', () => {
    const allDone: DailyQuest[] = TASKS.map((t) => ({ ...t, completed: true }));
    render(<DailyTasks tasks={allDone} />);
    const bar = screen.getByRole('progressbar', { name: dictPt.dashboard.dailyTasks.progressLabel });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });
});
