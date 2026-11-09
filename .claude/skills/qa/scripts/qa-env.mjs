#!/usr/bin/env node
/**
 * qa-env.mjs — read-only check for a QA run.
 *
 *   node .claude/skills/qa/scripts/qa-env.mjs [--roles admin,student] [--file .envs.test]
 *
 * Reports, without ever printing a value:
 *   - whether the env file exists and which required keys are blank;
 *   - whether QA_WEB_URL / QA_API_URL are loopback (anything else is refused);
 *   - whether the web (/login) and api (/health) servers answer.
 * Exit 0 when everything a run needs is there, 1 otherwise. Stdlib only.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const file = resolve(process.cwd(), opt('--file', '.envs.test'));
const roles = opt('--roles', '')
  .split(',')
  .map((r) => r.trim().toUpperCase())
  .filter(Boolean);

const KNOWN_ROLES = ['ADMIN', 'CONTENT_CREATOR', 'TUTOR', 'STUDENT', 'NEW_USER'];
let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log(`qa-env: ${file}`);
if (!existsSync(file)) {
  fail('file not found — copy .envs.test.example to .envs.test and fill it in (never commit it)');
  process.exit(1);
}

const env = {};
for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

for (const r of roles) {
  if (!KNOWN_ROLES.includes(r)) fail(`unknown role "${r.toLowerCase()}" (known: ${KNOWN_ROLES.join(', ').toLowerCase()})`);
}
for (const r of roles.filter((r) => KNOWN_ROLES.includes(r))) {
  for (const suffix of ['EMAIL', 'PASSWORD']) {
    const key = `QA_${r}_${suffix}`;
    if (env[key]) ok(`${key} set`);
    else fail(`${key} blank — the ${r.toLowerCase()} scenarios cannot run`);
  }
}

const isLoopback = (u) => {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
};
const web = env.QA_WEB_URL || 'http://localhost:3000';
const api = env.QA_API_URL || 'http://localhost:8787';
for (const [name, url] of [['QA_WEB_URL', web], ['QA_API_URL', api]]) {
  if (isLoopback(url)) ok(`${name} is loopback (${url})`);
  else fail(`${name} is not loopback (${url}) — QA runs against local servers only`);
}

async function probe(name, url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    if (res.status < 500) ok(`${name} answers ${res.status} at ${url}`);
    else fail(`${name} answers ${res.status} at ${url}`);
  } catch {
    fail(`${name} not reachable at ${url} — start it (make dev-api / make dev-web)`);
  } finally {
    clearTimeout(t);
  }
}
if (isLoopback(api)) await probe('api', `${api.replace(/\/$/, '')}/health`);
if (isLoopback(web)) await probe('web', `${web.replace(/\/$/, '')}/login`);

console.log(failed ? 'qa-env: NOT READY' : 'qa-env: ready');
process.exit(failed ? 1 : 0);
