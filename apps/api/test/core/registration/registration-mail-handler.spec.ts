import { describe, it, expect } from 'vitest';
import { buildRegistrationMailHandler } from '@api/core/registration/registration-mail-handler';
import type {
  IActivationTokenRepository,
  IMailer,
  IUserRepository,
  MailMessage,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeUserRepo(seed?: { id: string; name: string; email: string }): IUserRepository {
  const user = seed
    ? {
        id: seed.id,
        name: seed.name,
        email: seed.email,
        status: Entities.Config.UserStatus.INACTIVE,
        roles: [],
        groups: [],
        createdAt: new Date(),
      }
    : null;
  return {
    findById: async (id) => (user && id === user.id ? user : null),
    findByEmail: async (email) =>
      user && email === user.email
        ? { ...user, passwordHash: 'pbkdf2:100000:salt:fake' }
        : null,
    create: async () => { throw new Error('unused'); },
    update: async () => { throw new Error('unused'); },
    delete: async () => {},
    list: async () => [],
    count: async () => 0,
    countActiveAdmins: async () => 0,
    updatePasswordHash: async () => {},
  } as IUserRepository;
}

function makeTokenRepo() {
  const created: Array<{ plainToken: string; userId: string; expiresAt: Date }> = [];
  const repo: IActivationTokenRepository = {
    async create(input) { created.push(input); },
    async consumeByPlainToken() { return { outcome: 'invalid' }; },
    async purgeExpired() {},
  };
  return { repo, created };
}

function makeMailer() {
  const sent: MailMessage[] = [];
  const mailer: IMailer = { send: async (m) => { sent.push(m); } };
  return { mailer, sent };
}

function makeKv() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; ttl: number | undefined }> = [];
  return {
    store: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        store.set(key, value);
        puts.push({ key, ttl: opts?.expirationTtl });
      },
    },
    inner: store,
    puts,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildRegistrationMailHandler', () => {
  const baseUrl = 'https://web.example.com';

  it('CREATED: persists a token and sends an activation email with the link', async () => {
    const users = makeUserRepo({ id: 'u1', name: 'Joana', email: 'joana@example.com' });
    const tokens = makeTokenRepo();
    const mail = makeMailer();
    const kv = makeKv();

    const handler = buildRegistrationMailHandler({
      users,
      tokens: tokens.repo,
      mailer: mail.mailer,
      duplicateNoticeStore: kv.store,
      webBaseUrl: baseUrl,
    });

    await handler({ type: 'USER_REGISTRATION_CREATED', userId: 'u1', email: 'joana@example.com' });

    expect(tokens.created).toHaveLength(1);
    expect(tokens.created[0].userId).toBe('u1');
    expect(tokens.created[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('joana@example.com');
    expect(mail.sent[0].subject).toContain('Ative');
    const expectedBase = `${baseUrl}/activate?token=`;
    expect(mail.sent[0].html).toContain(expectedBase);
    expect(mail.sent[0].text).toContain(expectedBase);
  });

  it('DUPLICATE: idempotency key absent → sends notice and stamps KV with 24h TTL', async () => {
    const users = makeUserRepo({ id: 'u1', name: 'Joana', email: 'taken@example.com' });
    const tokens = makeTokenRepo();
    const mail = makeMailer();
    const kv = makeKv();

    const handler = buildRegistrationMailHandler({
      users,
      tokens: tokens.repo,
      mailer: mail.mailer,
      duplicateNoticeStore: kv.store,
      webBaseUrl: baseUrl,
    });

    await handler({ type: 'USER_REGISTRATION_DUPLICATE', email: 'taken@example.com' });

    expect(tokens.created).toHaveLength(0);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toContain('Tentativa');
    expect(mail.sent[0].html).not.toContain('/activate?token=');
    expect(mail.sent[0].html).toContain(`${baseUrl}/login`);

    expect(kv.puts).toHaveLength(1);
    expect(kv.puts[0].key).toBe('dup-reg:taken@example.com');
    expect(kv.puts[0].ttl).toBe(24 * 60 * 60);
  });

  it('DUPLICATE: idempotency key present → mailer is NOT called', async () => {
    const users = makeUserRepo({ id: 'u1', name: 'Joana', email: 'taken@example.com' });
    const tokens = makeTokenRepo();
    const mail = makeMailer();
    const kv = makeKv();
    kv.inner.set('dup-reg:taken@example.com', '1');

    const handler = buildRegistrationMailHandler({
      users,
      tokens: tokens.repo,
      mailer: mail.mailer,
      duplicateNoticeStore: kv.store,
      webBaseUrl: baseUrl,
    });

    await handler({ type: 'USER_REGISTRATION_DUPLICATE', email: 'taken@example.com' });

    expect(mail.sent).toHaveLength(0);
  });

  it('mailer throws → handler logs but does not rethrow', async () => {
    const users = makeUserRepo({ id: 'u1', name: 'Joana', email: 'joana@example.com' });
    const tokens = makeTokenRepo();
    const failingMailer: IMailer = {
      send: async () => { throw new Error('SMTP outage'); },
    };
    const kv = makeKv();

    const handler = buildRegistrationMailHandler({
      users,
      tokens: tokens.repo,
      mailer: failingMailer,
      duplicateNoticeStore: kv.store,
      webBaseUrl: baseUrl,
    });

    await expect(
      handler({ type: 'USER_REGISTRATION_CREATED', userId: 'u1', email: 'joana@example.com' }),
    ).resolves.toBeUndefined();
  });

  it('CREATED token is base64url and ≥ 32 bytes worth of entropy', async () => {
    const users = makeUserRepo({ id: 'u1', name: 'Joana', email: 'joana@example.com' });
    const tokens = makeTokenRepo();
    const mail = makeMailer();
    const kv = makeKv();

    const handler = buildRegistrationMailHandler({
      users,
      tokens: tokens.repo,
      mailer: mail.mailer,
      duplicateNoticeStore: kv.store,
      webBaseUrl: baseUrl,
    });

    await handler({ type: 'USER_REGISTRATION_CREATED', userId: 'u1', email: 'joana@example.com' });

    const token = tokens.created[0].plainToken;
    // base64url of 32 bytes → 43 chars (no padding).
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
