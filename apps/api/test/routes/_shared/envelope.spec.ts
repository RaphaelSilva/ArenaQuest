import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { ControllerResult } from '@api/core/result';
import { respondWith, respondCreated, respondNoContent } from '@api/routes/_shared/envelope';

describe('Envelope Helpers', () => {
  describe('respondWith', () => {
    it('returns 200 with data on success', async () => {
      const app = new Hono();
      app.post('/', (c) => {
        const result: ControllerResult<{ id: string; name: string }> = {
          ok: true,
          data: { id: '1', name: 'test' },
        };
        return respondWith(c, result);
      });

      const req = new Request('http://localhost/', { method: 'POST' });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: '1', name: 'test' });
    });

    it('returns error status with error string on failure', async () => {
      const app = new Hono();
      app.post('/', (c) => {
        const result: ControllerResult<unknown> = {
          ok: false,
          status: 404,
          error: 'NotFound',
        };
        return respondWith(c, result);
      });

      const req = new Request('http://localhost/', { method: 'POST' });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'NotFound' });
    });

    it('merges meta into response body on failure', async () => {
      const app = new Hono();
      app.post('/', (c) => {
        const result: ControllerResult<unknown> = {
          ok: false,
          status: 400,
          error: 'BadRequest',
          meta: { field: 'email', reason: 'invalid format' },
        };
        return respondWith(c, result);
      });

      const req = new Request('http://localhost/', { method: 'POST' });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'BadRequest',
        field: 'email',
        reason: 'invalid format',
      });
    });

    it('preserves various error status codes', async () => {
      const statuses = [400, 401, 403, 404, 409, 422, 429, 500];

      for (const status of statuses) {
        const app = new Hono();
        app.post('/', (c) => {
          const result: ControllerResult<unknown> = {
            ok: false,
            status,
            error: 'SomeError',
          };
          return respondWith(c, result);
        });

        const req = new Request('http://localhost/', { method: 'POST' });
        const res = await app.fetch(req);

        expect(res.status).toBe(status);
      }
    });
  });

  describe('respondCreated', () => {
    it('returns 201 with data on success', async () => {
      const app = new Hono();
      app.post('/', (c) => {
        const result: ControllerResult<{ id: string; name: string }> = {
          ok: true,
          data: { id: 'new-id', name: 'created' },
        };
        return respondCreated(c, result);
      });

      const req = new Request('http://localhost/', { method: 'POST' });
      const res = await app.fetch(req);

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: 'new-id', name: 'created' });
    });

    it('returns error status with error string on failure', async () => {
      const app = new Hono();
      app.post('/', (c) => {
        const result: ControllerResult<unknown> = {
          ok: false,
          status: 409,
          error: 'Conflict',
        };
        return respondCreated(c, result);
      });

      const req = new Request('http://localhost/', { method: 'POST' });
      const res = await app.fetch(req);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Conflict' });
    });

    it('merges meta into response body on failure', async () => {
      const app = new Hono();
      app.post('/', (c) => {
        const result: ControllerResult<unknown> = {
          ok: false,
          status: 409,
          error: 'DuplicateEntry',
          meta: { duplicateField: 'email' },
        };
        return respondCreated(c, result);
      });

      const req = new Request('http://localhost/', { method: 'POST' });
      const res = await app.fetch(req);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'DuplicateEntry',
        duplicateField: 'email',
      });
    });
  });

  describe('respondNoContent', () => {
    it('returns 204 with no body on success', async () => {
      const app = new Hono();
      app.delete('/', (c) => {
        const result: ControllerResult<null> = {
          ok: true,
          data: null,
        };
        return respondNoContent(c, result);
      });

      const req = new Request('http://localhost/', { method: 'DELETE' });
      const res = await app.fetch(req);

      expect(res.status).toBe(204);
      const text = await res.text();
      expect(text).toBe('');
    });

    it('returns error status with error string on failure', async () => {
      const app = new Hono();
      app.delete('/', (c) => {
        const result: ControllerResult<null> = {
          ok: false,
          status: 401,
          error: 'Unauthorized',
        };
        return respondNoContent(c, result);
      });

      const req = new Request('http://localhost/', { method: 'DELETE' });
      const res = await app.fetch(req);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('merges meta into response body on failure', async () => {
      const app = new Hono();
      app.delete('/', (c) => {
        const result: ControllerResult<null> = {
          ok: false,
          status: 404,
          error: 'NotFound',
          meta: { resourceType: 'topic' },
        };
        return respondNoContent(c, result);
      });

      const req = new Request('http://localhost/', { method: 'DELETE' });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: 'NotFound',
        resourceType: 'topic',
      });
    });
  });
});
