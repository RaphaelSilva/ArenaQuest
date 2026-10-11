import type { QuestWithProgress } from '../domain/quest';
import type { Mission, MissionProgress } from '../domain/mission';
import type { BadgeRecord } from '../ports/i-badge-repository';
import type { RequirementKind } from '../domain/missions/requirements';

export interface DashboardXp {
  totalXp: number;
  level: number;
  rankTitle: string;
  xpToNext: number | null;
  xpInLevel: number;
}

export interface DashboardStreak {
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
}

/** One step of a mission as the student sees it (RFC 0022 §6). */
export interface MissionStepView {
  /** Requirement id. */
  id: string;
  position: number;
  kind: RequirementKind;
  title: string;
  xpReward: number;
  /**
   * What the step points at. A topic or event the caller cannot open is returned
   * redacted: `accessible: false` / `slug: null`, no id and no title. `null` for
   * `manual_check`.
   */
  target:
    | { type: 'topic'; topicId: string | null; title: string | null; accessible: boolean }
    | { type: 'event'; slug: string | null; title: string | null; startsAt: string | null }
    | null;
  /** `manual_check` only; null for every other kind. */
  instructions: string | null;
  current: number;
  required: number;
  state: 'locked' | 'open' | 'completed';
  completedAt: string | null;
}

/** The caller's enrollment as the dashboard shows it; `implicit` = an `auto` mission without a row yet. */
export interface MissionEnrollmentView {
  source: 'auto' | 'self' | 'admin';
  joinedAt: string | null;
  implicit: boolean;
}

export interface DashboardMissionEntry {
  /** For a locked teaser only `mission.id` and `mission.title` are meaningful. */
  mission: Mission;
  /** Aggregate: completed steps / step count (or the legacy single bar). */
  progress: MissionProgress | null;
  // RFC 0022 additions — optional so a legacy producer keeps type-checking.
  enrollment?: MissionEnrollmentView | null;
  /** `open` mission, inside its window, caller not enrolled. */
  joinable?: boolean;
  /** Teaser of an `assigned` mission the caller is not in: reason and audience group names only. */
  locked?: { reason: 'assigned'; groups: string[] } | null;
  /** Ordered steps; `[]` for a legacy mission or a teaser. */
  steps?: MissionStepView[];
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
