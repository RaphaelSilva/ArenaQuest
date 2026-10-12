import { createApiClient, resolveBaseUrl } from '../../../../scripts/lib/api-client.mjs';

// Usage: node set-levels-bamboo.mjs [--dry-run]
const DRY = process.argv.includes('--dry-run');
const XP_PER_VIDEO = 50; // packages/shared/domain/gamification/xp-config.ts

// One stage per grade studied: [stage, meaning, mission total XP, videos required by the mission]
const stages = [
  ['Tane', 'Semente', 1870, 131],
  ['Ne', 'Raiz', 2380, 181],
  ['Takenoko', 'Broto', 2370, 185],
  ['Wakatake', 'Bambu Jovem', 2320, 182],
  ['Fushi', 'Nó', 1540, 99],
  ['Shinaru', 'Flexível', 1970, 147],
  ['Kaze', 'Vento', 1460, 96],
  ['Hayashi', 'Bosque', 2000, 150],
  ['Ōtake', 'Grande Bambu', 2520, 198],
  ['Ten', 'Céu', 4780, 422],
];

// Each stage has two levels (start and midpoint of its grade); the curve ends at Shodan,
// reached when the whole Programa is complete.
const curve = [];
let start = 0;
for (const [stage, meaning, missionXp, videos] of stages) {
  const gradeXp = missionXp + videos * XP_PER_VIDEO;
  curve.push({ rankTitle: `${stage} I · ${meaning}`, minXp: start });
  curve.push({ rankTitle: `${stage} II · ${meaning}`, minXp: start + Math.floor(gradeXp / 2) });
  start += gradeXp;
}
curve.push({ rankTitle: 'Shodan', minXp: start });

const levels = curve.map((row, i) => ({
  level: i + 1,
  rankTitle: row.rankTitle,
  minXp: row.minXp,
  maxXp: i + 1 < curve.length ? curve[i + 1].minXp : null,
}));

// Same rules as validateCurve in apps/api/src/controllers/admin-levels.controller.ts
for (let i = 1; i < levels.length; i++) {
  if (levels[i].minXp <= levels[i - 1].minXp) throw new Error(`minXp not increasing at level ${levels[i].level}`);
  if (levels[i - 1].maxXp !== levels[i].minXp) throw new Error(`gap at level ${levels[i - 1].level}`);
}

for (const l of levels) {
  console.error(`${String(l.level).padStart(2)}  ${l.rankTitle.padEnd(28)} ${String(l.minXp).padStart(7)} → ${l.maxXp ?? '∞'}`);
}
if (DRY) process.exit(0);

const client = createApiClient({
  baseUrl: resolveBaseUrl('budo', 'production'),
  email: process.env.AQ_ADMIN_EMAIL,
  password: process.env.AQ_ADMIN_PASSWORD,
});

const user = await client.login();
const roleNames = (user?.roles ?? []).map((r) => (typeof r === 'string' ? r : r?.name));
if (!roleNames.includes('admin')) {
  console.error(`abort: account roles ${JSON.stringify(roleNames)} lack admin; nothing written`);
  process.exit(1);
}

const before = await client.request('GET', '/v1/admin/levels');
console.error(`\ncurrent curve: ${before.length} levels, top "${before.at(-1)?.rankTitle}" from ${before.at(-1)?.minXp} XP`);
console.error(`previous curve (keep to roll back):\n${JSON.stringify(before)}`);

const after = await client.request('PUT', '/v1/admin/levels', { body: levels });
console.error(`\nreplaced: ${after.length} levels, top "${after.at(-1)?.rankTitle}" from ${after.at(-1)?.minXp} XP`);
