import type { HttpTransport } from './api-client';

// ---------------------------------------------------------------------------
// Types — frontend shape (consumed by components)
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
  deadlineAt: string | null;
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
// Helpers
// ---------------------------------------------------------------------------

// Returns a boolean[7] for the last 7 calendar days (index 0 = 6 days ago, index 6 = today).
// A day is true if it falls within the streak window ending on lastActivityDate.
export function computeWeekPips(
  lastActivityDate: string | null,
  currentStreak: number,
): boolean[] {
  if (!lastActivityDate || currentStreak <= 0) return Array(7).fill(false) as boolean[];

  const last = new Date(lastActivityDate);
  last.setUTCHours(0, 0, 0, 0);

  const streakStart = new Date(last);
  streakStart.setUTCDate(streakStart.getUTCDate() - (currentStreak - 1));

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const pips: boolean[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - i);
    pips.push(day >= streakStart && day <= last);
  }
  return pips;
}

async function safeFetch<T>(http: HttpTransport, path: string): Promise<T | null> {
  try {
    const res = await http('GET', path);
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Raw API types (minimal, only what we read)
// ---------------------------------------------------------------------------

// NOTE: The dashboard endpoint schema uses z.any() for complex fields, so the
// generated types are `unknown`. Define explicit local types matching the actual
// runtime shape returned by the API controllers.
type ApiXp = { totalXp: number; level: number; rankTitle: string; xpInLevel: number; xpToNext: number | null };
type ApiStreak = { currentStreak: number; longestStreak: number; lastActivityDate: string | null };
type ApiBadgeEntry = { badge: { id: string; name: string; iconEmoji: string; xpReward: number }; earnedAt: string };
type ApiQuestEntry = { id: string; title: string; xpReward: number; progress: { currentValue: number; targetValue: number; completed: boolean } | null };
type ApiMissionEntry = { mission: { id: string; title: string; description: string; xpReward: number; endAt: string | null; badgeId: string | null }; progress: { currentValue: number; targetValue: number } | null };
type ApiDashboardShape = {
  xp: ApiXp | null;
  streak: ApiStreak | null;
  questsDaily: ApiQuestEntry[];
  questsWeekly: ApiQuestEntry[];
  missions: ApiMissionEntry[] | null;
  badges: ApiBadgeEntry[] | null;
};

type ApiLeaderboardResponse = {
  rows: Array<{ userId: string; totalXp: number }>;
  me: { rank: number; totalXp: number };
  total: number;
};

type ApiTopicsResponse = {
  data: Array<{ id: string; parentId: string | null; title: string }>;
};

type ApiTopicProgressResponse = {
  data: Array<{ topicNodeId: string; status: 'not_started' | 'in_progress' | 'completed' }>;
};

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

function adaptXp(raw: ApiXp | null): DashboardXp {
  if (!raw) return { totalXp: 0, level: 1, rankTitle: '', xpInLevel: 0, xpToNextLevel: 0 };
  return {
    totalXp: raw.totalXp,
    level: raw.level,
    rankTitle: raw.rankTitle,
    xpInLevel: raw.xpInLevel,
    xpToNextLevel: raw.xpToNext ?? 0,
  };
}

function adaptStreak(raw: ApiStreak | null): DashboardStreak {
  if (!raw) return { currentDays: 0, longestDays: 0, weekPips: Array(7).fill(false) as boolean[] };
  return {
    currentDays: raw.currentStreak,
    longestDays: raw.longestStreak,
    weekPips: computeWeekPips(raw.lastActivityDate, raw.currentStreak),
  };
}

function adaptDaily(raw: ApiQuestEntry[] | null): DailyQuest[] {
  if (!raw) return [];
  return raw.map((q) => ({
    id: q.id,
    title: q.title,
    xpReward: q.xpReward,
    currentValue: q.progress?.currentValue ?? 0,
    targetValue: q.progress?.targetValue ?? 1,
    completed: q.progress?.completed ?? false,
  }));
}

function adaptWeekly(raw: ApiQuestEntry[] | null): WeeklyChallenge[] {
  if (!raw) return [];
  return raw.map((q) => ({
    id: q.id,
    title: q.title,
    xpReward: q.xpReward,
    currentValue: q.progress?.currentValue ?? 0,
    targetValue: q.progress?.targetValue ?? 1,
  }));
}

function adaptMissions(raw: ApiMissionEntry[] | null): DashboardMission[] | null {
  if (!raw || raw.length === 0) return null;
  return raw.map((entry) => {
    const { mission, progress } = entry;
    const progressPct =
      progress && progress.targetValue > 0
        ? Math.min(100, Math.round((progress.currentValue / progress.targetValue) * 100))
        : 0;
    return {
      id: mission.id,
      name: mission.title,
      icon: '🎯',
      description: mission.description,
      progressPct,
      deadlineAt: mission.endAt,
      rewardXp: mission.xpReward,
      rewardBadge: mission.badgeId ?? null,
    };
  });
}

function adaptBadges(raw: ApiBadgeEntry[] | null): { earned: DashboardBadge[]; locked: DashboardBadge[] } {
  if (!raw) return { earned: [], locked: [] };
  const earned = raw.map((entry) => ({
    id: entry.badge.id,
    emoji: entry.badge.iconEmoji,
    name: entry.badge.name,
    xpReward: entry.badge.xpReward,
    earned: true as const,
  }));
  return { earned, locked: [] };
}

function adaptLeaderboard(
  raw: ApiLeaderboardResponse | null,
): { rows: LeaderboardEntry[]; myRank: number; totalPlayers: number } {
  if (!raw) return { rows: [], myRank: 0, totalPlayers: 0 };

  const maxXp = raw.rows[0]?.totalXp ?? 1;
  const myRank = raw.me.rank;

  const rows: LeaderboardEntry[] = raw.rows.map((r, i) => ({
    rank: i + 1,
    initials: r.userId.slice(0, 2).toUpperCase(),
    name: r.userId.slice(0, 8),
    totalXp: r.totalXp,
    pct: maxXp > 0 ? Math.round((r.totalXp / maxXp) * 100) : 0,
    isMe: i + 1 === myRank,
  }));

  return { rows, myRank, totalPlayers: raw.total };
}

function adaptRoadmap(
  topicsRaw: ApiTopicsResponse | null,
  progressRaw: ApiTopicProgressResponse | null,
): RoadmapNode[] {
  if (!topicsRaw) return [];

  const roots = topicsRaw.data.filter((t) => t.parentId === null);
  const progressMap = new Map(
    (progressRaw?.data ?? []).map((p) => [p.topicNodeId, p.status]),
  );

  return roots.map((t) => {
    const status = progressMap.get(t.id) ?? 'not_started';
    const pct = status === 'completed' ? 100 : status === 'in_progress' ? 50 : 0;
    return { id: t.id, emoji: '📚', name: t.title, pct, status };
  });
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export function createDashboardApi(http: HttpTransport) {
  return {
    async get(): Promise<DashboardPayload> {
      const [dashRaw, lbRaw, topicsRaw, progressRaw] = await Promise.all([
        http('GET', '/me/dashboard').then(async (r) => {
          if (!r.ok) throw new Error(`Failed to load dashboard (${r.status})`);
          return r.json() as Promise<ApiDashboardShape>;
        }),
        safeFetch<ApiLeaderboardResponse>(http, '/leaderboard?scope=global&period=all_time&limit=5'),
        safeFetch<ApiTopicsResponse>(http, '/topics'),
        safeFetch<ApiTopicProgressResponse>(http, '/me/progress/topics'),
      ]);

      return {
        xp: adaptXp(dashRaw.xp),
        streak: adaptStreak(dashRaw.streak),
        daily: adaptDaily(dashRaw.questsDaily),
        weekly: adaptWeekly(dashRaw.questsWeekly),
        missions: adaptMissions(dashRaw.missions),
        badges: adaptBadges(dashRaw.badges),
        leaderboard: adaptLeaderboard(lbRaw),
        roadmap: adaptRoadmap(topicsRaw, progressRaw),
      };
    },
  };
}

export async function getDashboard(): Promise<never> {
  throw new Error('getDashboard is deprecated. Use useApiClient() hook instead: const client = useApiClient(); await client.dashboard.get()');
}
