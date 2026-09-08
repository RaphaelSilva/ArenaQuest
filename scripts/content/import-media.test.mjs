/**
 * scripts/content/import-media.test.mjs — unit tests for the media importer.
 *
 * Pure functions and the in-memory orchestration only: no network, no wrangler,
 * no credential. The HTTP layer is exercised through an injected `fetchImpl`,
 * and the filesystem through a temp tree under `os.tmpdir()`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  ApiError,
  appendLedger,
  applyDeclaredOrder,
  applyRootReadme,
  buildPlan,
  compareSiblings,
  contentTypeFor,
  createApiClient,
  createLocalSource,
  formatBytes,
  indexTopics,
  isReadme,
  ledgerPathFor,
  listLocal,
  nextAction,
  parseArgs,
  parseOrderPrefix,
  parseReadmeMetadata,
  readLedger,
  reconcileTopics,
  resolveBaseUrl,
  resolveReadmes,
  runPool,
  skippedReportPathFor,
  stripMetadataBlock,
  summariseHtmlError,
  titleFromName,
  topicIndexKey,
  uploadFile,
  withRetry,
  writeSkippedReport,
  SKIP_STATES,
  SIZE_LIMIT_BYTES,
} from './import-media.mjs';

// -- helpers ------------------------------------------------------------------

/** Build a throwaway directory tree; returns its root and a cleanup function. */
function makeTree(spec) {
  const root = mkdtempSync(join(tmpdir(), 'aq-import-'));
  for (const [relPath, contents] of Object.entries(spec)) {
    const abs = join(root, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Plan a local tree the way the CLI does: list, then build. */
function planLocal(root, opts) {
  return buildPlan(listLocal(root), opts);
}

/** Minimal Response stand-in for the injected fetch. */
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const BASE = 'https://api.example.test';

/** Client wired to a scripted list of `[matcher, response]` handlers. */
function scriptedClient(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body, headers: init.headers });
    if (url.endsWith('/v1/auth/login')) {
      return jsonResponse(200, { accessToken: 'token-1', user: { email: 'admin@example.test' } });
    }
    for (const [matcher, respond] of handlers) {
      if (matcher(url, init)) return respond(url, init);
    }
    throw new Error(`unscripted request: ${init.method ?? 'GET'} ${url}`);
  };
  const client = createApiClient({ baseUrl: BASE, email: 'a@b.c', password: 'x', fetchImpl });
  return { client, calls, fetchImpl };
}

// -- parseArgs ----------------------------------------------------------------

test('parseArgs accepts a complete invocation', () => {
  const args = parseArgs(['--label', 'arenaquest', '-e', 'production', '--source', './media', '--limit', '5']);
  assert.equal(args.label, 'arenaquest');
  assert.equal(args.env, 'production');
  assert.equal(args.source, './media');
  assert.equal(args.driveFolderId, null);
  assert.equal(args.limit, 5);
  assert.equal(args.concurrency, 3, 'concurrency defaults to 3');
  assert.equal(args.dryRun, false);
});

test('parseArgs requires --label, a source and a valid --env', () => {
  assert.throws(() => parseArgs(['-e', 'staging', '--source', './m']), /--label <label> is required/);
  assert.throws(() => parseArgs(['--label', 'x', '--source', './m']), /-e\/--env must be one of/);
  assert.throws(() => parseArgs(['--label', 'x', '-e', 'dev', '--source', './m']), /got "dev"/);
  assert.throws(() => parseArgs(['--label', 'x', '-e', 'staging']), /one of --source .* or --drive-folder/);
});

test('parseArgs takes a Drive folder as an id or a URL, never both sources', () => {
  const base = ['--label', 'x', '-e', 'staging'];
  const id = '1FNH1WasCrrJQTz_HI7vl6atutarl0FC6';

  assert.equal(parseArgs([...base, '--drive-folder', id]).driveFolderId, id);
  assert.equal(
    parseArgs([...base, '--drive-folder', `https://drive.google.com/drive/folders/${id}?usp=sharing`]).driveFolderId,
    id,
  );
  assert.equal(parseArgs([...base, '--drive-folder', id]).source, null);
  assert.throws(
    () => parseArgs([...base, '--source', './m', '--drive-folder', id]),
    /mutually exclusive/,
  );
});

test('parseArgs rejects non-positive numeric flags', () => {
  const base = ['--label', 'x', '-e', 'staging', '--source', './m'];
  assert.throws(() => parseArgs([...base, '--limit', '0']), /--limit must be a positive integer/);
  assert.throws(() => parseArgs([...base, '--concurrency', 'many']), /--concurrency must be a positive integer/);
});

test('parseArgs short-circuits on --help before requiring anything', () => {
  assert.equal(parseArgs(['--help']).help, true);
});

// -- naming and ordering ------------------------------------------------------

test('parseOrderPrefix needs a punctuation separator', () => {
  assert.deepEqual(parseOrderPrefix('01 - Intro'), { order: 1, rest: 'Intro' });
  assert.deepEqual(parseOrderPrefix('02_setup'), { order: 2, rest: 'setup' });
  assert.deepEqual(parseOrderPrefix('3. Warm up'), { order: 3, rest: 'Warm up' });
  // A year-led title keeps its number: no separator, no prefix.
  assert.deepEqual(parseOrderPrefix('2024 Retrospectiva'), { order: null, rest: '2024 Retrospectiva' });
  // Nothing but a prefix leaves no title to use.
  assert.deepEqual(parseOrderPrefix('01 -'), { order: null, rest: '01 -' });
});

test('titleFromName turns a folder name into a human title', () => {
  assert.equal(titleFromName('01 - Fundamentos'), 'Fundamentos');
  assert.equal(titleFromName('02_ataque_rapido'), 'ataque rapido');
  assert.equal(titleFromName('Defesa'), 'Defesa');
});

