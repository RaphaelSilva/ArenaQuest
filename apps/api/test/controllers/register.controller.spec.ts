import { describe, it, expect, beforeEach } from 'vitest';
import { RegisterController } from '@api/controllers/register.controller';
import type { RegistrationEvent } from '@api/core/registration/registration-events';
import type {
  IAuthAdapter,
  IUserRepository,
  CreateUserInput,
  UserRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeMockAuth(): IAuthAdapter {
  return {
    currentPbkdf2Iterations: 100_000,
    hashPassword: async (plain) => `pbkdf2:100000:salt:${plain}-hashed`,
    verifyPassword: async () => true,
    signAccessToken: async () => 'access',
    verifyAccessToken: async () => null,
    generateRefreshToken: async () => 'refresh',
  } as unknown as IAuthAdapter;
}

interface MockUserRepoState {
  byEmail: Map<string, UserRecord>;
  created: CreateUserInput[];
}

function makeMockUserRepo(seed?: { email: string }): { repo: IUserRepository; state: MockUserRepoState } {
  const state: MockUserRepoState = { byEmail: new Map(), created: [] };

  if (seed) {
    state.byEmail.set(seed.email, {
      id: 'existing-id',
      name: 'Existing',
      email: seed.email,
      status: Entities.Config.UserStatus.ACTIVE,
      roles: [],
      groups: [],
      createdAt: new Date(),
      passwordHash: 'pbkdf2:100000:salt:existing',
    });
  }

  const repo: IUserRepository = {
    findById: async () => null,
    findByEmail: async (email) => state.byEmail.get(email) ?? null,
    create: async (data) => {
      state.created.push(data);
      const user: Entities.Identity.User = {
        id: `new-${state.created.length}`,
        name: data.name,
        email: data.email,
        status: data.status ?? Entities.Config.UserStatus.ACTIVE,
        roles: (data.roleNames ?? []).map((name) => ({
          id: `role-${name}`,
          name,
          description: '',
          createdAt: new Date(),
        })),
        groups: [],
        createdAt: new Date(),
      };
      state.byEmail.set(data.email, { ...user, passwordHash: data.passwordHash });
      return user;
    },
    update: async () => { throw new Error('not used'); },
    delete: async () => {},
    list: async () => [],
    count: async () => state.byEmail.size,
    countActiveAdmins: async () => 0,
    updatePasswordHash: async () => {},
  };

  return { repo, state };
}

function captureEmitter() {
  const events: RegistrationEvent[] = [];
  const emit = (event: RegistrationEvent) => { events.push(event); };
  return { emit, events };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RegisterController', () => {
  let auth: IAuthAdapter;
  let emitter: ReturnType<typeof captureEmitter>;

  beforeEach(() => {
    auth = makeMockAuth();
    emitter = captureEmitter();
  });

  it('happy path: creates an INACTIVE user with role student and emits CREATED', async () => {
    const { repo, state } = makeMockUserRepo();
    const ctrl = new RegisterController(repo, auth, emitter.emit);

    const result = await ctrl.register({
      name: 'Joana Silva',
      email: 'joana@example.com',
      password: 'hunter22a',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('pending_activation');

    expect(state.created).toHaveLength(1);
    const created = state.created[0];
    expect(created.status).toBe(Entities.Config.UserStatus.INACTIVE);
    expect(created.roleNames).toEqual(['student']);
    expect(created.passwordHash).not.toBe('hunter22a');
    expect(created.passwordHash.startsWith('pbkdf2:')).toBe(true);

    expect(emitter.events).toHaveLength(1);
    expect(emitter.events[0]).toMatchObject({
      type: 'USER_REGISTRATION_CREATED',
      email: 'joana@example.com',
    });
  });

  it('email enumeration: duplicate email returns ok and emits DUPLICATE without inserting', async () => {
    const { repo, state } = makeMockUserRepo({ email: 'taken@example.com' });
    const ctrl = new RegisterController(repo, auth, emitter.emit);

    const result = await ctrl.register({
      name: 'Joana Silva',
      email: 'taken@example.com',
      password: 'hunter22a',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('pending_activation');

    expect(state.created).toHaveLength(0);
    expect(emitter.events).toEqual([
      { type: 'USER_REGISTRATION_DUPLICATE', email: 'taken@example.com' },
    ]);
  });

  it('email casing/trimming: normalizes to lowercase + trimmed before persist', async () => {
    const { repo, state } = makeMockUserRepo();
    const ctrl = new RegisterController(repo, auth, emitter.emit);

    const result = await ctrl.register({
      name: '  Joana  ',
      email: '  Joana@Example.COM  ',
      password: 'hunter22a',
    });

    expect(result.ok).toBe(true);
    expect(state.created[0].email).toBe('joana@example.com');
    expect(state.created[0].name).toBe('Joana');
  });

  it('duplicate detection is case-insensitive after normalization', async () => {
    const { repo, state } = makeMockUserRepo({ email: 'taken@example.com' });
    const ctrl = new RegisterController(repo, auth, emitter.emit);

    const result = await ctrl.register({
      name: 'Joana',
      email: 'TAKEN@EXAMPLE.COM',
      password: 'hunter22a',
    });

    expect(result.ok).toBe(true);
    expect(state.created).toHaveLength(0);
    expect(emitter.events[0].type).toBe('USER_REGISTRATION_DUPLICATE');
  });

  describe('validation failures', () => {
    it('missing name → 400 ValidationFailed with field=name', async () => {
      const { repo } = makeMockUserRepo();
      const ctrl = new RegisterController(repo, auth, emitter.emit);

      const result = await ctrl.register({
        name: '',
        email: 'joana@example.com',
        password: 'hunter22a',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe('ValidationFailed');
      const fields = (result.meta?.fields ?? []) as Array<{ field: string; code: string }>;
      expect(fields.some((f) => f.field === 'name')).toBe(true);
    });

    it('malformed email → 400 ValidationFailed with field=email', async () => {
      const { repo } = makeMockUserRepo();
      const ctrl = new RegisterController(repo, auth, emitter.emit);

      const result = await ctrl.register({
        name: 'Joana',
        email: 'not-an-email',
        password: 'hunter22a',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const fields = (result.meta?.fields ?? []) as Array<{ field: string; code: string }>;
      expect(fields.some((f) => f.field === 'email' && f.code === 'Invalid')).toBe(true);
    });

    it('password < 8 chars → 400 with field=password code=TooShort', async () => {
      const { repo } = makeMockUserRepo();
      const ctrl = new RegisterController(repo, auth, emitter.emit);

      const result = await ctrl.register({
        name: 'Joana',
        email: 'joana@example.com',
        password: 'short1',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const fields = (result.meta?.fields ?? []) as Array<{ field: string; code: string }>;
      expect(fields.some((f) => f.field === 'password' && f.code === 'TooShort')).toBe(true);
    });

    it('password without a digit → 400 with field=password code=NoDigit', async () => {
      const { repo } = makeMockUserRepo();
      const ctrl = new RegisterController(repo, auth, emitter.emit);

      const result = await ctrl.register({
        name: 'Joana',
        email: 'joana@example.com',
        password: 'allletters',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const fields = (result.meta?.fields ?? []) as Array<{ field: string; code: string }>;
      expect(fields.some((f) => f.field === 'password' && f.code === 'NoDigit')).toBe(true);
    });

    it('does not create or emit on validation failure', async () => {
      const { repo, state } = makeMockUserRepo();
      const ctrl = new RegisterController(repo, auth, emitter.emit);

      await ctrl.register({ name: '', email: 'bad', password: 'x' });

      expect(state.created).toHaveLength(0);
      expect(emitter.events).toHaveLength(0);
    });
  });

  it('hashing isolation: stored hash is not raw password and not a SHA-256 of it', async () => {
    const { repo, state } = makeMockUserRepo();
    const ctrl = new RegisterController(repo, auth, emitter.emit);

    await ctrl.register({
      name: 'Joana',
      email: 'joana@example.com',
      password: 'hunter22a',
    });

    const hash = state.created[0].passwordHash;
    expect(hash).not.toBe('hunter22a');

    const sha256Hex = async (input: string) => {
      const buf = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };
    expect(hash).not.toBe(await sha256Hex('hunter22a'));
  });
});
