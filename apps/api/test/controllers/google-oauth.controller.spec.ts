import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleOAuthController } from '@api/controllers/google-oauth.controller';
import type { IOAuthAccountRepository, IUserRepository } from '@arenaquest/shared/ports';
import type { AuthService } from '@api/core/auth/auth-service';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKv(): KVNamespace & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: vi.fn(async (key: string, typeOrOptions?: string | KVNamespaceGetOptions<unknown>) => {
      const val = data.get(key);
      if (val === undefined) return null;
      const type = typeof typeOrOptions === 'string' ? typeOrOptions : (typeOrOptions as KVNamespaceGetOptions<unknown> | undefined)?.type;
      return type === 'json' ? JSON.parse(val) : val;
    }),
    put: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
    delete: vi.fn(async (key: string) => { data.delete(key); }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, caret: undefined })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  } as unknown as KVNamespace & { data: Map<string, string> };
}

const TEST_USER: Entities.Identity.User = {
  id: 'user-oauth-1',
  name: 'Alice',
  email: 'alice@example.com',
  status: Entities.Config.UserStatus.ACTIVE,
  roles: [{ id: 'r1', name: 'student', description: '', createdAt: new Date() }],
  groups: [],
  createdAt: new Date(),
};

function makeOAuthRepo(linkedUser: Entities.Identity.User | null = null): IOAuthAccountRepository {
  return {
    findUserByProvider: vi.fn(async () => linkedUser),
    link: vi.fn(async () => {}),
    findByUser: vi.fn(async () => null),
  };
}

function makeUserRepo(byEmail: Entities.Identity.User | null = null): IUserRepository {
  const created = { ...TEST_USER, id: 'user-new-1' };
  return {
    findById: vi.fn(async () => null),
    findByEmail: vi.fn(async () => (byEmail ? { ...byEmail, passwordHash: '' } : null)),
    create: vi.fn(async () => created),
    update: vi.fn(async () => TEST_USER),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    countActiveAdmins: vi.fn(async () => 1),
    updatePasswordHash: vi.fn(async () => {}),
  };
}

function makeAuthService(): Pick<AuthService, 'loginWithOAuth'> {
  return {
    loginWithOAuth: vi.fn(async (user) => ({
      accessToken: `access.${user.id}`,
      refreshToken: `refresh.${user.id}`,
      user,
    })),
  };
}

function makeController(opts: {
  oauthRepo?: IOAuthAccountRepository;
  userRepo?: IUserRepository;
  kv?: KVNamespace & { data: Map<string, string> };
} = {}) {
  const kv = opts.kv ?? makeKv();
  const oauthRepo = opts.oauthRepo ?? makeOAuthRepo();
  const userRepo = opts.userRepo ?? makeUserRepo();
  const authService = makeAuthService();

  const ctrl = new GoogleOAuthController(
    {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:8787/auth/google/callback',
      webBaseUrl: 'http://localhost:3000',
    },
    kv,
    oauthRepo,
    userRepo,
    authService as unknown as AuthService,
  );
  return { ctrl, kv, oauthRepo, userRepo, authService };
}

