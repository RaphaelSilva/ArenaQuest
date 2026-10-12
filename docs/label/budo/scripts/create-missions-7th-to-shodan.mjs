import { createApiClient, resolveBaseUrl } from '../../../../scripts/lib/api-client.mjs';

// Usage: node create-missions-7th-to-shodan.mjs [--dry-run] [--only "7º Kyu"]
const DRY = process.argv.includes('--dry-run');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

const MIN_COUNT_MAX = 50; // REQUIREMENT_MIN_COUNT_MAX in packages/shared/domain/missions/requirements.ts
const XP_PER_VIDEO = 10;
const XP_STEP_MIN = 50;
const MISSION_XP = 500;
const START_AT = '2026-11-01T03:00:00.000Z';
const END_AT = '2027-11-01T02:59:59.000Z';

// [step title, topic id, ready videos on 2026-10-12 | null = topic has no video → topic_visited]
const grades = [
  ['7º Kyu', [
    ['Goshinjutsu Waza', 'a947b793-7f70-42ae-a511-24a42f9883b6', 20],
    ['Hajutsu Taihodoki', 'c6e8b19e-edee-47e6-ad81-6437be9081fa', 22],
    ['Hajutsu Taihodoki — Tawara Gaeshi', 'de2c00c6-3d49-4c97-af21-d7e8580d609e', 7],
    ['Happo Geri', 'ca46ff26-9372-4f3e-b82a-0a1072042e03', 3],
    ['Keri Ni Taisuru', '3f8a39ce-e3dd-47cc-a4e6-3aa40119f06f', 38],
    ['Kishin Kyuho Bojutsu', 'a57a038a-4fe0-457e-ad56-6e438caa910f', 14],
    ['Kishin Kyuho Bojutsu no Kamae', '69d2a6ca-cae4-4b0a-b6c5-bb1763457db5', 9],
    ['Kukishinden Ryu Bikenjutsu no Kamae', 'a0c83366-ba84-42de-9a5e-08dc0e6abeb9', 15],
    ['Nage', '53a454ae-7427-475e-a011-b4aefbd0ba03', 176],
    ['Nage — Koshinage', '3ef93053-1e28-4c54-8299-1d14d5f486cf', 7],
  ]],
  ['6º Kyu', [
    ['Chu Ryaku No Maki', '4b63c53c-29e0-4e37-9668-2634caebd2ef', 80],
    ['Ge Ryaku No Maki', '41a83e3a-abc3-4782-8d02-9c4bee204506', 57],
    ['Jo Ryaku No Maki', 'b9c6e639-09d8-4778-bd68-073970b62d98', 80],
    ['Kihon Happo', '5eccc084-2b20-47ed-8134-b50406affe79', 32],
  ]],
  ['5º Kyu', [
    ['Chuden Gata', '531221af-d3cf-46e8-b8e0-53a42f319bbb', 49],
    ['Koto Ryu Kurai Kamae', 'b985a37c-d6f6-4e72-841b-0ec454b0b768', null],
    ['Shoden No Kata', '51155d27-0d9b-4ade-aefb-6b91eebfff30', 131],
  ]],
  ['4º Kyu', [
    ['Chi no Kata', '093c9b73-853f-4a2a-bbd2-9b3a918bdf67', 47],
    ['Shizen Shikoku no Kata', '3fd19ba0-af21-44b0-98cd-4f3b9d539f0c', 58],
    ['Ten no Kata', '835c0bbc-fcf2-4e76-a290-6dbcbb3b8a5a', 68],
  ]],
  ['3º Kyu', [
    ['Hidengata', '711c5034-244e-47d1-9fb8-777b578a0e6c', 6],
    ['Junigata', '2d576ae0-35a5-4207-9ef3-8217e55a440a', 26],
    ['Ninjabiken', '8d33f42f-4422-48e9-8233-c57edb18e650', 34],
    ['Nuki', 'ab3323c9-c129-4c5e-b16d-ecd968a1bbe3', 10],
    ['Shuko', '2e2dc3b5-fc8c-4559-9df6-72178cf2db1f', 20],
  ]],
  ['2º Kyu', [
    ['Chudan no Sabaki Gata', '8d93fdd0-dc43-4c17-b861-59e0f6c0a6ef', 63],
    ['Chudan no Tai no Kata', 'b1932204-f56c-4af1-b1c4-98c203ee7c3e', 76],
    ['Shoden Omote Gata', 'f3b2e707-91c0-4c5c-a87f-082dc1db5386', 91],
  ]],
  ['1º Kyu', [
    ['Chudan Sabaki Gata', '3dcccc2d-0443-420e-941e-af79f15d9f0f', 98],
    ['Chuden no Kata', '4bf4d679-fd54-40cf-8ad0-a38023282e1d', 85],
    ['Hanbo Jutsu', 'a2985b17-a1a1-457c-8222-3c1e453bb043', 42],
    ['Hanbo Jutsu — Hanbō Jutsu no Kamae', '0c795eb1-468c-481a-941a-94f73f7109e0', 2],
    ['Hanbo Jutsu — Kukishinden Ryu Hanbo Reiho', '4e67c9fe-5f5f-46ed-a0a6-53c40ab4e62a', 4],
    ['Shodan Gata', 'bb5db35a-2841-4e3f-90ea-c7506b4587e1', 83],
  ]],
  ['Shodan', [
    ['Kodachi Waza e Kamae', 'a01ab709-41c1-411c-b948-246b2a59953a', 15],
    ['Kodachi Waza e Kamae — Kodachi Kamae', '5c754ac7-b34f-46c8-bff1-de881fc6b354', 8],
    ['Kodachi Waza e Kamae — Kodachi Waza', 'f7707a6c-f476-4b03-b308-beb11597b24b', 11],
    ['Kukishinden Jutte', '972dc6a6-65da-4023-bb81-1ca74e417f5a', 9],
    ['Kukishinden Jutte — Juppo Sessho No Jutsu 2025', 'fbc235c4-039a-4d18-b936-912cb110f897', 27],
    ['Kukishinden Jutte — Jutte Karada Kamae 2025', '55115dd1-7710-459e-98dc-20851cdd574c', 13],
    ['Kukishinden Ryu Bojutsu — Reiho Bo', 'ba91b881-8520-40b4-8aae-8bbede15f6c6', 1],
    ['Kukishinden Ryu Bojutsu — Shoden Gata', '80ccb714-a2ca-4c28-b8a7-68d3a999c9d0', 12],
    ['Kukishinden Ryu Bojutsu — Shoden Gata 2025', 'a30814f4-119b-4b69-9ede-c70c46180e3b', 31],
    ['Kukishinden Sword', 'f12c7621-4544-4ed1-8d17-2fdd09749979', 21],
    ['Kukishinden Sword — Biken Jutsu', '29ad6fbf-f823-4cfc-a572-2b25047bf003', 28],
    ['Kukishinden Sword — Extra', '4ac458b0-a75e-4107-a76c-055b56627f50', 16],
    ['Shodan Jo Kukishinden Ryu', '49f12961-6321-420b-ad48-6be56c62062e', 59],
    ['Shodan Jo Kukishinden Ryu — Jō Jutsu 2025', 'a492c38f-d405-49e8-b99d-fa0aa38510c8', 41],
    ['Shodan Sojutsu', 'cf0916e3-e4de-4024-9161-9710f1a8903d', 154],
    ['Shodan Sojutsu — Black Belt Test', '7577bd48-df97-42c9-b597-846468e6fe8e', 3],
    ['Shodan Sojutsu — Jinbarei Bow', '47238944-b2dd-4f46-96fc-cd1ee67e5b5c', 6],
    ['Shodan Sojutsu — Kaisetsu Gata 2025', '239e15d6-d76b-444a-ac86-2e1e36b149ab', 30],
    ['Shodan Tessen Jutsu Kukishinden Ryu', '6284c5af-45eb-4d58-8cd2-2dfe1fc08a8f', 10],
    ['Shodan Tessen Jutsu Kukishinden Ryu — 2025', '1f3244d9-b3d2-439d-8c0e-134efdf25e6e', 40],
  ]],
];