test('compareSiblings puts numbered entries first and in order', () => {
  const entries = [
    { rawName: 'Zebra', order: null },
    { rawName: '10-ten', order: 10 },
    { rawName: '2-two', order: 2 },
    { rawName: 'Alpha', order: null },
  ];
  assert.deepEqual(
    [...entries].sort(compareSiblings).map((e) => e.rawName),
    ['2-two', '10-ten', 'Alpha', 'Zebra'],
  );
});

test('compareSiblings sorts trailing (n) suffixes naturally', () => {
  // The real library names its clips "Kakko (1).mp4" … "Kakko (10).mp4".
  const entries = ['Kakko (10).mp4', 'Kakko (2).mp4', 'Kakko (1).mp4'].map((rawName) => ({ rawName, order: null }));
  assert.deepEqual(
    [...entries].sort(compareSiblings).map((e) => e.rawName),
    ['Kakko (1).mp4', 'Kakko (2).mp4', 'Kakko (10).mp4'],
  );
});

test('contentTypeFor maps only the API-supported extensions', () => {
  assert.equal(contentTypeFor('aula.mp4'), 'video/mp4');
  assert.equal(contentTypeFor('AULA.MP4'), 'video/mp4');
  assert.equal(contentTypeFor('slide.PDF'), 'application/pdf');
  assert.equal(contentTypeFor('clip.mov'), null);
  assert.equal(contentTypeFor('README'), null);
});

test('formatBytes is readable at every scale', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(100 * 1024 * 1024), '100 MB');
});

// -- buildPlan ----------------------------------------------------------------

test('buildPlan mirrors the tree into ordered topics and files', () => {
  const { root, cleanup } = makeTree({
    '01-fundamentos/01-intro.mp4': 'a',
    '01-fundamentos/02-basico.mp4': 'bb',
    '01-fundamentos/01-avancado/tecnica.mp4': 'ccc',
    '02-defesa/postura.mp4': 'dddd',
    '.DS_Store': 'junk',
  });
  try {
    const plan = planLocal(root);

    assert.deepEqual(plan.topics.map((t) => t.key), [
      '01-fundamentos',
      '01-fundamentos/01-avancado',
      '02-defesa',
    ]);
    assert.deepEqual(plan.topics.map((t) => t.title), ['fundamentos', 'avancado', 'defesa']);
    assert.deepEqual(plan.topics.map((t) => t.depth), [0, 1, 0]);
    assert.equal(plan.topics[1].parentKey, '01-fundamentos');

    assert.deepEqual(plan.files.map((f) => f.title), ['intro', 'basico', 'tecnica', 'postura']);
    assert.equal(plan.files[0].topicKey, '01-fundamentos');
    assert.equal(plan.files[2].topicKey, '01-fundamentos/01-avancado');
    assert.equal(plan.files[0].contentType, 'video/mp4');
    assert.equal(plan.files[0].sizeBytes, 1);
    // Locally the ledger key is the relative path.
    assert.equal(plan.files[0].key, plan.files[0].relPath);
    // Dotfiles never become media.
    assert.equal(plan.violations.length, 0);
  } finally {
    cleanup();
  }
});

test('buildPlan reports unsupported, empty and oversized files instead of failing', () => {
  const { root, cleanup } = makeTree({
    'modulo/clip.mov': 'x',
    'modulo/empty.mp4': '',
    'modulo/ok.mp4': 'fine',
    'modulo/huge.mp4': 'x'.repeat(16),
  });
  try {
    // Force the oversized branch without writing 100 MB to disk.
    const realLimit = SIZE_LIMIT_BYTES['video/mp4'];
    SIZE_LIMIT_BYTES['video/mp4'] = 8;
    let plan;
    try {
      plan = planLocal(root);
    } finally {
      SIZE_LIMIT_BYTES['video/mp4'] = realLimit;
    }

    assert.deepEqual(plan.files.map((f) => f.fileName), ['ok.mp4']);
    const reasons = Object.fromEntries(plan.violations.map((v) => [v.relPath, v.reason]));
    assert.match(reasons['modulo/clip.mov'], /unsupported extension "\.mov"/);
    assert.match(reasons['modulo/empty.mp4'], /empty/);
    assert.match(reasons['modulo/huge.mp4'], /exceeds the API limit/);
  } finally {
    cleanup();
  }
});

test('buildPlan flags a Google Doc distinctly from an unknown extension', () => {
  const listing = [
    {
      type: 'dir',
      name: 'modulo',
      id: 'modulo',
      children: [
        { type: 'file', name: 'Exame.docx', id: 'f1', sizeBytes: 10, revision: 'r1', mimeType: 'application/vnd.google-apps.document' },
        { type: 'file', name: 'notas.txt', id: 'f2', sizeBytes: 10, revision: 'r2', mimeType: 'text/plain' },
      ],
    },
  ];
  const plan = buildPlan(listing);
  const reasons = Object.fromEntries(plan.violations.map((v) => [v.relPath, v.reason]));
  assert.match(reasons['modulo/Exame.docx'], /Google Docs.*export it to PDF/);
  assert.match(reasons['modulo/notas.txt'], /unsupported extension "\.txt"/);
});

test('buildPlan flags root-level files unless --root-topic is given', () => {
  const { root, cleanup } = makeTree({ 'solto.mp4': 'x' });
  try {
    const without = planLocal(root);
    assert.equal(without.files.length, 0);
    assert.match(without.violations[0].reason, /--root-topic/);

    const withRoot = planLocal(root, { rootTopicId: 'topic-uuid' });
    assert.equal(withRoot.files.length, 1);
    assert.equal(withRoot.files[0].topicKey, null);
    assert.equal(withRoot.violations.length, 0);
  } finally {
    cleanup();
  }
});

test('listLocal rejects a missing source directory', () => {
  assert.throws(() => listLocal(join(tmpdir(), 'aq-does-not-exist-xyz')), /--source is not a directory/);
});

// -- README -> topic content --------------------------------------------------

