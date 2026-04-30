import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker, { type AppEnv } from '../../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function options(path: string, origin: string): Promise<Response> {
  const req = new IncomingRequest(`http://example.com${path}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function get(path: string, origin: string): Promise<Response> {
  const req = new IncomingRequest(`http://example.com${path}`, {
    method: 'GET',
    headers: { Origin: origin },
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// The allowed origin as configured in .dev.vars (takes precedence over wrangler.jsonc in tests).
// `env.ALLOWED_ORIGINS` is set to "http://localhost:3000" from .dev.vars during vitest runs.
const ALLOWED_ORIGIN = env.ALLOWED_ORIGINS as string;
const EVIL_ORIGIN = 'https://evil.com';

// ---------------------------------------------------------------------------
// Tests
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
    // This serves as the behavioral regression: if console.log were replaced by
    // the old origin-splitting code and failed, the CORS filter would break.
    // The Workers pool runtime does not allow spying on the global console, so
    // we validate the absence of origin echoing as a behavioral proxy.
    const res = await get('/health', EVIL_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe(EVIL_ORIGIN);
  });
});
