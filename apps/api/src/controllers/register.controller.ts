import { z } from 'zod';
import type { IAuthAdapter, IUserRepository } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';
import type { RegistrationEventEmitter } from '@api/core/registration/registration-events';
import { RegisterRequestSchema } from '@api/openapi/components/entities';

export type RegisterInput = z.infer<typeof RegisterRequestSchema>;

export type RegisterSuccess = { status: 'pending_activation' };

export class RegisterController {
  constructor(
    private readonly users: IUserRepository,
    private readonly auth: IAuthAdapter,
    private readonly emit: RegistrationEventEmitter,
  ) {}

  async register(input: RegisterInput): Promise<ControllerResult<RegisterSuccess>> {
    const { name, email, password } = input;

    const existing = await this.users.findByEmail(email);
    if (existing) {
      // S-anti-enumeration: respond with the same shape as the happy path so
      // the public API cannot be used to probe which addresses are registered.
      await this.safeEmit({ type: 'USER_REGISTRATION_DUPLICATE', email });
      return { ok: true, data: { status: 'pending_activation' } };
    }

    const passwordHash = await this.auth.hashPassword(password);
    const user = await this.users.create({
      name,
      email,
      passwordHash,
      status: Entities.Config.UserStatus.INACTIVE,
      roleNames: ['student'],
    });

    await this.safeEmit({
      type: 'USER_REGISTRATION_CREATED',
      userId: user.id,
      email: user.email,
    });

    return { ok: true, data: { status: 'pending_activation' } };
  }

  private async safeEmit(event: Parameters<RegistrationEventEmitter>[0]): Promise<void> {
    try {
      await this.emit(event);
    } catch (err) {
      console.error('[register] emitter failed', err);
    }
  }
}