test('isReadme matches the instructions file in any casing', () => {
  assert.ok(isReadme('README.md'));
  assert.ok(isReadme('readme.md'));
  assert.ok(isReadme('  ReadMe.MD  '));
  assert.ok(!isReadme('readme.txt'));
  assert.ok(!isReadme('README-extra.md'));
});

test('buildPlan attaches a README to its folder instead of treating it as media', () => {
  const { root, cleanup } = makeTree({
    'modulo/README.md': '# Modulo\n\nInstrucoes.',
    'modulo/aula.mp4': 'bytes',
  });
  try {
    const plan = planLocal(root);
    assert.equal(plan.violations.length, 0, 'a README is never an unsupported-extension violation');
    assert.deepEqual(plan.files.map((f) => f.fileName), ['aula.mp4']);
    assert.equal(plan.topics[0].readme.name, 'README.md');
  } finally {
    cleanup();
  }
});

test('a README at the listing root belongs to --root-topic', () => {
  const { root, cleanup } = makeTree({ 'README.md': '# Guia do nivel' });
  try {
    // With a root topic named, the README beside the folder describes it.
    const withRoot = planLocal(root, { rootTopicId: 'root-uuid' });
    assert.equal(withRoot.violations.length, 0);
    assert.equal(withRoot.rootReadme.name, 'README.md');

    // Without one there is nothing for it to describe, so it is reported.
    const without = planLocal(root);
    assert.equal(without.rootReadme, null);
    assert.match(without.violations[0].reason, /pass --root-topic/);
  } finally {
    cleanup();
  }
});

test('resolveReadmes fills plan.root but never renames or moves the root topic', async () => {
  const plan = {
    topics: [],
    rootReadme: { name: 'README.md', id: 'r0' },
    root: null,
  };
  const warnings = [];
  await resolveReadmes(plan, {
    readText: async () => '```arenaquest\n{ "status": "draft", "estimatedMinutes": 60, "title": "X", "order": 3 }\n```\n\n# Guia',
    onWarning: (topic, message) => warnings.push(message),
  });

  assert.equal(plan.root.content, '# Guia');
  assert.equal(plan.root.status, 'draft');
  assert.equal(plan.root.estimatedMinutes, 60);
  assert.equal(warnings.filter((w) => /does not apply to --root-topic/.test(w)).length, 2);
});

test('applyRootReadme patches the root topic only when it drifted', async () => {
  const record = { id: 'root-1', content: '# Antigo', status: 'draft', estimatedMinutes: 0 };
  const patches = [];
  const { client } = scriptedClient([
    [
      (url, init) => url.endsWith('/v1/admin/topics/root-1') && init.method === 'GET',
      async () => jsonResponse(200, record),
    ],
    [
      (url, init) => url.endsWith('/v1/admin/topics/root-1') && init.method === 'PATCH',
      async (_url, init) => {
        patches.push(JSON.parse(init.body));
        return jsonResponse(200, record);
      },
    ],
  ]);

  assert.equal(await applyRootReadme(client, 'root-1', { content: '# Antigo' }), false);
  assert.equal(patches.length, 0, 'an unchanged root README costs no write');

  assert.equal(await applyRootReadme(client, 'root-1', { content: '# Novo' }), true);
  assert.deepEqual(patches, [{ content: '# Novo' }]);

  // Nothing to do without a root topic or without a README.
  assert.equal(await applyRootReadme(client, null, { content: '# x' }), false);
  assert.equal(await applyRootReadme(client, 'root-1', null), false);
});

test('parseReadmeMetadata reads the fenced block and validates every field', () => {
  const { metadata, warnings } = parseReadmeMetadata(
    '# T\n\n```arenaquest\n{ "order": 9, "status": "published", "estimatedMinutes": 90, "title": "9 Kyu" }\n```\n',
  );
  assert.deepEqual(metadata, { title: '9 Kyu', order: 9, estimatedMinutes: 90, status: 'published' });
  assert.deepEqual(warnings, []);
});

test('parseReadmeMetadata accepts a ```json arenaquest fence too', () => {
  const { metadata } = parseReadmeMetadata('```json arenaquest\n{ "order": 2 }\n```');
  assert.equal(metadata.order, 2);
});

test('parseReadmeMetadata degrades to a warning, never a failure', () => {
  assert.deepEqual(parseReadmeMetadata('# no block here'), { metadata: {}, warnings: [] });

  const broken = parseReadmeMetadata('```arenaquest\n{ not json\n```');
  assert.deepEqual(broken.metadata, {});
  assert.match(broken.warnings[0], /not valid JSON/);

  const wrongTypes = parseReadmeMetadata(
    '```arenaquest\n{ "order": "nine", "status": "archived", "estimatedMinutes": -1, "title": "" }\n```',
  );
  assert.deepEqual(wrongTypes.metadata, {});
  assert.equal(wrongTypes.warnings.length, 4);

  const notAnObject = parseReadmeMetadata('```arenaquest\n[1,2]\n```');
  assert.match(notAnObject.warnings[0], /must be a JSON object/);
});

test('stripMetadataBlock keeps the prose and drops the machine block', () => {
  const markdown = '```arenaquest\n{ "order": 1 }\n```\n\n# Titulo\n\nCorpo.';
  assert.equal(stripMetadataBlock(markdown), '# Titulo\n\nCorpo.');
  assert.equal(stripMetadataBlock('# Sem bloco'), '# Sem bloco');
});

test('resolveReadmes fills content and overrides from each README', async () => {
  const plan = {
    topics: [
      { key: 'a', title: 'raw name', readme: { name: 'README.md', id: 'r1' } },
      { key: 'b', title: 'untouched', readme: null },
    ],
  };
  const texts = { r1: '```arenaquest\n{ "order": 9, "title": "9 Kyu" }\n```\n\n# Conteudo' };

  await resolveReadmes(plan, { readText: async (node) => texts[node.id] });

  assert.equal(plan.topics[0].title, '9 Kyu', 'the metadata title wins over the folder name');
  assert.equal(plan.topics[0].order, 9);
  assert.equal(plan.topics[0].content, '# Conteudo');
  assert.equal(plan.topics[1].title, 'untouched');
  assert.equal(plan.topics[1].content, undefined);
});

