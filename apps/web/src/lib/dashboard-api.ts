const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardXp = {
  totalXp: number;
  level: number;
  rankTitle: string;
  xpInLevel: number;
  xpToNextLevel: number;
};

export type DashboardStreak = {
  currentDays: number;
  longestDays: number;
  weekPips: boolean[];
};

export type DailyQuest = {
  id: string;
  title: string;
  xpReward: number;
  currentValue: number;
  targetValue: number;
  completed: boolean;
};

export type WeeklyChallenge = {
  id: string;
  title: string;
  xpReward: number;
  currentValue: number;
  targetValue: number;
};

export type DashboardMission = {
  id: string;
  name: string;
  icon: string;
  description: string;
  progressPct: number;
  deadlineAt: string;
  rewardXp: number;
  rewardBadge: string | null;
};

export type DashboardBadge = {
  id: string;
  emoji: string;
  name: string;
  xpReward: number;
  earned: boolean;
};

export type LeaderboardEntry = {
  rank: number;
  initials: string;
  name: string;
  totalXp: number;
  pct: number;
  isMe: boolean;
};

export type RoadmapNode = {
  id: string;
  emoji: string;
  name: string;
  pct: number;
  status: 'not_started' | 'in_progress' | 'completed';
};

export type DashboardPayload = {
  xp: DashboardXp;
  streak: DashboardStreak;
  daily: DailyQuest[];
  weekly: WeeklyChallenge[];
  missions: DashboardMission[] | null;
  badges: { earned: DashboardBadge[]; locked: DashboardBadge[] };
  leaderboard: { rows: LeaderboardEntry[]; myRank: number; totalPlayers: number };
  roadmap: RoadmapNode[];
};

// ---------------------------------------------------------------------------
// Fixture — used by tests and dev stubs
// ---------------------------------------------------------------------------

export const DASHBOARD_FIXTURE: DashboardPayload = {
  xp: { totalXp: 1240, level: 12, rankTitle: 'Aspirante', xpInLevel: 240, xpToNextLevel: 760 },
  streak: {
    currentDays: 5,
    longestDays: 12,
    weekPips: [true, true, true, false, true, true, false],
  },
  daily: [
    { id: 'd1', title: 'Complete a lesson on Nutrition', xpReward: 50, currentValue: 1, targetValue: 1, completed: true },
    { id: 'd2', title: 'Watch 10-min workout video', xpReward: 30, currentValue: 0, targetValue: 1, completed: false },
    { id: 'd3', title: 'Log today\'s meals', xpReward: 20, currentValue: 0, targetValue: 1, completed: false },
    { id: 'd4', title: 'Read Movement Fundamentals', xpReward: 40, currentValue: 0, targetValue: 1, completed: false },
  ],
  weekly: [
    { id: 'w1', title: 'Complete 5 lessons', xpReward: 200, currentValue: 3, targetValue: 5 },
    { id: 'w2', title: 'Maintain a 5-day streak', xpReward: 150, currentValue: 5, targetValue: 5 },
    { id: 'w3', title: 'Finish Movement module', xpReward: 300, currentValue: 2, targetValue: 8 },
  ],
  missions: [
    {
      id: 'm1',
      name: 'Semana do Movimento',
      icon: '🏃',
      description: 'Complete all movement challenges this week.',
      progressPct: 65,
      deadlineAt: '2026-05-18T23:59:59Z',
      rewardXp: 500,
      rewardBadge: '🏅',
    },
    {
      id: 'm2',
      name: 'Maratona de Força',
      icon: '💪',
      description: 'Upcoming strength challenge.',
      progressPct: 0,
      deadlineAt: '2026-05-25T23:59:59Z',
      rewardXp: 800,
      rewardBadge: null,
    },
  ],
  badges: {
    earned: [
      { id: 'b1', emoji: '🔥', name: 'Streak Starter', xpReward: 100, earned: true },
      { id: 'b2', emoji: '📚', name: 'First Lesson', xpReward: 50, earned: true },
      { id: 'b3', emoji: '🏆', name: 'Top 5', xpReward: 200, earned: true },
    ],
    locked: [
      { id: 'b4', emoji: '⚡', name: 'Speed Learner', xpReward: 300, earned: false },
      { id: 'b5', emoji: '💎', name: 'Diamond Streak', xpReward: 500, earned: false },
      { id: 'b6', emoji: '🎯', name: 'Perfect Week', xpReward: 250, earned: false },
      { id: 'b7', emoji: '🌟', name: 'Star Performer', xpReward: 400, earned: false },
      { id: 'b8', emoji: '🚀', name: 'Rocket Start', xpReward: 150, earned: false },
    ],
  },
  leaderboard: {
    rows: [
      { rank: 1, initials: 'AM', name: 'Ana M.', totalXp: 3200, pct: 100, isMe: false },
      { rank: 2, initials: 'JR', name: 'João R.', totalXp: 2800, pct: 87, isMe: false },
      { rank: 3, initials: 'CS', name: 'Carla S.', totalXp: 1600, pct: 50, isMe: false },
      { rank: 4, initials: 'ME', name: 'Me', totalXp: 1240, pct: 38, isMe: true },
    ],
    myRank: 4,
    totalPlayers: 38,
  },
  roadmap: [
    { id: 'r1', emoji: '🧬', name: 'Nutrition Basics', pct: 80, status: 'in_progress' },
    { id: 'r2', emoji: '💪', name: 'Movement & Strength', pct: 45, status: 'in_progress' },
    { id: 'r3', emoji: '🧘', name: 'Recovery & Wellness', pct: 0, status: 'not_started' },
    { id: 'r4', emoji: '📊', name: 'Performance Metrics', pct: 0, status: 'not_started' },
    { id: 'r5', emoji: '🏅', name: 'Advanced Protocols', pct: 0, status: 'not_started' },
  ],
};

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function getDashboard(token: string): Promise<DashboardPayload> {
  const res = await fetch(`${API_URL}/me/dashboard`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to load dashboard (${res.status})`);
  return res.json() as Promise<DashboardPayload>;
}
