import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { v1 } from '../helpers/v1';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('OpenAPI & Documentation Routes', () => {
  it('GET /openapi.json returns a valid OpenAPI 3.1.0 JSON document', async () => {
    const req = new IncomingRequest('http://example.com/openapi.json', {
      method: 'GET',
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const body = (await res.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
    };
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toBe('ArenaQuest API');
    expect(body.paths['/health']).toBeDefined();
  });

  it('GET /docs returns an HTML page serving Scalar UI', async () => {
    const req = new IncomingRequest('http://example.com/docs', {
      method: 'GET',
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('html');
    expect(html).toContain('/openapi.json');
  });
});

// ---------------------------------------------------------------------------
// Legacy-shim cutover — proves the shim is gone and /v1 is the live contract
// ---------------------------------------------------------------------------

describe('Legacy-shim cutover', () => {
  it('un-prefixed business path GET /topics returns 404 (shim removed)', async () => {
    const req = new IncomingRequest('http://example.com/topics', { method: 'GET' });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it('versioned path GET /v1/topics returns 401 (route exists, auth guard fires)', async () => {
    const req = new IncomingRequest(`http://example.com${v1('/topics')}`, { method: 'GET' });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