test('resolveReadmes warns and continues when a README cannot be read', async () => {
  const plan = { topics: [{ key: 'a', title: 'Modulo', readme: { name: 'README.md', id: 'r1' } }] };
  const warnings = [];

  await resolveReadmes(plan, {
    readText: async () => {
      throw new Error('export failed');
    },
    onWarning: (topic, message) => warnings.push(message),
  });

  assert.match(warnings[0], /export failed/);
  assert.equal(plan.topics[0].content, undefined, 'the topic still imports, just without content');
});

// -- skipped-file report ------------------------------------------------------

test('buildPlan tags every skip with a stable machine-readable state', () => {
  const listing = [
    {
      type: 'dir',
      name: 'Shodan Gata',
      id: 'dir-1',
      children: [
        { type: 'file', name: 'Yume Otoshi (4).MOV', id: 'f1', sizeBytes: 1972989, revision: '318f4873', mimeType: 'video/quicktime' },
        { type: 'file', name: 'Exame.docx', id: 'f2', sizeBytes: 80301, revision: 'abc', mimeType: 'application/vnd.google-apps.document' },
        { type: 'file', name: 'vazio.mp4', id: 'f3', sizeBytes: 0, revision: 'zero' },
        { type: 'file', name: 'ok.mp4', id: 'f4', sizeBytes: 10, revision: 'fine' },
      ],
    },
  ];
  const plan = buildPlan(listing);

  assert.deepEqual(plan.files.map((f) => f.fileName), ['ok.mp4']);
  const byName = Object.fromEntries(plan.violations.map((v) => [v.fileName, v]));

  assert.equal(byName['Yume Otoshi (4).MOV'].state, SKIP_STATES.INVALID_TYPE);
  assert.equal(byName['Exame.docx'].state, SKIP_STATES.GOOGLE_DOC);
  assert.equal(byName['vazio.mp4'].state, SKIP_STATES.EMPTY);

  // Everything a later conversion pass needs to find the file and place it.
  const mov = byName['Yume Otoshi (4).MOV'];
  assert.equal(mov.key, 'f1');
  assert.equal(mov.relPath, 'Shodan Gata/Yume Otoshi (4).MOV');
  assert.equal(mov.topicKey, 'Shodan Gata');
  assert.equal(mov.sizeBytes, 1972989);
  assert.equal(mov.revision, '318f4873');
});

test('skippedReportPathFor sits beside the ledger', () => {
  assert.equal(
    skippedReportPathFor('budo', 'production', null),
    join('.arenaquest', 'skipped-budo-production.jsonl'),
  );
  assert.equal(skippedReportPathFor('budo', 'production', '/tmp/x.jsonl'), '/tmp/x.jsonl');
});

test('writeSkippedReport resolves each record to the topic it belonged in', () => {
  const { root, cleanup } = makeTree({ 'seed.txt': '' });
  try {
    const path = join(root, 'skipped.jsonl');
    const violations = [
      {
        key: 'f1',
        relPath: 'Shodan Gata/Yume Otoshi (4).MOV',
        fileName: 'Yume Otoshi (4).MOV',
        state: SKIP_STATES.INVALID_TYPE,
        reason: 'unsupported extension ".MOV"',
        topicKey: 'Shodan Gata',
        sizeBytes: 1972989,
        revision: '318f4873bdbb9a46fcb086a6cea8dce8',
      },
      {
        key: 'f2',
        relPath: 'Exame.docx',
        fileName: 'Exame.docx',
        state: SKIP_STATES.NO_TOPIC,
        reason: 'file sits at the source root',
        topicKey: null,
        sizeBytes: 80301,
        revision: 'abc',
      },
    ];

    const count = writeSkippedReport(path, violations, {
      idByKey: new Map([['Shodan Gata', 'bb5db35a-2841-4e3f-90ea-c7506b4587e1']]),
      rootTopicId: 'root-uuid',
    });
    assert.equal(count, 2);

    const records = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(records[0].topicId, 'bb5db35a-2841-4e3f-90ea-c7506b4587e1');
    assert.equal(records[0].relPath, 'Shodan Gata/Yume Otoshi (4).MOV');
    assert.equal(records[0].state, 'invalid-type');
    assert.equal(records[0].sizeBytes, 1972989);
    assert.equal(records[0].revision, '318f4873bdbb9a46fcb086a6cea8dce8');
    // A root-level file resolves to --root-topic.
    assert.equal(records[1].topicId, 'root-uuid');
  } finally {
    cleanup();
  }
});

test('writeSkippedReport replaces the file so fixed entries disappear', () => {
  const { root, cleanup } = makeTree({ 'seed.txt': '' });
  try {
    const path = join(root, 'skipped.jsonl');
    const one = [{ key: 'f1', relPath: 'a.MOV', state: 'invalid-type', topicKey: null, sizeBytes: 1, revision: 'r' }];

    writeSkippedReport(path, one, { rootTopicId: 't' });
    assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 1);

    // The file was converted and no longer skipped: the report must not keep it.
    assert.equal(writeSkippedReport(path, [], {}), 0);
    assert.equal(readFileSync(path, 'utf8'), '');
  } finally {
    cleanup();
  }
});

test('writeSkippedReport leaves topicId null when the topic was never created', () => {
  const { root, cleanup } = makeTree({ 'seed.txt': '' });
  try {
    const path = join(root, 'skipped.jsonl');
    writeSkippedReport(path, [{ key: 'f1', relPath: 'x/a.MOV', state: 'invalid-type', topicKey: 'x', sizeBytes: 1, revision: 'r' }], {});
    assert.equal(JSON.parse(readFileSync(path, 'utf8').trim()).topicId, null);
  } finally {
    cleanup();
  }
});

