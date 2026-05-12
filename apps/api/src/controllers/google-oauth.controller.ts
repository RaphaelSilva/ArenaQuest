import type { IOAuthAccountRepository, IUserRepository } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { AuthService } from '@api/core/auth/auth-service';
import type { ControllerResult } from '@api/core/result';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webBaseUrl: string;
}

const STATE_TTL_SECONDS = 300; // 5 minutes
const STATE_KV_PREFIX = 'oauth:state:';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateRandom(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

async function deriveCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(digest));
}

function parseIdToken(idToken: string): { sub: string; email: string; name: string } {
  const segments = idToken.split('.');
  if (segments.length < 2) throw new Error('Malformed id_token');
  const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/');
  const decoded = JSON.parse(atob(payload));
  return {
    sub: String(decoded.sub),
    email: String(decoded.email),
    name: String(decoded.name ?? decoded.email),
  };
}

export interface CallbackResult {
  accessToken: string;
  refreshToken: string;
  redirectUrl: string;
}

export class GoogleOAuthController {
  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly kv: KVNamespace,
    private readonly oauthAccounts: IOAuthAccountRepository,
    private readonly users: IUserRepository,
    private readonly authService: AuthService,
  ) {}

  async initiateFlow(): Promise<{ redirectUrl: string }> {
    const state = generateRandom(32);
    const codeVerifier = generateRandom(32);
    const codeChallenge = await deriveCodeChallenge(codeVerifier);

    await this.kv.put(
      `${STATE_KV_PREFIX}${state}`,
      JSON.stringify({ codeVerifier }),
      { expirationTtl: STATE_TTL_SECONDS },
    );

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return { redirectUrl: url.toString() };
  }

  async handleCallback(
    state: string | null,
    code: string | null,
  ): Promise<ControllerResult<CallbackResult>> {
    if (!state || !code) {
      return { ok: false, status: 400, error: 'BadRequest' };
    }

    const kvKey = `${STATE_KV_PREFIX}${state}`;
    const stored = await this.kv.get(kvKey, 'json') as { codeVerifier: string } | null;

    if (!stored?.codeVerifier) {
      return { ok: false, status: 400, error: 'InvalidOAuthState' };
    }

    await this.kv.delete(kvKey);

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
        code,
        code_verifier: stored.codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      return { ok: false, status: 400, error: 'OAuthTokenExchangeFailed' };
    }

    let idToken: string;
    try {
      const body = await tokenRes.json<{ id_token?: string }>();
      if (!body.id_token) throw new Error('Missing id_token');
      idToken = body.id_token;
    } catch {
      return { ok: false, status: 400, error: 'OAuthTokenExchangeFailed' };
    }

    let identity: { sub: string; email: string; name: string };
    try {
      identity = parseIdToken(idToken);
    } catch {
      return { ok: false, status: 400, error: 'OAuthTokenExchangeFailed' };
    }

    const user = await this.resolveUser(identity.sub, identity.email, identity.name);
    const { accessToken, refreshToken } = await this.authService.loginWithOAuth(user);

    const baseUrl = this.config.webBaseUrl.replace(/\/+$/, '');
    const redirectUrl = `${baseUrl}/auth/callback?accessToken=${encodeURIComponent(accessToken)}`;

    return { ok: true, data: { accessToken, refreshToken, redirectUrl } };
  }

  private async resolveUser(
    sub: string,
    email: string,
    name: string,
  ): Promise<Entities.Identity.User> {
    const existing = await this.oauthAccounts.findUserByProvider('google', sub);
    if (existing) return existing;

    const byEmail = await this.users.findByEmail(email);
    if (byEmail) {
      await this.oauthAccounts.link('google', sub, byEmail.id, email);
      return byEmail;
    }

    const created = await this.users.create({
      name,
      email,
      passwordHash: '',
      status: Entities.Config.UserStatus.ACTIVE,
      roleNames: ['student'],
    });
    await this.oauthAccounts.link('google', sub, created.id, email);
    return created;
  }
}
