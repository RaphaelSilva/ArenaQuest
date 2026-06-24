import { z } from 'zod';
import type { IMissionRepository } from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  predicateKind: z.string().min(1),
  predicateParams: z.string().min(1),
  xpReward: z.number().int().min(0),
  badgeId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional().default(true),
});

const updateSchema = createSchema.partial().extend({
  active: z.boolean().optional(),
});

export class AdminMissionsController {
  constructor(private readonly repo: IMissionRepository) {}

  async list(): Promise<ControllerResult<Entities.Gamification.Mission[]>> {
    const data = await this.repo.listAll();
    return { ok: true, data };
  }

  async create(body: unknown): Promise<ControllerResult<Entities.Gamification.Mission>> {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'ValidationError', meta: parsed.error.flatten() };
    }

    const { startAt, endAt } = parsed.data;
    if (new Date(endAt) <= new Date(startAt)) {
      return { 
        ok: false, 
        status: 400, 
        error: 'ValidationError', 
        meta: { formErrors: ['Mission must end after it starts'] } 
      };
    }

    const data = await this.repo.create({
      ...parsed.data,
      badgeId: parsed.data.badgeId ?? null,
    });
    return { ok: true, data };
  }

  async update(id: string, body: unknown): Promise<ControllerResult<Entities.Gamification.Mission>> {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'ValidationError', meta: parsed.error.flatten() };
    }

    const existing = await this.repo.findById(id);
    if (!existing) return { ok: false, status: 404, error: 'NotFound' };

    const { startAt, endAt } = parsed.data;
    const finalStart = startAt ? new Date(startAt) : new Date(existing.startAt);
    const finalEnd = endAt ? new Date(endAt) : new Date(existing.endAt);

    if (finalEnd <= finalStart) {
      return { 
        ok: false, 
        status: 400, 
        error: 'ValidationError', 
        meta: { formErrors: ['Mission must end after it starts'] } 
      };
    }

    // AC: rejects shortening it below now
    if (endAt) {
      const newEnd = new Date(endAt);
      const now = new Date();
      if (newEnd < now && newEnd < new Date(existing.endAt)) {
        return { 
          ok: false, 
          status: 400, 
          error: 'ValidationError', 
          meta: { formErrors: ['Cannot shorten mission end date below current time'] } 
        };
      }
    }

    const data = await this.repo.update(id, {
      ...parsed.data,
      badgeId: parsed.data.badgeId === undefined ? undefined : (parsed.data.badgeId ?? null),
    });
    return { ok: true, data };
  }

  async delete(id: string): Promise<ControllerResult<{ success: true }>> {
    const existing = await this.repo.findById(id);
    if (!existing) return { ok: false, status: 404, error: 'NotFound' };

    await this.repo.update(id, { active: false });
    return { ok: true, data: { success: true } };
  }
}
