import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker, { type AppEnv } from '../../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function options(path: string, origin: string, overrideEnv?: Partial<AppEnv>): Promise<Response> {
  const req = new IncomingRequest(`http://example.com${path}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, ...overrideEnv } as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function get(path: string, origin: string, overrideEnv?: Partial<AppEnv>): Promise<Response> {
  const req = new IncomingRequest(`http://example.com${path}`, {
    method: 'GET',
    headers: { Origin: origin },
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, ...overrideEnv } as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// The allowed origin as configured in .dev.vars (takes precedence over wrangler.jsonc in tests).
// `env.ALLOWED_ORIGINS` is set to "http://localhost:3000" from .dev.vars during vitest runs.
const ALLOWED_ORIGIN = env.ALLOWED_ORIGINS as string;
const EVIL_ORIGIN = 'https://evil.com';

// ---------------------------------------------------------------------------
// Task 01 — baseline exact-match tests
// ---------------------------------------------------------------------------

describe('CORS — preflight (OPTIONS /health)', () => {
  it('echoes the allowed origin back in ACAO header', async () => {
    const res = await options('/health', ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
  });

  it('sets Access-Control-Allow-Credentials: true for allowed origin', async () => {
    const res = await options('/health', ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('does NOT echo a disallowed origin in the ACAO header', async () => {
    const res = await options('/health', EVIL_ORIGIN);
    const acao = res.headers.get('Access-Control-Allow-Origin');
    // hono/cors returns null string or omits the header entirely when matcher returns null
    expect(acao).not.toBe(EVIL_ORIGIN);
  });
});

describe('CORS — simple request (GET /health)', () => {
  it('sets ACAO header for an allowed origin', async () => {
    const res = await get('/health', ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
  });

  it('does NOT set ACAO header for a disallowed origin', async () => {
    const res = await get('/health', EVIL_ORIGIN);
    const acao = res.headers.get('Access-Control-Allow-Origin');
    expect(acao).not.toBe(EVIL_ORIGIN);
  });
});

describe('CORS — no console.log regression', () => {
  it('does NOT set ACAO header for origins outside the allowed list', async () => {
    const res = await get('/health', EVIL_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe(EVIL_ORIGIN);
  });
});

// ---------------------------------------------------------------------------
// Task 02 — wildcard pattern matching
// ---------------------------------------------------------------------------

describe('CORS — wildcard-host: https://*.pages.dev', () => {
  const WILDCARD_ENV = { ALLOWED_ORIGINS: 'https://*.pages.dev' };

  it('echoes a matching preview origin in ACAO header (OPTIONS)', async () => {
    const previewOrigin = 'https://preview.pages.dev';
    const res = await options('/health', previewOrigin, WILDCARD_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(previewOrigin);
  });

  it('sets Access-Control-Allow-Credentials for the matched preview origin', async () => {
    const previewOrigin = 'https://abc.pages.dev';
    const res = await options('/health', previewOrigin, WILDCARD_ENV);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('does NOT echo a suffix-injection attack origin', async () => {
    const attackOrigin = 'https://evil.pages.dev.attacker.com';
    const res = await options('/health', attackOrigin, WILDCARD_ENV);
    const acao = res.headers.get('Access-Control-Allow-Origin');
    expect(acao).not.toBe(attackOrigin);
  });

  it('does NOT echo a deep subdomain (two labels before suffix)', async () => {
    const deepOrigin = 'https://a.b.pages.dev';
    const res = await options('/health', deepOrigin, WILDCARD_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe(deepOrigin);
  });

  it('does NOT echo an unrelated origin', async () => {
    const res = await options('/health', EVIL_ORIGIN, WILDCARD_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe(EVIL_ORIGIN);
  });
});

describe('CORS — full wildcard "*" with credentials', () => {
  const WILDCARD_ALL_ENV = { ALLOWED_ORIGINS: '*' };

  it('echoes the request origin (not "*") in ACAO header', async () => {
    const randomOrigin = 'https://random.example';
    const res = await options('/health', randomOrigin, WILDCARD_ALL_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(randomOrigin);
  });

  it('never returns the literal "*" as ACAO value', async () => {
    const res = await options('/health', 'https://anything.example', WILDCARD_ALL_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('still sets Access-Control-Allow-Credentials: true', async () => {
    const res = await options('/health', 'https://anything.example', WILDCARD_ALL_ENV);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});

describe('CORS — mixed exact + wildcard list', () => {
  const MIXED_ENV = {
    ALLOWED_ORIGINS: 'https://app.arenaquest.com,https://*.pages.dev',
  };

  it('accepts the exact origin', async () => {
    const res = await options('/health', 'https://app.arenaquest.com', MIXED_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.arenaquest.com');
  });

  it('accepts a matching preview origin', async () => {
    const previewOrigin = 'https://pr-42.pages.dev';
    const res = await options('/health', previewOrigin, MIXED_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(previewOrigin);
  });

  it('rejects an unrelated origin', async () => {
    const res = await options('/health', EVIL_ORIGIN, MIXED_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe(EVIL_ORIGIN);
  });
});
