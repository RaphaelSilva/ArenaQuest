import type { IGamificationRepository, XpEventRecord } from '../../ports/i-gamification-repository';
import type { XpAction } from './xp-config';
import { XP_POINTS } from './xp-config';

export interface XpAwardParams {
  userId: string;
  action: XpAction;
  sourceKind: string;
  sourceId?: string | null;
  version?: string;
}

export class XpEngine {
  constructor(
    private readonly repo: IGamificationRepository,
    private readonly enabled: boolean = true,
  ) {}

  async award(params: XpAwardParams): Promise<XpEventRecord | null> {
    if (!this.enabled) return null;
    const { userId, action, sourceKind, sourceId, version = 'v1' } = params;
    const points = XP_POINTS[action];
    const idempotencyKey = `${sourceKind}:${sourceId ?? 'none'}:${version}`;
    return this.repo.appendXpEvent({ userId, sourceKind, sourceId: sourceId ?? null, points, idempotencyKey });
  }
}
