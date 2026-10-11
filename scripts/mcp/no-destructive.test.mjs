/**
 * scripts/mcp/no-destructive.test.mjs — the static guard of RFC 0025 §5:
 * nothing under `scripts/mcp/` spawns a restore, an SQL execute, a deploy, a
 * delete or a `secret put`.
 *
 * Two complementary checks, because each alone has a hole:
 *
 *   (b) behaviour — every ops tool is built with a recording `spawn` stub and
 *       invoked (tier 2 through a valid confirmation, tier 3 for every
 *       scenario), and no recorded argv may carry a forbidden token. This is
 *       what actually runs, so a future tool that spawns one of them fails
 *       here whatever its source looks like;
 *   (c) source — the forbidden words may appear in `tools/ops.mjs` only inside
 *       the one text builder, `restoreInstructionsFor` (excised before the
 *       scan), or in a comment; and the unambiguous multi-word forms
 *       (`time-travel restore`, `d1 execute`, `secret put`) may appear in NO
 *       non-test file under `scripts/mcp/` outside that builder. A tool that
 *       builds such an argv but is not reached by (b) fails here.
 *
 * Run: node --test scripts/mcp/no-destructive.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createConfirmations } from './confirm.mjs';
import { OPS_TOOL_NAMES, RESTORE_SCENARIOS, buildOpsTools } from './tools/ops.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The forbidden tokens, as they would appear in a spawned argv (joined by spaces). */
export const FORBIDDEN = [/time-travel\s+restore/, /\bd1\s+execute\b/, /\bdeploy\b/, /\bdelete\b/, /\bsecret\s+put\b/];
/** The unambiguous forms scanned in every non-test source file. */
const FORBIDDEN_MULTIWORD = [/time-travel\W+restore/, /\bd1\W+execute\b/, /\bsecret\W+put\b/];

function forbiddenIn(text, patterns = FORBIDDEN) {
  return patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

// -- (b) behaviour --------------------------------------------------------------

const BOOKMARK = '00000085-0000000b-00004e5d-c1d6d2b7a6e4c7e0b5c3d4a1f2e3b4c5';
const CONFIG = {
  label: 'budo',
  env: 'production',
  cfReadToken: 'cf-read-token',
  ops: { database: 'budo-db', wranglerEnv: 'budo', production: { database: 'budo-db', mediaBucket: 'budo-media', backupBucket: 'budo-backups' } },
};

/** Canned answers so every tool runs to completion; the argv is what matters. */
function answer(file, args) {
  const script = file === process.execPath ? basename(args[0]) : file;
  if (script === 'status.mjs') {
    return {
      status: 0,
      stdout: JSON.stringify({ label: 'budo', env: 'production', checkedAt: 'x', status: 'green', unverified: false, lines: [], data: { timeTravel: { bookmark: BOOKMARK, windowNote: 'w' } } }),
      stderr: '',
    };
  }
  if (script === 'provision-label.mjs') return { status: 0, stdout: JSON.stringify({ label: 'budo', env: 'production', resources: [], secrets: [], exitCode: 0 }), stderr: '' };
  if (script === 'export-d1.mjs') return { status: 0, stdout: 'plan\n', stderr: '' };
  if (script === 'pnpm') return { status: 0, stdout: JSON.stringify({ bookmark: BOOKMARK }), stderr: '' };
  throw new Error(`unexpected spawn: ${script}`);
}

test('(b) no tool — tier 2 confirmed, tier 3 for every scenario — spawns a forbidden command', async () => {
  const argvs = [];
  const spawn = (file, args, opts) => {
    argvs.push({ argv: [file, ...args].join(' '), env: opts?.env ?? {} });
    return answer(file, args);
  };
  const client = { request: async () => ({}) };
  const confirmations = createConfirmations();
  const tools = buildOpsTools({ client, config: CONFIG, env: { PATH: '/usr/bin', HOME: '/home/op' }, spawn, confirmations, cwd: '/repo' });
  assert.deepEqual(tools.map((t) => t.name), OPS_TOOL_NAMES);

  const invoked = [];
  for (const tool of tools) {
    if (tool.name === 'restore_instructions') {
      for (const scenario of RESTORE_SCENARIOS) {
        const before = argvs.length;
        await tool.run({ scenario, bookmark: BOOKMARK });
        assert.equal(argvs.length, before, `restore_instructions(${scenario}) spawned nothing`);
      }
      invoked.push(tool.name);
      continue;
    }
    const plan = await tool.run({});
    if (plan && typeof plan.confirmationId === 'string') {
      await tool.run({ confirmationId: plan.confirmationId });
    }
    invoked.push(tool.name);
  }
  assert.deepEqual(invoked, OPS_TOOL_NAMES, 'every tool ran');
  assert.ok(argvs.length >= 5, `the tier-1 and tier-2 tools did spawn (${argvs.length} calls)`);

  for (const { argv } of argvs) {
    assert.deepEqual(forbiddenIn(argv), [], `forbidden token in spawned argv: ${argv}`);
  }
  // And none of them ran the wrangler verb a restore needs, in any spelling.
  for (const { argv } of argvs) assert.doesNotMatch(argv, /\brestore\b/, argv);
});

// -- (c) source -------------------------------------------------------------------

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === 'node_modules') continue;
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.mjs') && !entry.endsWith('.test.mjs')) out.push(path);
  }
  return out.sort();
}

