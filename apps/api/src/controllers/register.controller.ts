import { z } from 'zod';
import type { IAuthAdapter, IUserRepository } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';
import type { RegistrationEventEmitter } from '@api/core/registration/registration-events';

// Password policy: ≥8 chars, at least one digit. Codes are stable identifiers
// the frontend renders into localized copy — keep them lowercase-free, terse.
const PASSWORD_MIN = 8;
const NAME_MIN = 2;
const NAME_MAX = 80;

const RegisterSchema = z.object({
  name: z.string().trim().min(NAME_MIN, 'TooShort').max(NAME_MAX, 'TooLong'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid'),
  password: z
    .string()
    .min(PASSWORD_MIN, 'TooShort')
    .regex(/\d/, 'NoDigit'),
});

export type RegisterInput = z.input<typeof RegisterSchema>;

export type RegisterSuccess = { status: 'pending_activation' };

export interface ValidationFieldError {
  field: 'name' | 'email' | 'password';
  code: string;
}

export class RegisterController {
  constructor(
    private readonly users: IUserRepository,
    private readonly auth: IAuthAdapter,
    private readonly emit: RegistrationEventEmitter,
  ) {}

  async register(input: unknown): Promise<ControllerResult<RegisterSuccess>> {
    const parsed = RegisterSchema.safeParse(input);
    if (!parsed.success) {
      const fields: ValidationFieldError[] = parsed.error.issues.map((issue) => ({
        field: (issue.path[0] as ValidationFieldError['field']) ?? 'name',
        code: issue.message || 'Invalid',
      }));
      return {
        ok: false,
        status: 400,
        error: 'ValidationFailed',
        meta: { fields },
      };
    }

    const { name, email, password } = parsed.data;

    const existing = await this.users.findByEmail(email);
    if (existing) {
      // S-anti-enumeration: respond with the same shape as the happy path so
      // the public API cannot be used to probe which addresses are registered.
      // The "someone tried to register with your email" notice is delivered
      // out-of-band by the activation-email handler (Task 02).
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