// -- ledger and resume --------------------------------------------------------

test('ledgerPathFor defaults per label and environment', () => {
  assert.equal(ledgerPathFor('arenaquest', 'production', null), join('.arenaquest', 'import-arenaquest-production.jsonl'));
  assert.equal(ledgerPathFor('budo', 'staging', '/tmp/x.jsonl'), '/tmp/x.jsonl');
});

test('readLedger keeps the last state per file and survives a torn line', () => {
  const { root, cleanup } = makeTree({ 'seed.txt': '' });
  try {
    const path = join(root, 'ledger.jsonl');
    appendLedger(path, { key: 'a.mp4', state: 'presigned', mediaId: 'm1' });
    appendLedger(path, { key: 'a.mp4', state: 'ready', mediaId: 'm1' });
    appendLedger(path, { key: 'b.mp4', state: 'uploaded', mediaId: 'm2' });
    writeFileSync(path, `${readFileSync(path, 'utf8')}{"key":"c.mp4","sta`, 'utf8');

    const entries = readLedger(path);
    assert.equal(entries.size, 2);
    assert.equal(entries.get('a.mp4').state, 'ready');
    assert.equal(entries.get('b.mp4').state, 'uploaded');
  } finally {
    cleanup();
  }
});

test('readLedger still loads a pre-Drive ledger keyed on relPath', () => {
  const { root, cleanup } = makeTree({ 'seed.txt': '' });
  try {
    const path = join(root, 'legacy.jsonl');
    writeFileSync(path, `${JSON.stringify({ relPath: 'aula.mp4', state: 'ready', mediaId: 'm1' })}\n`, 'utf8');
    assert.equal(readLedger(path).get('aula.mp4').state, 'ready');
  } finally {
    cleanup();
  }
});

test('readLedger on a missing file is an empty map, not an error', () => {
  assert.equal(readLedger(join(tmpdir(), 'aq-no-such-ledger.jsonl')).size, 0);
});

test('nextAction implements the resume state machine', () => {
  const file = { sizeBytes: 10, revision: 'abc' };
  const at = (state) => ({ state, sizeBytes: 10, revision: 'abc' });

  assert.equal(nextAction(undefined, file), 'presign');
  assert.equal(nextAction(at('ready'), file), 'skip');
  assert.equal(nextAction(at('uploaded'), file), 'finalize');
  assert.equal(nextAction(at('presigned'), file), 'recover');
  assert.equal(nextAction({ state: 'weird', sizeBytes: 10, revision: 'abc' }, file), 'presign');
  // A changed revision wins over any recorded state.
  assert.equal(nextAction({ state: 'ready', sizeBytes: 10, revision: 'zzz' }, file), 'replace');
});

test('nextAction reads a pre-Drive ledger entry through its size and mtime', () => {
  const file = { sizeBytes: 10, revision: '10:1000' };
  assert.equal(nextAction({ state: 'ready', sizeBytes: 10, mtimeMs: 1000 }, file), 'skip');
  assert.equal(nextAction({ state: 'ready', sizeBytes: 10, mtimeMs: 2000 }, file), 'replace');
});

test('an ApiError names the status, so a rate limit is not mistaken for a crash', () => {
  assert.match(new ApiError(429, 'RateLimited', 'slow down', null).message, /^HTTP 429 RateLimited: slow down/);
  assert.match(new ApiError(500, 'Boom', null, null).message, /^HTTP 500 Boom$/);
});

test('summariseHtmlError keeps the identifying line of a Cloudflare page', () => {
  const page = [
    '<!DOCTYPE html>',
    '<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->',
    '<head><title>budo.example.com | 522: Connection timed out</title></head>',
    '<body><span class="cf-footer-item">error code: 522</span></body>',
  ].join('\n');

  const summary = summariseHtmlError(page);
  assert.match(summary, /522: Connection timed out/);
  assert.match(summary, /Cloudflare error 522/);
  assert.ok(!summary.includes('DOCTYPE'), 'the boilerplate is dropped');
});

test('summariseHtmlError still says something for an unrecognised page', () => {
  assert.equal(summariseHtmlError('<html><body>nope</body></html>'), 'an HTML error page (not JSON)');
});

// -- retry and pool -----------------------------------------------------------

test('withRetry retries 5xx and gives up after the last attempt', async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new ApiError(503, 'ServiceUnavailable', null, null);
      return 'done';
    },
    { sleepImpl: async () => {} },
  );
  assert.equal(value, 'done');
  assert.equal(calls, 3);
});

test('withRetry never retries a 4xx decision', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new ApiError(422, 'FileTooLarge', 'too big', null);
      },
      { sleepImpl: async () => {} },
    ),
    /FileTooLarge/,
  );
  assert.equal(calls, 1);
});

test('runPool bounds concurrency and isolates failures', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await runPool([1, 2, 3, 4, 5], 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((done) => setTimeout(done, 5));
    inFlight -= 1;
    if (n === 3) throw new Error('boom');
    return n * 2;
  });

  assert.equal(peak, 2, 'never more than --concurrency in flight');
  assert.deepEqual(results.map((r) => r.ok), [true, true, false, true, true]);
  assert.equal(results[0].value, 2);
  assert.equal(results[2].error.message, 'boom');
  assert.equal(results[2].item, 3);
});

// -- topic reconciliation -----------------------------------------------------

test('indexTopics keys on parent and title, ignoring archived nodes', () => {
  const index = indexTopics([
    { id: 't1', parentId: null, title: 'Fundamentos', archived: false },
    { id: 't2', parentId: 't1', title: 'Avancado', archived: false },
    { id: 't3', parentId: null, title: 'Antigo', archived: true },
  ]);
  assert.equal(index.get(topicIndexKey(null, 'Fundamentos')).id, 't1');
  assert.equal(index.get(topicIndexKey('t1', 'Avancado')).id, 't2');
  assert.equal(index.has(topicIndexKey(null, 'Antigo')), false);
});

