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

// Baseline environment for exact-match tests (Task 01) to ensure they pass
// regardless of the developer's local .dev.vars (which might be set to '*').
const BASELINE_ALLOWED_ORIGIN = 'http://localhost:3000';
const BASELINE_ENV = { ALLOWED_ORIGINS: BASELINE_ALLOWED_ORIGIN };

const EVIL_ORIGIN = 'https://evil.com';

// ---------------------------------------------------------------------------
// Task 01 — baseline exact-match tests
// ---------------------------------------------------------------------------

describe('CORS — preflight (OPTIONS /health)', () => {
  it('echoes the allowed origin back in ACAO header', async () => {
    const res = await options('/health', BASELINE_ALLOWED_ORIGIN, BASELINE_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(BASELINE_ALLOWED_ORIGIN);
  });

  it('sets Access-Control-Allow-Credentials: true for allowed origin', async () => {
    const res = await options('/health', BASELINE_ALLOWED_ORIGIN, BASELINE_ENV);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('does NOT echo a disallowed origin in the ACAO header', async () => {
    const res = await options('/health', EVIL_ORIGIN, BASELINE_ENV);
    const acao = res.headers.get('Access-Control-Allow-Origin');
    // hono/cors returns null string or omits the header entirely when matcher returns null
    expect(acao).not.toBe(EVIL_ORIGIN);
  });
});

describe('CORS — simple request (GET /health)', () => {
  it('sets ACAO header for an allowed origin', async () => {
    const res = await get('/health', BASELINE_ALLOWED_ORIGIN, BASELINE_ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(BASELINE_ALLOWED_ORIGIN);
  });

  it('does NOT set ACAO header for a disallowed origin', async () => {
    const res = await get('/health', EVIL_ORIGIN, BASELINE_ENV);
    const acao = res.headers.get('Access-Control-Allow-Origin');
    expect(acao).not.toBe(EVIL_ORIGIN);
  });
});
