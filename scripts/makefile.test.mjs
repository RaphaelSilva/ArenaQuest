import assert from 'node:assert/strict';
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function withFixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'arenaquest-makefile-'));
  try {
    await cp(path.join(repoRoot, 'Makefile'), path.join(root, 'Makefile'));
    await mkdir(path.join(root, 'bin'), { recursive: true });
    await mkdir(path.join(root, 'apps/api/.wrangler/state/v3/d1'), { recursive: true });
    await mkdir(path.join(root, 'apps/api/.wrangler/state/v3/kv'), { recursive: true });
    await mkdir(path.join(root, 'apps/api/.wrangler/state/v3/r2'), { recursive: true });
    await mkdir(path.join(root, 'apps/api/.wrangler/state/v3/cache'), { recursive: true });
    await mkdir(path.join(root, 'apps/api/.wrangler/state/v3/workflows'), { recursive: true });
    await writeFile(path.join(root, 'apps/api/.wrangler/state/legacy-workerd-state'), 'incompatible');

    const fakePnpm = path.join(root, 'bin/pnpm');
    await writeFile(
      fakePnpm,
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$PNPM_LOG"\nmkdir -p "$FIXTURE_ROOT/apps/api/.wrangler/state/v3/d1"\n',
    );
    await chmod(fakePnpm, 0o755);

    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('db-reset-local is local-only and idempotently replaces all workerd state', async () => {
  await withFixture(async (root) => {
    const logPath = path.join(root, 'pnpm.log');
    const staleStatePaths = [
      'legacy-workerd-state',
      'v3/cache',
      'v3/kv',
      'v3/r2',
      'v3/workflows',
    ];
    const runReset = () =>
      spawnSync('make', ['db-reset-local'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
          FIXTURE_ROOT: root,
          PNPM_LOG: logPath,
        },
      });

    const first = runReset();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    for (const stalePath of staleStatePaths) {
      await assert.rejects(access(path.join(root, 'apps/api/.wrangler/state', stalePath)));
    }
    await access(path.join(root, 'apps/api/.wrangler/state/v3/d1'));

    await writeFile(path.join(root, 'apps/api/.wrangler/state/legacy-workerd-state'), 'incompatible-again');
    const second = runReset();
    assert.equal(second.status, 0, second.stderr || second.stdout);
    await assert.rejects(access(path.join(root, 'apps/api/.wrangler/state/legacy-workerd-state')));
    await access(path.join(root, 'apps/api/.wrangler/state/v3/d1'));

    const commands = (await readFile(logPath, 'utf8')).trim().split('\n');
    assert.equal(commands.length, 8);
    assert.ok(commands.every((command) => command.includes('wrangler d1 ') && command.includes(' --local')));
    assert.ok(commands.every((command) => !command.includes('--remote') && !command.includes('deploy')));
  });
});