/** Block comments and whole-line `//` comments removed; a trailing `//` stays scanned. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** `ops.mjs` without its one allowed text builder. Throws when the builder cannot be found. */
export function exciseRestoreBuilder(source) {
  const start = source.indexOf('export function restoreInstructionsFor(');
  if (start < 0) throw new Error('restoreInstructionsFor not found in ops.mjs — the guard needs its one allowlisted builder');
  const end = source.indexOf('\n}\n', start);
  if (end < 0) throw new Error('restoreInstructionsFor has no closing brace at column 0');
  return `${source.slice(0, start)}${source.slice(end + 3)}`;
}

test('(c) ops.mjs spells the forbidden words only inside restoreInstructionsFor or a comment', () => {
  const path = join(HERE, 'tools', 'ops.mjs');
  const source = readFileSync(path, 'utf8');
  // The builder does contain them (that is its job), so the excision is doing work.
  assert.ok(forbiddenIn(source).length > 0, 'the builder spells out the restore commands');
  const scanned = stripComments(exciseRestoreBuilder(source));
  const hits = forbiddenIn(scanned);
  assert.deepEqual(hits, [], `forbidden token outside the builder in ${relative(HERE, path)}: ${hits.join(', ')}`);
});

test('(c) no non-test file under scripts/mcp/ carries a restore, d1 execute or secret put outside the builder', () => {
  const files = sourceFiles(HERE);
  assert.ok(files.some((f) => f.endsWith('aq-mcp.mjs')) && files.some((f) => f.endsWith(join('tools', 'ops.mjs'))), 'the walk found the server and the ops tools');
  for (const path of files) {
    let source = readFileSync(path, 'utf8');
    if (path.endsWith(join('tools', 'ops.mjs'))) source = exciseRestoreBuilder(source);
    const hits = forbiddenIn(stripComments(source), FORBIDDEN_MULTIWORD);
    assert.deepEqual(hits, [], `${relative(HERE, path)}: ${hits.join(', ')}`);
  }
});

test('(c) the guard itself catches a source that would spawn a forbidden command', () => {
  const offending = stripComments(`
    // a comment mentioning time-travel restore is fine
    const argv = ['wrangler', 'd1', 'time-travel', 'restore', db]; // joined: time-travel restore
    spawn('pnpm', ['exec', 'wrangler', 'd1 execute', db]);
    run(['wrangler', 'deploy']); run(['wrangler', 'secret put']);
  `);
  const hits = forbiddenIn(offending.replaceAll("', '", ' '));
  assert.ok(hits.includes(FORBIDDEN[0].source), 'time-travel restore');
  assert.ok(hits.includes(FORBIDDEN[1].source), 'd1 execute');
  assert.ok(hits.includes(FORBIDDEN[2].source), 'deploy');
  assert.ok(hits.includes(FORBIDDEN[4].source), 'secret put');
  assert.throws(() => exciseRestoreBuilder('nothing here'), /restoreInstructionsFor not found/);
});
