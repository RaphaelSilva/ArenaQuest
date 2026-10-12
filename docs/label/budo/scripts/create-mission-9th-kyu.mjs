import { createApiClient, resolveBaseUrl } from '../../../../scripts/lib/api-client.mjs';

const DRY = process.argv.includes('--dry-run');
const XP_PER_VIDEO = 10;
const XP_STEP_MIN = 50;

// sort_order of the 9th Kyu folders; minCount = ready videos on the topic (prod, 2026-10-12)
const modules = [
  ['Ashirau Ippo Yonho', 'cab465be-3703-4895-876e-9d93299e92ab', 14],
  ['Dakentaijutsu', 'e6f3704d-250d-4596-8bd6-30dbead16339', 23],
  ['Gaeshi', '850fc467-7882-4964-a8f1-ce0f34ef550f', 3],
  ['Go Gyo no Kata', '4f06746b-93d0-4c1b-af3f-3acaaa3110a2', 5],
  ['Hoken Juroppo', 'dc9dd8fb-2d7d-4f50-bea3-ee54bf55ba5c', 28],
  ['Kaiten', '9a470440-3220-445c-906a-8d2ed79e6c3d', 24],
  ['Kihon Gyokko Ryu Koshi Sampo', '6f9d4e79-4730-4571-ba81-56c2e30551ca', 9],
  ['Nagare', '6b28cfe1-a34c-4b1b-8eec-3d4493a4c74e', 14],
  ['Shoshin Atemi no Keiko', '8dfa1d0d-8a9c-496f-87d0-82f3693595da', 5],
  ['Tobi', 'e5c3f033-34f5-4299-b355-3941cffa3fdc', 2],
  ['Ukemi', 'b547c4de-623c-45ff-8869-4136971558ab', 4],
];

const body = {
  title: '9º Kyu — Programa',
  description:
    'Complete o programa do 9º Kyu: assista a todos os vídeos de cada módulo, na ordem do Programa. Cada módulo concluído libera o próximo.',
  startAt: '2026-11-01T03:00:00.000Z',
  endAt: '2027-11-01T02:59:59.000Z',
  mode: 'sequential',
  enrollmentMode: 'auto',
  xpReward: 500,
  badgeId: null,
  requirements: modules.map(([title, topicId, videos]) => ({
    kind: 'video_watched',
    title,
    topicId,
    xpReward: Math.max(XP_STEP_MIN, videos * XP_PER_VIDEO),
    params: { minCount: videos },
  })),
};

const stepXp = body.requirements.reduce((s, r) => s + r.xpReward, 0);
console.error(JSON.stringify(body, null, 2));
console.error(`steps=${body.requirements.length} stepXp=${stepXp} missionXp=${body.xpReward} total=${stepXp + body.xpReward}`);
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

const list = await client.request('GET', '/v1/admin/missions');
const items = list?.data ?? list?.items ?? [];
const clash = items.find((m) => (m.mission ?? m).title === body.title);
if (clash) {
  console.error(`abort: a mission titled "${body.title}" already exists (${(clash.mission ?? clash).id}); nothing written`);
  process.exit(1);
}

const created = await client.request('POST', '/v1/admin/missions', { body, expectStatus: 201 });
const id = created.data.mission.id;
console.error(`created mission ${id}`);
await client.request('PATCH', `/v1/admin/missions/${id}`, { body: { active: false } });
console.error(`mission ${id} set inactive (draft)`);
