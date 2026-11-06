#!/usr/bin/env node
/**
 * qa-shot.mjs — log in as a role, visit routes at desktop and Pixel 7 widths,
 * save screenshots and a JSON summary (console errors, failed responses,
 * horizontal overflow). Evidence for a QA report; never a test by itself.
 *
 *   node .claude/skills/qa/scripts/qa-shot.mjs --role student --paths /dashboard,/catalog
 *       [--out tmp/qa/<role>] [--desktop-only | --mobile-only] [--file .envs.test]
 *       [--full-page] [--headed]
 *
 * --role none visits logged out. Credentials are read from .envs.test only and
 * never printed. Playwright is resolved from the repo (e2e/ workspace or a
 * global install) or from the preinstalled copy of a Claude Code cloud session.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i === -1 ? d : args[i + 1];
};

const role = opt('--role', 'none').toUpperCase();
const paths = opt('--paths', '/').split(',').map((p) => p.trim()).filter(Boolean);
const out = resolve(process.cwd(), opt('--out', `tmp/qa/${role.toLowerCase()}`));
const envFile = resolve(process.cwd(), opt('--file', '.envs.test'));
const widths = has('--desktop-only') ? ['desktop'] : has('--mobile-only') ? ['mobile'] : ['desktop', 'mobile'];

function loadEnv() {
  const env = {};
  if (!existsSync(envFile)) return env;
  for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}
function loadPlaywright() {
  const req = createRequire(join(process.cwd(), 'package.json'));
  for (const base of [process.cwd(), join(process.cwd(), 'e2e')]) {
    for (const name of ['playwright', '@playwright/test']) {
      try {
        return createRequire(join(base, 'package.json'))(name);
      } catch {}
    }
  }
  try {
    return req('playwright');
  } catch {}
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(join(root, 'x.js'))('playwright');
  } catch {}
  console.error('qa-shot: playwright not found. In e2e/: pnpm install; or: pnpm dlx playwright@latest install chromium');
  process.exit(2);
}
function dictLabel() {
  // The submit button's accessible name comes from the dictionary, not from a literal here.
  try {
    const src = readFileSync(resolve(process.cwd(), 'apps/web/src/i18n/dict-pt.ts'), 'utf8');
    const m = src.match(/login:\s*\{[\s\S]*?submitButton:\s*'([^']+)'/);
    if (m) return m[1];
  } catch {}
  return 'Entrar na Arena';
}

const env = loadEnv();
const webUrl = (env.QA_WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const host = new URL(webUrl).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`qa-shot: QA_WEB_URL is not loopback (${host}); refusing.`);
  process.exit(1);
}
let creds = null;
if (role !== 'NONE') {
  const email = env[`QA_${role}_EMAIL`];
  const password = env[`QA_${role}_PASSWORD`];
  if (!email || !password) {
    console.error(`qa-shot: QA_${role}_EMAIL / QA_${role}_PASSWORD blank in .envs.test; aborting this role.`);
    process.exit(1);
  }
  creds = { email, password };
}

const { chromium, devices } = loadPlaywright();
const profiles = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: devices['Pixel 7'] || { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 },
};
const launchOpts = { headless: !has('--headed') };
const summary = { role: role.toLowerCase(), webUrl, startedAt: new Date().toISOString(), pages: [] };
const browser = await chromium.launch(launchOpts);
try {
  for (const width of widths) {
    const context = await browser.newContext({ ...profiles[width], locale: 'pt-BR' });
    const page = await context.newPage();
    const consoleErrors = [];
    const failed = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
    page.on('response', (r) => { if (r.status() >= 400) failed.push({ status: r.status(), url: r.url().replace(webUrl, '') }); });

    if (creds) {
      await page.goto(`${webUrl}/login`, { waitUntil: 'networkidle' });
      await page.fill('#login-email', creds.email);
      await page.fill('#login-password', creds.password);
      await page.getByRole('button', { name: dictLabel() }).click();
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
      if (page.url().includes('/login')) {
        summary.pages.push({ width, path: '/login', error: 'login did not leave /login (wrong credentials or server error)' });
        await context.close();
        continue;
      }
    }

    for (const p of paths) {
      consoleErrors.length = 0;
      failed.length = 0;
      const dir = join(out, width);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${p.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_') || 'root'}.png`);
      const entry = { width, path: p, screenshot: file };
      try {
        const res = await page.goto(`${webUrl}${p}`, { waitUntil: 'networkidle', timeout: 30000 });
        entry.status = res ? res.status() : null;
        entry.finalUrl = page.url().replace(webUrl, '');
        entry.title = await page.title();
        entry.overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        }));
        await page.screenshot({ path: file, fullPage: has('--full-page') });
      } catch (e) {
        entry.error = String(e.message || e).slice(0, 300);
      }
      entry.consoleErrors = [...consoleErrors];
      entry.failedResponses = [...failed];
      summary.pages.push(entry);
      const flag = entry.error ? '✗' : entry.overflow?.horizontalOverflow || entry.consoleErrors.length || entry.failedResponses.length ? '!' : '✓';
      console.log(`${flag} ${width.padEnd(7)} ${p.padEnd(32)} ${entry.status ?? '-'}  console:${entry.consoleErrors.length} failed:${entry.failedResponses.length} overflow:${entry.overflow?.horizontalOverflow ? 'yes' : 'no'}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`qa-shot: summary at ${join(out, 'summary.json')}`);
