import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHealth } from '@api/controllers/health.controller';

describe('getHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns status ok and the provided adapter map', () => {
    const adapters = { auth: 'jwt_pbkdf2', database: 'd1', storage: 'not_wired' };
    const result = getHealth(adapters);

    expect(result.status).toBe('ok');
    expect(result.adapters).toEqual(adapters);
  });

  it('returns version 0.1.0', () => {
    const result = getHealth({});
    expect(result.version).toBe('0.1.0');
  });

  it('timestamp is a valid ISO 8601 string close to now', () => {
    const before = Date.now();
    const result = getHealth({});
    const after = Date.now();

    const ts = new Date(result.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
