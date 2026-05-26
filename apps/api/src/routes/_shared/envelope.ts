import type { Context } from 'hono';
import type { ControllerResult } from '@api/core/result';

type StatusCode = 200 | 201 | 204 | 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;

export function respondWith<T>(c: Context, result: ControllerResult<T>): Response {
  if (result.ok) {
    return c.json(result.data, 200);
  }

  const body: Record<string, unknown> = { error: result.error };
  if (result.meta) {
    Object.assign(body, result.meta);
  }
  return c.json(body, result.status as StatusCode);
}

export function respondCreated<T>(c: Context, result: ControllerResult<T>): Response {
  if (result.ok) {
    return c.json(result.data, 201);
  }

  const body: Record<string, unknown> = { error: result.error };
  if (result.meta) {
    Object.assign(body, result.meta);
  }
  return c.json(body, result.status as StatusCode);
}

export function respondNoContent<T>(c: Context, result: ControllerResult<T>): Response {
  if (result.ok) {
    return c.body(null, 204);
  }

  const body: Record<string, unknown> = { error: result.error };
  if (result.meta) {
    Object.assign(body, result.meta);
  }
  return c.json(body, result.status as StatusCode);
}