// Encode a fake Google id_token payload (base64url)
function makeIdToken(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.fake-sig`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// initiateFlow
// ---------------------------------------------------------------------------

describe('GoogleOAuthController.initiateFlow', () => {
  it('returns a redirect URL to Google authorization endpoint', async () => {
    const { ctrl } = makeController();
    const { redirectUrl } = await ctrl.initiateFlow();
    expect(redirectUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
  });

  it('includes required query params', async () => {
    const { ctrl } = makeController();
    const { redirectUrl } = await ctrl.initiateFlow();
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
  });

  it('stores the code verifier in KV with a 5-minute TTL', async () => {
    const kv = makeKv();
    const { ctrl } = makeController({ kv });
    const { redirectUrl } = await ctrl.initiateFlow();
    const state = new URL(redirectUrl).searchParams.get('state')!;

    const stored = await kv.get(`oauth:state:${state}`, 'json') as { codeVerifier: string };
    expect(stored).not.toBeNull();
    expect(stored.codeVerifier).toBeTypeOf('string');
    expect(stored.codeVerifier.length).toBeGreaterThan(0);
  });

  it('each call generates a unique state nonce', async () => {
    const { ctrl } = makeController();
    const { redirectUrl: url1 } = await ctrl.initiateFlow();
    const { redirectUrl: url2 } = await ctrl.initiateFlow();
    const state1 = new URL(url1).searchParams.get('state');
    const state2 = new URL(url2).searchParams.get('state');
    expect(state1).not.toBe(state2);
  });
});

// ---------------------------------------------------------------------------
// handleCallback
// ---------------------------------------------------------------------------

describe('GoogleOAuthController.handleCallback', () => {
  it('returns 400 for a missing state', async () => {
    const { ctrl } = makeController();
    const result = await ctrl.handleCallback(null, 'some-code');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 for a missing code', async () => {
    const { ctrl } = makeController();
    const result = await ctrl.handleCallback('some-state', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 InvalidOAuthState for a state not in KV', async () => {
    const { ctrl } = makeController();
    const result = await ctrl.handleCallback('nonexistent-state', 'some-code');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('InvalidOAuthState');
  });

  it('returns 400 OAuthTokenExchangeFailed when Google returns non-2xx', async () => {
    const kv = makeKv();
    await kv.put('oauth:state:test-state', JSON.stringify({ codeVerifier: 'verifier-abc' }));

    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 400 })));

    const { ctrl } = makeController({ kv });
    const result = await ctrl.handleCallback('test-state', 'bad-code');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('OAuthTokenExchangeFailed');
  });

  it('deletes the KV state entry after use (one-time nonce)', async () => {
    const kv = makeKv();
    await kv.put('oauth:state:test-state', JSON.stringify({ codeVerifier: 'verifier-abc' }));

    const idToken = makeIdToken({ sub: 'g-sub-1', email: 'new@test.com', name: 'New User' });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
    ));

    const oauthRepo = makeOAuthRepo(null);
    const userRepo = makeUserRepo(null);
    const { ctrl } = makeController({ kv, oauthRepo, userRepo });

    await ctrl.handleCallback('test-state', 'auth-code');
    const remaining = await kv.get('oauth:state:test-state');
    expect(remaining).toBeNull();
  });

  it('authenticates a returning Google user without creating a new account', async () => {
    const kv = makeKv();
    await kv.put('oauth:state:test-state', JSON.stringify({ codeVerifier: 'verifier-abc' }));

    const idToken = makeIdToken({ sub: 'g-sub-1', email: TEST_USER.email, name: TEST_USER.name });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
    ));

    const oauthRepo = makeOAuthRepo(TEST_USER);
    const userRepo = makeUserRepo();
    const { ctrl, authService } = makeController({ kv, oauthRepo, userRepo });

    const result = await ctrl.handleCallback('test-state', 'auth-code');

    expect(result.ok).toBe(true);
    expect(vi.mocked(oauthRepo.link)).not.toHaveBeenCalled();
    expect(vi.mocked(authService.loginWithOAuth)).toHaveBeenCalledWith(TEST_USER);
  });

  it('links an existing email user to Google on first OAuth login', async () => {
    const kv = makeKv();
    await kv.put('oauth:state:test-state', JSON.stringify({ codeVerifier: 'verifier-abc' }));

    const idToken = makeIdToken({ sub: 'g-sub-1', email: TEST_USER.email, name: TEST_USER.name });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
    ));

    const oauthRepo = makeOAuthRepo(null);
    const userRepo = makeUserRepo(TEST_USER);
    const { ctrl } = makeController({ kv, oauthRepo, userRepo });

    const result = await ctrl.handleCallback('test-state', 'auth-code');

    expect(result.ok).toBe(true);
    expect(vi.mocked(oauthRepo.link)).toHaveBeenCalledWith('google', 'g-sub-1', TEST_USER.id, TEST_USER.email);
    expect(vi.mocked(userRepo.create)).not.toHaveBeenCalled();
  });

  it('creates a new student user for a brand-new Google identity', async () => {
    const kv = makeKv();
    await kv.put('oauth:state:test-state', JSON.stringify({ codeVerifier: 'verifier-abc' }));

    const idToken = makeIdToken({ sub: 'g-sub-new', email: 'brand-new@test.com', name: 'Brand New' });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
    ));

    const oauthRepo = makeOAuthRepo(null);
    const userRepo = makeUserRepo(null);
    const { ctrl } = makeController({ kv, oauthRepo, userRepo });

    const result = await ctrl.handleCallback('test-state', 'auth-code');

    expect(result.ok).toBe(true);
    expect(vi.mocked(userRepo.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'brand-new@test.com',
        name: 'Brand New',
        status: Entities.Config.UserStatus.ACTIVE,
        roleNames: ['student'],
      }),
    );
    expect(vi.mocked(oauthRepo.link)).toHaveBeenCalledWith('google', 'g-sub-new', 'user-new-1', 'brand-new@test.com');
  });

  it('redirect URL points to webBaseUrl/auth/callback with accessToken param', async () => {
    const kv = makeKv();
    await kv.put('oauth:state:test-state', JSON.stringify({ codeVerifier: 'verifier-abc' }));

    const idToken = makeIdToken({ sub: 'g-sub-1', email: TEST_USER.email, name: TEST_USER.name });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
    ));

    const { ctrl } = makeController({ kv, oauthRepo: makeOAuthRepo(TEST_USER) });
    const result = await ctrl.handleCallback('test-state', 'auth-code');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.redirectUrl).toContain('http://localhost:3000/auth/callback');
      expect(result.data.redirectUrl).toContain('accessToken=');
      expect(result.data.refreshToken).toBeTruthy();
    }
  });
});
