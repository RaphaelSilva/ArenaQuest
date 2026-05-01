import { describe, it, expect, beforeEach } from 'vitest';
import { ActivateController } from '@api/controllers/activate.controller';
import type { IActivationTokenRepository, ConsumeResult } from '@arenaquest/shared/ports';

interface FakeRepoOptions {
  outcome: ConsumeResult['outcome'];
}

function makeFakeTokenRepo(options: FakeRepoOptions): IActivationTokenRepository & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async create() { /* unused */ },
    async consumeByPlainToken(token) {
      calls.push(token);
      if (options.outcome === 'invalid') return { outcome: 'invalid' };
      return { outcome: options.outcome, userId: 'user-1' };
    },
    async purgeExpired() {},
  } as IActivationTokenRepository & { calls: string[] };
}

describe('ActivateController', () => {
  it('valid token → ok with status=activated', async () => {
    const repo = makeFakeTokenRepo({ outcome: 'activated' });
    const ctrl = new ActivateController(repo);

    const result = await ctrl.activate({ token: 'abc' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('activated');
    expect(repo.calls).toEqual(['abc']);
  });

  it('replay → ok with status=already_active', async () => {
    const repo = makeFakeTokenRepo({ outcome: 'already_active' });
    const ctrl = new ActivateController(repo);

    const result = await ctrl.activate({ token: 'abc' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('already_active');
  });

  it('expired token → 400 InvalidToken', async () => {
    const repo = makeFakeTokenRepo({ outcome: 'invalid' });
    const ctrl = new ActivateController(repo);

    const result = await ctrl.activate({ token: 'expired' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toBe('InvalidToken');
  });

  it('unknown token → 400 InvalidToken with same shape (no oracle)', async () => {
    const repo = makeFakeTokenRepo({ outcome: 'invalid' });
    const ctrl = new ActivateController(repo);

    const r1 = await ctrl.activate({ token: 'unknown-1' });
    const r2 = await ctrl.activate({ token: 'unknown-2' });

    expect(r1).toEqual(r2);
  });

  it('missing token → 400 InvalidToken', async () => {
    const repo = makeFakeTokenRepo({ outcome: 'invalid' });
    const ctrl = new ActivateController(repo);

    const result = await ctrl.activate({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toBe('InvalidToken');
  });

  it('non-object body → 400 InvalidToken', async () => {
    const repo = makeFakeTokenRepo({ outcome: 'invalid' });
    const ctrl = new ActivateController(repo);

    const result = await ctrl.activate(null);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  let _: number;
  beforeEach(() => { _ = 0; });
});
