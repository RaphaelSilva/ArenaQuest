import { z } from 'zod';
import type { IGamificationRepository, LevelDefinitionRecord } from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';

const LevelDefinitionInputSchema = z.object({
  level: z.number().int(),
  rankTitle: z.string().min(1),
  minXp: z.number().int().min(0),
  maxXp: z.number().int().nullable(),
});

const ReplaceLevelsBodySchema = z.array(LevelDefinitionInputSchema).min(1);

export type ReplaceLevelsInput = z.infer<typeof ReplaceLevelsBodySchema>;

export class AdminLevelsController {
  constructor(private readonly repo: IGamificationRepository) {}

  async list(): Promise<ControllerResult<Entities.Gamification.LevelDefinition[]>> {
    const data = await this.repo.listLevelDefinitions();
    return { ok: true, data };
  }

  async replaceAll(body: unknown): Promise<ControllerResult<Entities.Gamification.LevelDefinition[]>> {
    const parsed = ReplaceLevelsBodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        status: 400,
        error: 'ValidationError',
        meta: { message: 'Invalid level definitions payload.', issues: parsed.error.issues },
      };
    }

    const rows: LevelDefinitionRecord[] = [...parsed.data].sort((a, b) => a.level - b.level);

    const curveError = validateCurve(rows);
    if (curveError) {
      return { ok: false, status: 400, error: 'ValidationError', meta: { message: curveError } };
    }

    const data = await this.repo.replaceAllLevelDefinitions(rows);
    return { ok: true, data };
  }
}

/**
 * Validate the level curve. Expects `rows` already sorted ascending by level.
 * Returns a clear error message on the first violation, or `null` when valid.
 */
function validateCurve(rows: LevelDefinitionRecord[]): string | null {
  // Levels must be contiguous (each = previous + 1) starting from the lowest provided.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].level !== rows[i - 1].level + 1) {
      return `Levels must be contiguous: expected level ${rows[i - 1].level + 1} after ${rows[i - 1].level}, got ${rows[i].level}.`;
    }
  }

  // minXp strictly increasing across the ordered rows.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].minXp <= rows[i - 1].minXp) {
      return `minXp must be strictly increasing: level ${rows[i].level} has minXp ${rows[i].minXp}, not greater than level ${rows[i - 1].level} (${rows[i - 1].minXp}).`;
    }
  }

  // Exactly one row has maxXp === null, and it must be the highest-level (last) row.
  const openRows = rows.filter((r) => r.maxXp === null);
  if (openRows.length !== 1) {
    return `Exactly one level must have maxXp = null (the final, open-ended level); found ${openRows.length}.`;
  }
  if (rows[rows.length - 1].maxXp !== null) {
    return 'The open-ended level (maxXp = null) must be the highest level.';
  }

  // Contiguity: every non-final row's maxXp equals the next row's minXp, and maxXp > minXp.
  for (let i = 0; i < rows.length - 1; i++) {
    const row = rows[i];
    if (row.maxXp === null) {
      // Already guaranteed to be the last row above, but guard for safety.
      return 'Only the highest level may have maxXp = null.';
    }
    if (row.maxXp <= row.minXp) {
      return `maxXp must be greater than minXp: level ${row.level} has minXp ${row.minXp} and maxXp ${row.maxXp}.`;
    }
    if (row.maxXp !== rows[i + 1].minXp) {
      return `Curve has a gap or overlap: level ${row.level} maxXp (${row.maxXp}) must equal level ${rows[i + 1].level} minXp (${rows[i + 1].minXp}).`;
    }
  }

  return null;
}
