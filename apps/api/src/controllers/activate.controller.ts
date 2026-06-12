import { z } from 'zod';
import type { IActivationTokenRepository } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import { ActivateRequestSchema } from '@api/openapi/components/entities';

export type ActivateInput = z.infer<typeof ActivateRequestSchema>;

export type ActivateSuccess = { status: 'activated' | 'already_active' };

export class ActivateController {
  constructor(private readonly tokens: IActivationTokenRepository) {}

  async activate(input: ActivateInput): Promise<ControllerResult<ActivateSuccess>> {
    const result = await this.tokens.consumeByPlainToken(input.token);
    if (result.outcome === 'invalid') {
      return { ok: false, status: 400, error: 'InvalidToken' };
    }

    return { ok: true, data: { status: result.outcome } };
  }
}
