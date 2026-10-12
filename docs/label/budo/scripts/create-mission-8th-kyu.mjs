import { createApiClient, resolveBaseUrl } from '../../../../scripts/lib/api-client.mjs';

const DRY = process.argv.includes('--dry-run');
const XP_PER_VIDEO = 10;
const XP_STEP_MIN = 50;
const GROUP_NAME = '8º Kyu';
const GROUP_DESCRIPTION = 'Alunos aprovados no 9º Kyu; libera a missão do 8º Kyu.';

// sort_order of the 8th Kyu folders; minCount = ready videos on the topic (prod, 2026-10-12)
const modules = [
  ['Bofuri Gata', '342435a5-dbb0-48e7-8a45-62f7e12d31ff', 2],
  ['Eri Jime Kata', 'c804940b-0b62-4c29-8121-56512671a530', 39],
  ['Gyaku Waza', '85ba066a-7cff-4e45-a800-e3ca03fceca6', 25],
  ['Henka Geri', '6f3646a8-4813-4655-9a73-368ecd6e9b1c', 22],
  ['Kaihi Taisabaki', 'a804eecb-d807-46e0-ac88-b3532ba83135', 3],
  ['Kaiten', 'f9e4f097-5ea6-40b4-a9ed-27d08f39f6b9', 3],
  ['Kihon Happo Torite', '65199e51-04d6-4ad5-8bc5-f01ddee5ef07', 43],
  ['Shinken Taihen Jutsu Muto Dori Gata', 'b5cb0d7b-1fd2-4275-9133-ffb073950c72', 20],
  ['Soku Yaku Ken Keri', 'd32ee0ef-66fc-4909-a6e1-93b790f41767', 11],
  ['Tehodoki', '58cf7f61-30b7-44b6-a453-bb1b6b195cf4', 6],
  ['Tobi variations', '9dc6dd8e-86f2-4a0d-8569-7cce5f0b1ed0', 7],
];

const mission = {
  title: '8º Kyu — Programa',
  description:
    'Complete o programa do 8º Kyu: assista a todos os vídeos de cada módulo, na ordem do Programa. Cada módulo concluído libera o próximo. Disponível para alunos do grupo 8º Kyu.',
  startAt: '2026-11-01T03:00:00.000Z',
  endAt: '2027-11-01T02:59:59.000Z',
  mode: 'sequential',
  enrollmentMode: 'assigned',
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

const stepXp = mission.requirements.reduce((s, r) => s + r.xpReward, 0);
const videos = modules.reduce((s, m) => s + m[2], 0);
console.error(`steps=${modules.length} videos=${videos} stepXp=${stepXp} missionXp=${mission.xpReward} total=${stepXp + mission.xpReward}`);
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

const missions = (await client.request('GET', '/v1/admin/missions')).data ?? [];
const clash = missions.find((m) => m.title === mission.title);
if (clash) {
  console.error(`abort: a mission titled "${mission.title}" already exists (${clash.id}); nothing written`);
  process.exit(1);
}

const groups = (await client.request('GET', '/v1/admin/groups')).data ?? [];
let group = groups.find((g) => g.name === GROUP_NAME);
if (group) {
  console.error(`reusing group ${group.id}`);
} else {
  group = await client.request('POST', '/v1/admin/groups', {
    body: { name: GROUP_NAME, description: GROUP_DESCRIPTION },
    expectStatus: 201,
  });
  console.error(`created group ${group.id}`);
}

const created = await client.request('POST', '/v1/admin/missions', {
  body: { ...mission, audience: { groupIds: [group.id], userIds: [] } },
  expectStatus: 201,
});
const id = created.data.mission.id;
console.error(`created mission ${id}`);
await client.request('PATCH', `/v1/admin/missions/${id}`, { body: { active: false } });
console.error(`mission ${id} set inactive (draft)`);
