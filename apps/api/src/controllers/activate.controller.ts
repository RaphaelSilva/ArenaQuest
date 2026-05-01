import { z } from 'zod';
import type { IActivationTokenRepository } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

const ActivateSchema = z.object({
  token: z.string().min(1),
});

export type ActivateSuccess = { status: 'activated' | 'already_active' };

export class ActivateController {
  constructor(private readonly tokens: IActivationTokenRepository) {}

  async activate(input: unknown): Promise<ControllerResult<ActivateSuccess>> {
    const parsed = ActivateSchema.safeParse(input);
    if (!parsed.success) {
      // No oracle: a missing/malformed token shape collapses into the same
      // error string as an unknown/expired token.
      return { ok: false, status: 400, error: 'InvalidToken' };
    }

    const result = await this.tokens.consumeByPlainToken(parsed.data.token);
    if (result.outcome === 'invalid') {
      return { ok: false, status: 400, error: 'InvalidToken' };
    }

    return { ok: true, data: { status: result.outcome } };
  }
}