test('reconcileTopics creates only what is missing, sequentially and nested', async () => {
  const plan = {
    topics: [
      { key: 'a', parentKey: null, title: 'Fundamentos', depth: 0 },
      { key: 'a/b', parentKey: 'a', title: 'Avancado', depth: 1 },
      { key: 'c', parentKey: null, title: 'Defesa', depth: 0 },
    ],
  };
  const created = [];
  let counter = 0;
  const { client } = scriptedClient([
    [
      (url, init) => url.endsWith('/v1/admin/topics') && init.method === 'POST',
      async (_url, init) => {
        const body = JSON.parse(init.body);
        created.push(body);
        counter += 1;
        return jsonResponse(201, { id: `new-${counter}`, ...body });
      },
    ],
  ]);

  // "Fundamentos" already exists; the other two must be created.
  const index = indexTopics([{ id: 'existing-a', parentId: null, title: 'Fundamentos', archived: false }]);
  const result = await reconcileTopics(client, plan, { rootTopicId: null, index });

  assert.equal(result.created, 2);
  assert.equal(result.reused, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.idByKey.get('a'), 'existing-a');
  assert.equal(result.idByKey.get('a/b'), 'new-1');
  assert.equal(result.idByKey.get('c'), 'new-2');
  // The child is parented to the REUSED node, and everything is a draft.
  assert.deepEqual(created[0], { parentId: 'existing-a', title: 'Avancado', status: 'draft' });
  assert.deepEqual(created[1], { parentId: null, title: 'Defesa', status: 'draft' });
});

test('reconcileTopics sends README content and overrides on create', async () => {
  const plan = {
    topics: [
      { key: 'a', parentKey: null, title: '9 Kyu', depth: 0, content: '# Guia', status: 'published', estimatedMinutes: 90 },
    ],
  };
  const created = [];
  const { client } = scriptedClient([
    [
      (url, init) => url.endsWith('/v1/admin/topics') && init.method === 'POST',
      async (_url, init) => {
        created.push(JSON.parse(init.body));
        return jsonResponse(201, { id: 'new-1' });
      },
    ],
  ]);

  await reconcileTopics(client, plan, { rootTopicId: null, index: new Map() });
  assert.deepEqual(created[0], {
    parentId: null,
    title: '9 Kyu',
    status: 'published',
    content: '# Guia',
    estimatedMinutes: 90,
  });
});

test('reconcileTopics PATCHes a reused topic only when the README drifted', async () => {
  const existing = {
    id: 't1',
    parentId: null,
    title: 'Modulo',
    archived: false,
    content: '# Antigo',
    status: 'draft',
    estimatedMinutes: 0,
  };
  const patches = [];
  const { client } = scriptedClient([
    [
      (url, init) => url.includes('/v1/admin/topics/t1') && init.method === 'PATCH',
      async (_url, init) => {
        patches.push(JSON.parse(init.body));
        return jsonResponse(200, { ...existing, content: '# Novo' });
      },
    ],
  ]);

  // Same content -> no write at all.
  const unchanged = await reconcileTopics(
    client,
    { topics: [{ key: 'a', parentKey: null, title: 'Modulo', content: '# Antigo' }] },
    { rootTopicId: null, index: indexTopics([existing]) },
  );
  assert.equal(unchanged.updated, 0);
  assert.equal(patches.length, 0, 'an unchanged README costs no write');

  // Changed content -> exactly one PATCH, carrying only what differs.
  const changed = await reconcileTopics(
    client,
    { topics: [{ key: 'a', parentKey: null, title: 'Modulo', content: '# Novo' }] },
    { rootTopicId: null, index: indexTopics([existing]) },
  );
  assert.equal(changed.updated, 1);
  assert.deepEqual(patches, [{ content: '# Novo' }]);
});

test('reconcileTopics hangs the tree under --root-topic', async () => {
  const plan = { topics: [{ key: 'a', parentKey: null, title: 'Modulo', depth: 0 }] };
  const created = [];
  const { client } = scriptedClient([
    [
      (url, init) => url.endsWith('/v1/admin/topics') && init.method === 'POST',
      async (_url, init) => {
        created.push(JSON.parse(init.body));
        return jsonResponse(201, { id: 'new-1' });
      },
    ],
  ]);

  await reconcileTopics(client, plan, { rootTopicId: 'root-uuid', index: new Map() });
  assert.equal(created[0].parentId, 'root-uuid');
});

test('applyDeclaredOrder moves each sibling group in ascending declared order', async () => {
  const moves = [];
  const { client } = scriptedClient([
    [
      (url, init) => url.includes('/move') && init.method === 'POST',
      async (url, init) => {
        moves.push({ id: url.split('/topics/')[1].split('/')[0], ...JSON.parse(init.body) });
        return jsonResponse(200, {});
      },
    ],
  ]);

  const moved = await applyDeclaredOrder(client, [
    { topic: { key: 'c', order: 3 }, id: 'c', parentId: null },
    { topic: { key: 'a', order: 1 }, id: 'a', parentId: null },
    { topic: { key: 'nested', order: 1 }, id: 'n', parentId: 'p1' },
    { topic: { key: 'no-order' }, id: 'z', parentId: null },
  ]);

  assert.equal(moved, 3, 'a topic without a declared order is never moved');
  // Root group ascending, then the other parent group.
  assert.deepEqual(moves, [
    { id: 'a', newParentId: null, newSortOrder: 1 },
    { id: 'c', newParentId: null, newSortOrder: 3 },
    { id: 'n', newParentId: 'p1', newSortOrder: 1 },
  ]);
});

