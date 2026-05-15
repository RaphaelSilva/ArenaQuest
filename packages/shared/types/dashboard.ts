import type { QuestWithProgress } from '../domain/quest';
import type { Mission, MissionProgress } from '../domain/mission';
import type { BadgeRecord } from '../ports/i-badge-repository';

export interface DashboardXp {
  totalXp: number;
  level: number;
  rankTitle: string;
  xpToNext: number | null;
}

export interface DashboardStreak {
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
}

export interface DashboardMissionEntry {
  mission: Mission;
  progress: MissionProgress | null;
}

export interface DashboardBadgeEntry {
  badge: BadgeRecord;
  earnedAt: string;
}

export interface DashboardShape {
  xp: DashboardXp | null;
  streak: DashboardStreak | null;
  questsDaily: QuestWithProgress[] | null;
  questsWeekly: QuestWithProgress[] | null;
  missions: DashboardMissionEntry[] | null;
  badges: DashboardBadgeEntry[] | null;
}
