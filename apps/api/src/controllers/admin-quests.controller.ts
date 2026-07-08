import { z } from 'zod';
import type { IQuestRepository } from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';

const jsonString = z.string().refine(
  (value) => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'predicateParams must be a valid JSON string' },
);

const createSchema = z.object({
  kind: z.enum(['daily', 'weekly']),
  title: z.string().min(1),
  description: z.string().min(1),
  predicateKind: z.string().min(1),
  predicateParams: jsonString,
  xpReward: z.number().int().min(0),
  active: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

type QuestDefinition = Entities.Gamification.QuestDefinition;

export class AdminQuestsController {
  constructor(private readonly repo: IQuestRepository) {}

  async list(): Promise<ControllerResult<QuestDefinition[]>> {
    const data = await this.repo.listAll();
    return { ok: true, data };
  }

  async create(body: unknown, canEditEconomy: boolean): Promise<ControllerResult<QuestDefinition>> {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'ValidationError', meta: parsed.error.flatten() };
    }

    // Economy role gate: setting xpReward on create requires economy rights.
    const xpRewardProvided =
      typeof body === 'object' && body !== null && 'xpReward' in body;
    if (!canEditEconomy && xpRewardProvided) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    const data = await this.repo.create(parsed.data);
    return { ok: true, data };
  }

  async update(id: string, body: unknown, canEditEconomy: boolean): Promise<ControllerResult<QuestDefinition>> {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'ValidationError', meta: parsed.error.flatten() };
    }

    const existing = await this.repo.update(id, {});
    if (!existing) return { ok: false, status: 404, error: 'NotFound' };

    // Economy role gate: changing xpReward requires economy rights.
    if (
      !canEditEconomy &&
      parsed.data.xpReward !== undefined &&
      parsed.data.xpReward !== existing.xpReward
    ) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    const data = await this.repo.update(id, parsed.data);
    if (!data) return { ok: false, status: 404, error: 'NotFound' };
    return { ok: true, data };
  }

  async delete(id: string): Promise<ControllerResult<{ success: true }>> {
    const removed = await this.repo.delete(id);
    if (!removed) return { ok: false, status: 404, error: 'NotFound' };
    return { ok: true, data: { success: true } };
  }
}