test('applyDeclaredOrder leaves a group that already sits where the README asks', async () => {
  const moves = [];
  const { client } = scriptedClient([
    [
      (url, init) => url.includes('/move') && init.method === 'POST',
      async (url) => {
        moves.push(url);
        return jsonResponse(200, {});
      },
    ],
  ]);

  const settled = [
    { topic: { key: 'a', order: 0 }, id: 'a', parentId: null, currentOrder: 0 },
    { topic: { key: 'b', order: 1 }, id: 'b', parentId: null, currentOrder: 1 },
  ];
  assert.equal(await applyDeclaredOrder(client, settled), 0);
  assert.equal(moves.length, 0, 'a no-op re-run must not write');

  // One member out of place puts the whole group back in order.
  const drifted = [
    { topic: { key: 'a', order: 0 }, id: 'a', parentId: null, currentOrder: 1 },
    { topic: { key: 'b', order: 1 }, id: 'b', parentId: null, currentOrder: 0 },
  ];
  assert.equal(await applyDeclaredOrder(client, drifted), 2);
});

// -- upload lifecycle ---------------------------------------------------------

/** A one-file fixture plus its ledger path. */
function uploadFixture(contents = 'video-bytes') {
  const { root, cleanup } = makeTree({ 'aula.mp4': contents });
  const file = {
    key: 'aula.mp4',
    relPath: 'aula.mp4',
    absPath: join(root, 'aula.mp4'),
    fileName: 'aula.mp4',
    title: 'aula',
    contentType: 'video/mp4',
    sizeBytes: Buffer.byteLength(contents),
    revision: `${Buffer.byteLength(contents)}:1234`,
    topicKey: 'a',
  };
  const readBytes = createLocalSource(root).readBytes;
  return { file, readBytes, ledgerPath: join(root, 'ledger.jsonl'), cleanup };
}

test('uploadFile runs presign then PUT then finalize and records each step', async () => {
  const { file, readBytes, ledgerPath, cleanup } = uploadFixture();
  try {
    const put = [];
    const { client, fetchImpl } = scriptedClient([
      [
        (url) => url.includes('/media/presign'),
        async () => jsonResponse(201, { uploadUrl: 'https://r2.test/put', media: { id: 'm1', storageKey: 'k1' } }),
      ],
      [(url) => url.includes('/media/m1/finalize'), async () => jsonResponse(200, { id: 'm1', status: 'ready' })],
      [
        (url) => url === 'https://r2.test/put',
        async (_url, init) => {
          put.push(init);
          return jsonResponse(200, undefined);
        },
      ],
    ]);

    const result = await uploadFile(client, { file, topicId: 't1', ledgerPath, entry: undefined, readBytes, fetchImpl });
    assert.equal(result.outcome, 'uploaded');

    // The signature covers Content-Type and Content-Length, so both must match.
    assert.equal(put.length, 1);
    assert.equal(put[0].method, 'PUT');
    assert.equal(put[0].headers['Content-Type'], 'video/mp4');
    assert.equal(put[0].headers['Content-Length'], String(file.sizeBytes));
    assert.equal(put[0].body.byteLength, file.sizeBytes);

    const records = readFileSync(ledgerPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(records.map((r) => r.state), ['presigned', 'uploaded', 'ready']);
    assert.equal(records[0].revision, file.revision, 'the ledger records the revision it uploaded');
    assert.equal(readLedger(ledgerPath).get('aula.mp4').mediaId, 'm1');
  } finally {
    cleanup();
  }
});

test('uploadFile aborts when the source bytes no longer match the signed size', async () => {
  const { file, ledgerPath, cleanup } = uploadFixture();
  try {
    const { client, fetchImpl } = scriptedClient([
      [
        (url) => url.includes('/media/presign'),
        async () => jsonResponse(201, { uploadUrl: 'https://r2.test/put', media: { id: 'm1', storageKey: 'k1' } }),
      ],
    ]);

    await assert.rejects(
      uploadFile(client, {
        file,
        topicId: 't1',
        ledgerPath,
        entry: undefined,
        readBytes: async () => Buffer.from('a different length entirely'),
        fetchImpl,
      }),
      /changed at the source during the run/,
    );
  } finally {
    cleanup();
  }
});

test('uploadFile skips a file already marked ready', async () => {
  const { file, readBytes, ledgerPath, cleanup } = uploadFixture();
  try {
    const { client, calls, fetchImpl } = scriptedClient([]);
    const entry = { state: 'ready', mediaId: 'm1', sizeBytes: file.sizeBytes, revision: file.revision };
    const result = await uploadFile(client, { file, topicId: 't1', ledgerPath, entry, readBytes, fetchImpl });

    assert.equal(result.outcome, 'skipped');
    assert.equal(calls.length, 0, 'a skipped file costs no request at all');
  } finally {
    cleanup();
  }
});

test('uploadFile resumes an "uploaded" file with finalize alone', async () => {
  const { file, readBytes, ledgerPath, cleanup } = uploadFixture();
  try {
    const { client, calls, fetchImpl } = scriptedClient([
      [(url) => url.includes('/media/m1/finalize'), async () => jsonResponse(200, { id: 'm1', status: 'ready' })],
    ]);
    const entry = { state: 'uploaded', mediaId: 'm1', sizeBytes: file.sizeBytes, revision: file.revision };
    const result = await uploadFile(client, { file, topicId: 't1', ledgerPath, entry, readBytes, fetchImpl });

    assert.equal(result.outcome, 'recovered');
    assert.equal(calls.filter((c) => c.url.includes('/presign')).length, 0, 'no re-upload');
  } finally {
    cleanup();
  }
});

test('uploadFile drops the stale pending row when the presigned URL expired', async () => {
  const { file, readBytes, ledgerPath, cleanup } = uploadFixture();
  try {
    const { client, calls, fetchImpl } = scriptedClient([
      [
        (url) => url.includes('/media/stale/finalize'),
        async () => jsonResponse(422, { error: 'NotUploaded', detail: 'object not found in storage' }),
      ],
      [(url, init) => url.includes('/media/stale') && init.method === 'DELETE', async () => jsonResponse(204)],
      [
        (url) => url.includes('/media/presign'),
        async () => jsonResponse(201, { uploadUrl: 'https://r2.test/put', media: { id: 'fresh', storageKey: 'k2' } }),
      ],
      [(url) => url === 'https://r2.test/put', async () => jsonResponse(200, undefined)],
      [(url) => url.includes('/media/fresh/finalize'), async () => jsonResponse(200, { id: 'fresh', status: 'ready' })],
    ]);
    const entry = { state: 'presigned', mediaId: 'stale', sizeBytes: file.sizeBytes, revision: file.revision };
    const result = await uploadFile(client, { file, topicId: 't1', ledgerPath, entry, readBytes, fetchImpl });

    assert.equal(result.outcome, 'uploaded');
    assert.equal(
      calls.filter((c) => c.method === 'DELETE').length,
      1,
      'the orphan pending row is removed rather than left behind',
    );
    assert.equal(readLedger(ledgerPath).get('aula.mp4').mediaId, 'fresh');
  } finally {
    cleanup();
  }
});

test('uploadFile replaces the media row when the source revision changed', async () => {
  const { file, readBytes, ledgerPath, cleanup } = uploadFixture();
  try {
    const { client, calls, fetchImpl } = scriptedClient([
      [(url, init) => url.includes('/media/old') && init.method === 'DELETE', async () => jsonResponse(204)],
      [
        (url) => url.includes('/media/presign'),
        async () => jsonResponse(201, { uploadUrl: 'https://r2.test/put', media: { id: 'new', storageKey: 'k3' } }),
      ],
      [(url) => url === 'https://r2.test/put', async () => jsonResponse(200, undefined)],
      [(url) => url.includes('/media/new/finalize'), async () => jsonResponse(200, { id: 'new', status: 'ready' })],
    ]);
    // Same key, different revision than the recorded run.
    const entry = { state: 'ready', mediaId: 'old', sizeBytes: file.sizeBytes, revision: 'stale-checksum' };
    const result = await uploadFile(client, { file, topicId: 't1', ledgerPath, entry, readBytes, fetchImpl });

    assert.equal(result.outcome, 'uploaded');
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 1);
  } finally {
    cleanup();
  }
});