function toRequirement([title, topicId, videos]) {
  if (videos === null) return { kind: 'topic_visited', title, topicId, xpReward: XP_STEP_MIN, params: {} };
  const minCount = Math.min(videos, MIN_COUNT_MAX);
  return { kind: 'video_watched', title, topicId, xpReward: Math.max(XP_STEP_MIN, minCount * XP_PER_VIDEO), params: { minCount } };
}

function buildMission(name, steps) {
  return {
    title: `${name} — Programa`,
    description: `Complete o programa do ${name}: assista aos vídeos de cada módulo, na ordem do Programa. Cada módulo concluído libera o próximo. Disponível para alunos do grupo ${name}.`,
    startAt: START_AT,
    endAt: END_AT,
    mode: 'sequential',
    enrollmentMode: 'assigned',
    xpReward: MISSION_XP,
    badgeId: null,
    requirements: steps.map(toRequirement),
  };
}

const plan = grades
  .filter(([name]) => !ONLY || name === ONLY)
  .map(([name, steps]) => ({ name, mission: buildMission(name, steps) }));

let grand = 0;
for (const { name, mission } of plan) {
  if (mission.requirements.length > 20) throw new Error(`${name}: ${mission.requirements.length} steps > 20`);
  const stepXp = mission.requirements.reduce((s, r) => s + r.xpReward, 0);
  grand += stepXp + MISSION_XP;
  console.error(`\n${mission.title}  (group "${name}", ${mission.requirements.length} steps)`);
  mission.requirements.forEach((r, i) => {
    const need = r.kind === 'topic_visited' ? 'visit' : `${r.params.minCount} videos`;
    console.error(`  ${String(i + 1).padStart(2)}. ${r.title.padEnd(48)} ${need.padStart(10)}  ${String(r.xpReward).padStart(4)} XP`);
  });
  console.error(`  steps ${stepXp} XP + mission ${MISSION_XP} XP = ${stepXp + MISSION_XP} XP`);
}
console.error(`\nAll missions: ${grand} XP`);
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

const existingMissions = (await client.request('GET', '/v1/admin/missions')).data ?? [];
const groups = (await client.request('GET', '/v1/admin/groups')).data ?? [];

for (const { name, mission } of plan) {
  const clash = existingMissions.find((m) => m.title === mission.title);
  if (clash) {
    console.error(`skip ${mission.title}: already exists (${clash.id})`);
    continue;
  }

  let group = groups.find((g) => g.name === name);
  if (!group) {
    group = await client.request('POST', '/v1/admin/groups', {
      body: { name, description: `Alunos aprovados para o ${name}; libera a missão do ${name}.` },
      expectStatus: 201,
    });
    groups.push(group);
    console.error(`created group ${name} ${group.id}`);
  }

  const created = await client.request('POST', '/v1/admin/missions', {
    body: { ...mission, audience: { groupIds: [group.id], userIds: [] } },
    expectStatus: 201,
  });
  const id = created.data.mission.id;
  await client.request('PATCH', `/v1/admin/missions/${id}`, { body: { active: false } });
  console.error(`created ${mission.title} ${id} (draft)`);
}
