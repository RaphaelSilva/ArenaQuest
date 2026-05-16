import { z } from 'zod';
import type { IGamificationRepository, LeaderboardRow, UserRankRecord } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

export const LeaderboardQuerySchema = z.object({
  scope: z.enum(['global', 'topic']).default('global'),
  topicId: z.string().optional(),
  period: z.enum(['all_time', 'week']).default('all_time'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  me: UserRankRecord;
  total: number;
  limit: number;
  offset: number;
}

export class LeaderboardController {
  constructor(private readonly gamification: IGamificationRepository) {}

  async getLeaderboard(
    userId: string,
    query: LeaderboardQuery,
    userTimezone: string | null,
  ): Promise<ControllerResult<LeaderboardResponse>> {
    const { scope, topicId, period, limit, offset } = query;

    if (scope === 'topic' && !topicId) {
      return { ok: false, status: 400, error: 'BadRequest', meta: { detail: 'topicId is required when scope=topic' } };
    }

    const weekStart = period === 'week' ? resolveWeekStart(userTimezone) : undefined;

    const params = { scope, topicId, period, weekStart, limit, offset };

    const [leaderboard, me] = await Promise.all([
      this.gamification.getLeaderboard(params),
      this.gamification.getUserRank(userId, { scope, topicId, period, weekStart }),
    ]);

    return {
      ok: true,
      data: {
        rows: leaderboard.rows,
        me,
        total: leaderboard.total,
        limit,
        offset,
      },
    };
  }
}

function resolveWeekStart(timezone: string | null): string {
  const tz = timezone ?? 'UTC';
  const now = new Date();

  try {
    // Get local date components in user's timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const localDateStr = formatter.format(now); // YYYY-MM-DD
    const [year, month, day] = localDateStr.split('-').map(Number);
    const localDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = localDate.getUTCDay(); // 0=Sun
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    localDate.setUTCDate(localDate.getUTCDate() + daysToMonday);
    return localDate.toISOString().slice(0, 10) + 'T00:00:00.000Z';
  } catch {
    // Fallback to UTC Monday
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10) + 'T00:00:00.000Z';
  }
}