test('uploadFile surfaces a 422 FileTooLarge from presign without retrying', async () => {
  const { file, readBytes, ledgerPath, cleanup } = uploadFixture();
  try {
    let presignCalls = 0;
    const { client, fetchImpl } = scriptedClient([
      [
        (url) => url.includes('/media/presign'),
        async () => {
          presignCalls += 1;
          return jsonResponse(422, { error: 'FileTooLarge', detail: 'video/mp4 files must be <= 100 MB' });
        },
      ],
    ]);

    await assert.rejects(
      uploadFile(client, { file, topicId: 't1', ledgerPath, entry: undefined, readBytes, fetchImpl }),
      /FileTooLarge/,
    );
    assert.equal(presignCalls, 1, 'a 422 is a decision, not a transient failure');
  } finally {
    cleanup();
  }
});

// -- auth ---------------------------------------------------------------------

test('createApiClient re-authenticates once on a 401 and retries the call', async () => {
  let logins = 0;
  let topicCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/auth/login')) {
      logins += 1;
      return jsonResponse(200, { accessToken: `token-${logins}`, user: { email: 'admin@example.test' } });
    }
    topicCalls += 1;
    if (topicCalls === 1) return jsonResponse(401, { error: 'Unauthorized' });
    return jsonResponse(200, { data: [] });
  };

  const client = createApiClient({ baseUrl: BASE, email: 'a@b.c', password: 'x', fetchImpl });
  const result = await client.request('GET', '/v1/admin/topics');

  assert.deepEqual(result, { data: [] });
  assert.equal(logins, 2, 'the expired token triggers exactly one re-login');
  assert.equal(topicCalls, 2);
});

test('createApiClient re-logins proactively once the token lifetime elapses', async () => {
  let logins = 0;
  let clock = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/auth/login')) {
      logins += 1;
      return jsonResponse(200, { accessToken: `token-${logins}` });
    }
    return jsonResponse(200, { data: [] });
  };

  const client = createApiClient({ baseUrl: BASE, email: 'a@b.c', password: 'x', fetchImpl, now: () => clock });
  await client.request('GET', '/v1/admin/topics');
  assert.equal(logins, 1);

  await client.request('GET', '/v1/admin/topics');
  assert.equal(logins, 1, 'still inside the token lifetime');

  clock += 900_000; // past 15 min
  await client.request('GET', '/v1/admin/topics');
  assert.equal(logins, 2, 'refreshed before the token could expire mid-flight');
});

test('createApiClient reports a login failure with the API error code', async () => {
  const fetchImpl = async () => jsonResponse(401, { error: 'InvalidCredentials' });
  const client = createApiClient({ baseUrl: BASE, email: 'a@b.c', password: 'x', fetchImpl });
  await assert.rejects(client.login(), /InvalidCredentials/);
});

// -- base URL resolution ------------------------------------------------------

test('resolveBaseUrl reads the committed profile for a deployed environment', () => {
  assert.equal(resolveBaseUrl('arenaquest', 'production', { override: undefined }), 'https://api.arenaquest.app');
});

test('resolveBaseUrl accepts a loopback override for local development', () => {
  assert.equal(resolveBaseUrl('arenaquest', 'staging', { override: 'http://127.0.0.1:8787/' }), 'http://127.0.0.1:8787');
  assert.equal(resolveBaseUrl('arenaquest', 'staging', { override: 'http://localhost:8787' }), 'http://localhost:8787');
});

test('resolveBaseUrl refuses to let an env var redirect a deployed import', () => {
  assert.throws(
    () => resolveBaseUrl('arenaquest', 'production', { override: 'https://evil.example.com' }),
    /may only point at localhost/,
  );
});
