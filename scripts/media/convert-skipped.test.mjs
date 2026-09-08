/**
 * scripts/media/convert-skipped.test.mjs — unit tests for the skipped-media
 * converter.
 *
 * Pure functions and the two conversion pipelines only: no ffmpeg, no
 * LibreOffice, no network. The external tools are exercised through an injected
 * `exec`, and the filesystem through a temp tree under `os.tmpdir()`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  CONVERTERS,
  appendLedger,
  buildManifest,
  canRemux,
  confirmConversion,
  convertDocument,
  convertJob,
  convertVideo,
  ffmpegRemuxArgs,
  ffmpegTranscodeArgs,
  findExecutable,
  groupJobsByTopic,
  indexSourceTree,
  isSafeRelPath,
  matchRecord,
  nextAction,
  normalizeName,
  normalizeRelPath,
  outputRelPathFor,
  parseArgs,
  parseOnly,
  parseProbe,
  planJobs,
  readLedger,
  readReport,
  reportName,
  resolveTools,
  sofficeArgs,
  videoAttempts,
  writeManifest,
} from './convert-skipped.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'aq-convert-test-'));
}

function writeJsonl(path, rows) {
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

/** A report row shaped like the importer's own output. */
function reportRow(overrides = {}) {
  return {
    key: 'drive-id-1',
    relPath: 'Bojutsu/Shoden/Ichimonji.MOV',
    fileName: 'Ichimonji.MOV',
    state: 'invalid-type',
    reason: 'unsupported extension ".mov"',
    topicId: 'topic-1',
    topicKey: 'Bojutsu/Shoden',
    sizeBytes: 10,
    revision: 'abc',
    ...overrides,
  };
}

// -- argument parsing ---------------------------------------------------------

test('parseArgs requires a report and a source', () => {
  assert.throws(() => parseArgs([]), /--report <path> is required/);
  assert.throws(() => parseArgs(['--report', 'r.jsonl']), /--source <dir> is required/);
});

test('parseArgs derives the run name from the report file', () => {
  const args = parseArgs(['--report', '.arenaquest/skipped-budo-production.jsonl', '--source', './content']);
  assert.equal(args.out, join('.arenaquest', 'converted', 'budo-production'));
  assert.equal(args.ledger, join('.arenaquest', 'convert-budo-production.jsonl'));
  assert.equal(args.manifest, join('.arenaquest', 'converted-budo-production.jsonl'));
});

test('reportName strips the skipped- prefix and the extension, and never returns empty', () => {
  assert.equal(reportName('/x/skipped-budo-production.jsonl'), 'budo-production');
  assert.equal(reportName('report.jsonl'), 'report');
  assert.equal(reportName('skipped-.jsonl'), 'skipped');
});

test('parseArgs rejects non-positive numeric flags', () => {
  const base = ['--report', 'r.jsonl', '--source', 's'];
  assert.throws(() => parseArgs([...base, '--limit', '0']), /--limit must be a positive integer/);
  assert.throws(() => parseArgs([...base, '--concurrency', 'x']), /--concurrency must be a positive integer/);
});

test('parseOnly normalises extensions and rejects unknown ones', () => {
  assert.deepEqual([...parseOnly('mov,.DOCX')], ['.mov', '.docx']);
  assert.equal(parseOnly(undefined), null);
  assert.throws(() => parseOnly('avi'), /no converter for \.avi/);
});

// -- report -------------------------------------------------------------------

test('readReport parses rows and counts the unreadable ones', () => {
  const dir = tempDir();
  const path = join(dir, 'skipped.jsonl');
  writeFileSync(path, `${JSON.stringify(reportRow())}\n\nnot json\n${JSON.stringify({ nothing: true })}\n`, 'utf8');

  const { records, malformed } = readReport(path);
  assert.equal(records.length, 1);
  assert.equal(malformed, 2);
  assert.equal(records[0].topicId, 'topic-1');
  rmSync(dir, { recursive: true, force: true });
});

test('readReport falls back to the relPath basename when fileName is absent', () => {
  const dir = tempDir();
  const path = join(dir, 'skipped.jsonl');
  writeJsonl(path, [{ relPath: 'a/b/Clip.MOV' }]);
  assert.equal(readReport(path).records[0].fileName, 'Clip.MOV');
  rmSync(dir, { recursive: true, force: true });
});

test('readReport throws on a missing file', () => {
  assert.throws(() => readReport(join(tempDir(), 'nope.jsonl')), /report not found/);
});

// -- matching -----------------------------------------------------------------

test('normalizeName folds case and Unicode form so NFD and NFC match', () => {
  assert.equal(normalizeName('Chūdan.JPG'.normalize('NFD')), normalizeName('chūdan.jpg'.normalize('NFC')));
});

test('normalizeRelPath unifies separators', () => {
  assert.equal(normalizeRelPath('A\\B/c.MOV'), 'a/b/c.mov');
});

test('indexSourceTree walks recursively and skips dot-dirs and OS junk', () => {
  const readDir = (dir) => {
    if (dir === '/root') {
      return [
        { name: 'Bojutsu', isDirectory: true },
        { name: '.git', isDirectory: true },
        { name: '.DS_Store', isDirectory: false },
        { name: 'Loose.MOV', isDirectory: false },
      ];
    }
    if (dir === join('/root', 'Bojutsu')) return [{ name: 'Ichimonji.MOV', isDirectory: false }];
    throw new Error(`unexpected dir ${dir}`);
  };

  const index = indexSourceTree('/root', { readDir });
  assert.equal(index.count, 2);
  assert.equal(index.byPath.get('bojutsu/ichimonji.mov'), 'Bojutsu/Ichimonji.MOV');
  assert.deepEqual(index.byName.get('loose.mov'), ['Loose.MOV']);
});

test('matchRecord prefers the full path, falls back to the name, and reports ambiguity', () => {
  const index = {
    byPath: new Map([['bojutsu/shoden/ichimonji.mov', 'Bojutsu/Shoden/Ichimonji.MOV']]),
    byName: new Map([
      ['ichimonji.mov', ['Bojutsu/Shoden/Ichimonji.MOV', 'Backup/Ichimonji.MOV']],
      ['solo.mov', ['flat/Solo.mov']],
    ]),
  };

  assert.deepEqual(matchRecord(reportRow(), index), {
    state: 'matched',
    sourceRelPath: 'Bojutsu/Shoden/Ichimonji.MOV',
    via: 'path',
  });
  assert.deepEqual(matchRecord(reportRow({ relPath: 'Elsewhere/Solo.mov', fileName: 'Solo.mov' }), index), {
    state: 'matched',
    sourceRelPath: 'flat/Solo.mov',
    via: 'name',
  });
  // Same name twice and no path hit: refuse rather than pick the wrong take.
  assert.equal(matchRecord(reportRow({ relPath: 'Elsewhere/Ichimonji.MOV' }), index).state, 'ambiguous');
  assert.equal(matchRecord(reportRow({ relPath: 'x/Ghost.MOV', fileName: 'Ghost.MOV' }), index).state, 'missing');
});

// -- planning -----------------------------------------------------------------

test('outputRelPathFor keeps the tree and swaps the extension', () => {
  assert.equal(outputRelPathFor('Bojutsu/Shoden/Ichimonji.MOV', '.mp4'), 'Bojutsu/Shoden/Ichimonji.mp4');
  assert.equal(outputRelPathFor('Bojutsu Eng. 2024.docx', '.pdf'), 'Bojutsu Eng. 2024.pdf');
});

test('isSafeRelPath refuses anything that could escape the output tree', () => {
  assert.equal(isSafeRelPath('a/b.mov'), true);
  assert.equal(isSafeRelPath('../b.mov'), false);
  assert.equal(isSafeRelPath('a/../../b.mov'), false);
  assert.equal(isSafeRelPath('/abs/b.mov'), false);
  assert.equal(isSafeRelPath(''), false);
});

test('planJobs sorts every record into exactly one bucket', () => {
  const index = {
    byPath: new Map([['bojutsu/shoden/ichimonji.mov', 'Bojutsu/Shoden/Ichimonji.MOV']]),
    byName: new Map([
      ['ichimonji.mov', ['Bojutsu/Shoden/Ichimonji.MOV']],
      ['doc.docx', ['Docs/Doc.docx']],
      ['twin.mov', ['a/Twin.MOV', 'b/Twin.MOV']],
    ]),
  };
  const records = [
    reportRow(),
    reportRow({ key: 'k2', relPath: 'Docs/Doc.docx', fileName: 'Doc.docx' }),
    reportRow({ key: 'k3', relPath: 'x/Photo.jpg', fileName: 'Photo.jpg', state: 'too-large' }),
    reportRow({ key: 'k4', relPath: 'x/Ghost.MOV', fileName: 'Ghost.MOV' }),
    reportRow({ key: 'k5', relPath: 'c/Twin.MOV', fileName: 'Twin.MOV' }),
    reportRow({ key: 'k6', relPath: '../Escape.MOV', fileName: 'Escape.MOV' }),
  ];

  const plan = planJobs({
    records,
    index,
    outDir: '/out',
    sourceRoot: '/src',
    stat: () => ({ size: 2048, mtimeMs: 1000 }),
  });

  assert.deepEqual(plan.jobs.map((job) => job.key), ['drive-id-1', 'k2']);
  assert.deepEqual(plan.unsupported.map((r) => r.key), ['k3']);
  assert.deepEqual(plan.missing.map((r) => r.key), ['k4']);
  assert.deepEqual(plan.ambiguous.map((r) => r.key), ['k5']);
  assert.deepEqual(plan.unsafe.map((r) => r.key), ['k6']);

  const [video, doc] = plan.jobs;
  assert.equal(video.outPath, join('/out', 'Bojutsu', 'Shoden', 'Ichimonji.mp4'));
  assert.equal(video.contentType, 'video/mp4');
  assert.equal(video.sizeLimit, 100 * 1024 * 1024);
  assert.equal(video.sourceRevision, '2048:1000');
  assert.equal(video.topicId, 'topic-1');
  assert.equal(doc.contentType, 'application/pdf');
  assert.equal(doc.tool, 'soffice');
});

test('planJobs honours --only and applies --limit to the pending jobs', () => {
  const index = {
    byPath: new Map(),
    byName: new Map([
      ['a.mov', ['a.MOV']],
      ['b.mov', ['b.MOV']],
      ['c.docx', ['c.docx']],
    ]),
  };
  const records = [
    reportRow({ key: 'a', relPath: 'a.MOV', fileName: 'a.MOV' }),
    reportRow({ key: 'b', relPath: 'b.MOV', fileName: 'b.MOV' }),
    reportRow({ key: 'c', relPath: 'c.docx', fileName: 'c.docx' }),
  ];
  const common = { records, index, outDir: '/out', sourceRoot: '/src', stat: () => ({ size: 1, mtimeMs: 1 }) };

  const only = planJobs({ ...common, only: new Set(['.mov']) });
  assert.deepEqual(only.jobs.map((job) => job.key), ['a', 'b']);
  assert.deepEqual(only.filtered.map((r) => r.key), ['c']);

  const limited = planJobs({ ...common, only: new Set(['.mov']), limit: 1 });
  assert.deepEqual(limited.jobs.map((job) => job.key), ['a']);
  assert.equal(limited.pendingTotal, 2, '--limit must not hide how much is still pending');
});

test('planJobs skips ledger-converted files unless --force', () => {
  const index = { byPath: new Map(), byName: new Map([['a.mov', ['a.MOV']]]) };
  const records = [reportRow({ key: 'a', relPath: 'a.MOV', fileName: 'a.MOV' })];
  const entries = new Map([['a', { key: 'a', state: 'converted', sourceRevision: '1:1' }]]);
  const common = { records, index, outDir: '/out', sourceRoot: '/src', entries, stat: () => ({ size: 1, mtimeMs: 1 }) };

  // The ledger says converted, but the output is gone from /out — so: convert.
  assert.equal(planJobs(common).jobs.length, 1);
  assert.equal(planJobs({ ...common, force: true }).jobs.length, 1);
});

test('nextAction only skips a converted, unchanged file whose output still exists', () => {
  const job = { sourceRevision: '10:5', outPath: '/out/a.mp4' };
  const yes = { exists: () => true };
  assert.equal(nextAction(undefined, job, yes), 'convert');
  assert.equal(nextAction({ state: 'failed', sourceRevision: '10:5' }, job, yes), 'convert');
  assert.equal(nextAction({ state: 'converted', sourceRevision: '99:9' }, job, yes), 'convert');
  assert.equal(nextAction({ state: 'converted', sourceRevision: '10:5' }, job, { exists: () => false }), 'convert');
  assert.equal(nextAction({ state: 'converted', sourceRevision: '10:5' }, job, yes), 'skip');
});

// -- ledger + manifest --------------------------------------------------------

test('readLedger keeps the last record per key and survives a torn line', () => {
  const dir = tempDir();
  const path = join(dir, 'ledger.jsonl');
  appendLedger(path, { key: 'a', state: 'failed' });
  appendLedger(path, { key: 'a', state: 'converted' });
  writeFileSync(path, `${readFileSync(path, 'utf8')}{"key":"b","sta`, 'utf8');

  const entries = readLedger(path);
  assert.equal(entries.size, 1);
  assert.equal(entries.get('a').state, 'converted');
  assert.deepEqual(readLedger(join(dir, 'absent.jsonl')), new Map());
  rmSync(dir, { recursive: true, force: true });
});

test('buildManifest carries the topicId and drops anything still over the limit', () => {
  const rows = buildManifest([
    { key: 'a', state: 'converted', withinLimit: true, outRelPath: 'x/A.mp4', contentType: 'video/mp4', outSizeBytes: 10, topicId: 't1', topicKey: 'x', sourceRelPath: 'src/A.MOV' },
    { key: 'b', state: 'converted', withinLimit: false, outRelPath: 'x/B.mp4', topicId: 't2' },
    { key: 'c', state: 'failed', outRelPath: 'x/C.mp4', topicId: 't3' },
  ]);
  assert.deepEqual(rows.map((row) => row.key), ['a']);
  assert.equal(rows[0].fileName, 'A.mp4');
  assert.equal(rows[0].topicId, 't1');
});

test('writeManifest replaces the file rather than appending', () => {
  const dir = tempDir();
  const path = join(dir, 'nested', 'manifest.jsonl');
  writeManifest(path, [{ key: 'a' }, { key: 'b' }]);
  assert.equal(writeManifest(path, [{ key: 'c' }]), 1);
  assert.equal(readFileSync(path, 'utf8'), '{"key":"c"}\n');
  writeManifest(path, []);
  assert.equal(readFileSync(path, 'utf8'), '');
  rmSync(dir, { recursive: true, force: true });
});

// -- external tools -----------------------------------------------------------

test('findExecutable returns the first executable candidate on PATH', () => {
  const canExecute = (path) => path === join('/usr/bin', 'libreoffice');
  assert.equal(findExecutable(['soffice', 'libreoffice'], { path: '/bin:/usr/bin', canExecute }), '/usr/bin/libreoffice');
  assert.equal(findExecutable(['soffice'], { path: '/bin:/usr/bin', canExecute }), null);
});

test('resolveTools reports each missing binary with its install command', () => {
  const { resolved, missing } = resolveTools(['ffmpeg', 'soffice'], {
    find: (candidates) => (candidates[0] === 'soffice' ? null : `/usr/bin/${candidates[0]}`),
  });
  assert.equal(resolved.ffmpeg, '/usr/bin/ffmpeg');
  assert.equal(resolved.ffprobe, '/usr/bin/ffprobe');
  assert.deepEqual(missing.map((m) => m.role), ['soffice']);
  assert.match(missing[0].fix, /libreoffice/);
});

test('resolveTools requires only the tools the plan actually uses', () => {
  const { missing } = resolveTools(['ffmpeg'], { find: (candidates) => (candidates[0] === 'soffice' ? null : '/bin/x') });
  assert.deepEqual(missing, []);
});

// -- ffmpeg -------------------------------------------------------------------

test('parseProbe reads the codecs and tolerates junk', () => {
  const json = JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'hevc' }, { codec_type: 'audio', codec_name: 'aac' }] });
  assert.deepEqual(parseProbe(json), { video: 'hevc', audio: 'aac' });
  assert.deepEqual(parseProbe('not json'), { video: null, audio: null });
  assert.deepEqual(parseProbe('{}'), { video: null, audio: null });
});

test('canRemux only accepts H.264 with AAC or no audio', () => {
  assert.equal(canRemux({ video: 'h264', audio: 'aac' }), true);
  assert.equal(canRemux({ video: 'h264', audio: null }), true);
  assert.equal(canRemux({ video: 'hevc', audio: 'aac' }), false);
  assert.equal(canRemux({ video: 'h264', audio: 'pcm_s16le' }), false);
});

test('ffmpeg args pin the mp4 muxer, since the output is a .part file', () => {
  const remux = ffmpegRemuxArgs('in.mov', 'out.mp4.part');
  assert.deepEqual(remux.slice(-3), ['-f', 'mp4', 'out.mp4.part']);
  assert.ok(remux.includes('-c') && remux[remux.indexOf('-c') + 1] === 'copy');

  const transcode = ffmpegTranscodeArgs('in.mov', 'out.mp4.part', { crf: 27, maxWidth: 1280 });
  assert.equal(transcode[transcode.length - 1], 'out.mp4.part');
  assert.equal(transcode[transcode.length - 2], 'mp4');
  assert.equal(transcode[transcode.indexOf('-crf') + 1], '27');
  assert.equal(transcode[transcode.indexOf('-vf') + 1], "scale='min(1280,iw)':-2");
  assert.ok(transcode.includes('yuv420p'), 'Safari needs 8-bit 4:2:0');
});

test('ffmpegTranscodeArgs omits the scale filter when no width cap is given', () => {
  assert.ok(!ffmpegTranscodeArgs('in.mov', 'out.mp4', { crf: 23 }).includes('-vf'));
});

test('videoAttempts leads with a remux when possible and escalates afterwards', () => {
  const remuxable = videoAttempts({ input: 'i', output: 'o', probe: { video: 'h264', audio: 'aac' }, crf: 23 });
  assert.deepEqual(remuxable.map((a) => a.label), [
    'remux (stream copy)',
    'transcode crf=23',
    'transcode crf=27',
    'transcode crf=31 width<=1280',
  ]);
  const transcodeOnly = videoAttempts({ input: 'i', output: 'o', probe: { video: 'hevc', audio: 'aac' }, crf: 23 });
  assert.equal(transcodeOnly[0].label, 'transcode crf=23');
});

// -- conversion pipelines -----------------------------------------------------

/** An `exec` that answers ffprobe and writes `sizes.shift()` bytes per encode. */
function fakeFfmpeg({ probe, sizes }) {
  const calls = [];
  return {
    calls,
    exec: async (command, args) => {
      calls.push({ command, args });
      if (command.includes('ffprobe')) return { stdout: JSON.stringify(probe), stderr: '' };
      writeFileSync(args[args.length - 1], Buffer.alloc(sizes.shift()));
      return { stdout: '', stderr: '' };
    },
  };
}

test('convertVideo commits the first output within the limit', async () => {
  const dir = tempDir();
  const job = { absPath: join(dir, 'in.mov'), outPath: join(dir, 'out.mp4'), sizeLimit: 100 };
  const { exec, calls } = fakeFfmpeg({ probe: { streams: [{ codec_type: 'video', codec_name: 'h264' }] }, sizes: [50] });

  const result = await convertVideo(job, { tools: { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe' }, crf: 23, exec });
  assert.equal(result.strategy, 'remux (stream copy)');
  assert.equal(result.withinLimit, true);
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 2, 'one probe, one encode — the ladder must not run');
  assert.equal(statSync(job.outPath).size, 50);
  assert.equal(existsSync(`${job.outPath}.part`), false, 'the .part file must be renamed away');
  rmSync(dir, { recursive: true, force: true });
});

test('convertVideo escalates while over the limit and keeps the last encode when none fits', async () => {
  const dir = tempDir();
  const job = { absPath: join(dir, 'in.mov'), outPath: join(dir, 'out.mp4'), sizeLimit: 100 };
  const { exec, calls } = fakeFfmpeg({
    probe: { streams: [{ codec_type: 'video', codec_name: 'hevc' }] },
    sizes: [500, 300, 200],
  });

  const result = await convertVideo(job, { tools: { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe' }, crf: 23, exec });
  assert.equal(result.withinLimit, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.outSizeBytes, 200);
  assert.equal(calls.length, 4, 'one probe plus the three transcode rungs');
  assert.equal(existsSync(job.outPath), true, 'an oversized result is still kept for a human to judge');
  rmSync(dir, { recursive: true, force: true });
});

test('convertVideo stops at the rung that fits', async () => {
  const dir = tempDir();
  const job = { absPath: join(dir, 'in.mov'), outPath: join(dir, 'out.mp4'), sizeLimit: 100 };
  const { exec } = fakeFfmpeg({ probe: { streams: [{ codec_type: 'video', codec_name: 'hevc' }] }, sizes: [500, 80] });

  const result = await convertVideo(job, { tools: { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe' }, crf: 23, exec });
  assert.equal(result.strategy, 'transcode crf=27');
  assert.equal(result.withinLimit, true);
  rmSync(dir, { recursive: true, force: true });
});

test('convertDocument copies LibreOffice output into place with a private profile', async () => {
  const dir = tempDir();
  const job = { absPath: join(dir, 'Bojutsu Eng. 2024.docx'), outPath: join(dir, 'Bojutsu Eng. 2024.pdf'), sizeLimit: 1000 };
  writeFileSync(job.absPath, 'x');

  let seen;
  const exec = async (command, args) => {
    seen = args;
    const outDir = args[args.indexOf('--outdir') + 1];
    writeFileSync(join(outDir, 'Bojutsu Eng. 2024.pdf'), Buffer.alloc(42));
    return { stdout: '', stderr: '' };
  };

  const result = await convertDocument(job, { tools: { soffice: '/bin/soffice' }, exec });
  assert.equal(result.withinLimit, true);
  assert.equal(result.outSizeBytes, 42);
  assert.equal(statSync(job.outPath).size, 42);
  // Without a per-job profile, concurrent LibreOffice runs silently no-op.
  assert.ok(seen.some((arg) => arg.startsWith('-env:UserInstallation=file://')));
  assert.ok(seen.includes('--headless') && seen.includes('--convert-to') && seen.includes('pdf'));
  rmSync(dir, { recursive: true, force: true });
});

test('convertDocument fails loudly when LibreOffice exits clean but writes nothing', async () => {
  const dir = tempDir();
  const job = { absPath: join(dir, 'a.docx'), outPath: join(dir, 'a.pdf'), sizeLimit: 1000 };
  writeFileSync(job.absPath, 'x');
  await assert.rejects(
    convertDocument(job, { tools: { soffice: '/bin/soffice' }, exec: async () => ({ stdout: '', stderr: '' }) }),
    /produced no PDF/,
  );
  assert.equal(existsSync(job.outPath), false);
  rmSync(dir, { recursive: true, force: true });
});

test('convertDocument flags a PDF over the API limit', async () => {
  const dir = tempDir();
  const job = { absPath: join(dir, 'a.docx'), outPath: join(dir, 'a.pdf'), sizeLimit: 10 };
  writeFileSync(job.absPath, 'x');
  const result = await convertDocument(job, {
    tools: { soffice: '/bin/soffice' },
    exec: async (command, args) => {
      writeFileSync(join(args[args.indexOf('--outdir') + 1], 'a.pdf'), Buffer.alloc(99));
      return { stdout: '', stderr: '' };
    },
  });
  assert.equal(result.withinLimit, false);
  rmSync(dir, { recursive: true, force: true });
});

test('convertJob creates the output directory and dispatches on the tool', async () => {
  const dir = tempDir();
  const job = {
    tool: 'ffmpeg',
    absPath: join(dir, 'in.mov'),
    outPath: join(dir, 'deep', 'nested', 'out.mp4'),
    sizeLimit: 100,
  };
  const { exec } = fakeFfmpeg({ probe: { streams: [{ codec_type: 'video', codec_name: 'h264' }] }, sizes: [10] });
  await convertJob(job, { tools: { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe' }, crf: 23, exec });
  assert.equal(existsSync(job.outPath), true);

  await assert.rejects(convertJob({ ...job, tool: 'nope' }, {}), /no converter implementation/);
  rmSync(dir, { recursive: true, force: true });
});

test('every converter targets an extension the importer accepts', async () => {
  const { CONTENT_TYPE_BY_EXTENSION } = await import('../content/import-media.mjs');
  for (const [ext, converter] of Object.entries(CONVERTERS)) {
    assert.ok(
      converter.targetExt in CONTENT_TYPE_BY_EXTENSION,
      `${ext} converts to ${converter.targetExt}, which the API would reject too`,
    );
    assert.ok(converter.tool in { ffmpeg: 1, soffice: 1 }, `${ext} names an unknown tool`);
  }
});

// -- review + confirmation ----------------------------------------------------

test('groupJobsByTopic keeps first-seen order and carries the topicId', () => {
  const groups = groupJobsByTopic([
    { topicKey: 'A', topicId: 't-a', relPath: 'A/1.MOV' },
    { topicKey: 'B', topicId: 't-b', relPath: 'B/1.MOV' },
    { topicKey: 'A', topicId: 't-a', relPath: 'A/2.MOV' },
    { topicKey: null, topicId: 't-root', relPath: '3.MOV' },
  ]);
  assert.deepEqual(groups.map((g) => [g.topicKey, g.topicId, g.jobs.length]), [
    ['A', 't-a', 2],
    ['B', 't-b', 1],
    ['(source root)', 't-root', 1],
  ]);
});

test('confirmConversion proceeds only on an explicit yes', async () => {
  const env = {};
  await confirmConversion({ count: 3, isTTY: true, env, promptFn: async () => 'y' });
  await confirmConversion({ count: 3, isTTY: true, env, promptFn: async () => 'YES' });
  await assert.rejects(
    confirmConversion({ count: 3, isTTY: true, env, promptFn: async () => '' }),
    /answered "nothing" — nothing was converted/,
  );
  await assert.rejects(
    confirmConversion({ count: 3, isTTY: true, env, promptFn: async () => 'n' }),
    /aborted/,
  );
});

test('confirmConversion is bypassed by --yes or CONFIRM=1, and never blocks without a TTY', async () => {
  const boom = async () => assert.fail('must not prompt');
  await confirmConversion({ count: 1, yes: true, isTTY: true, env: {}, promptFn: boom });
  await confirmConversion({ count: 1, isTTY: true, env: { CONFIRM: '1' }, promptFn: boom });
  await assert.rejects(
    confirmConversion({ count: 7, isTTY: false, env: {}, promptFn: boom }),
    /requires confirmation: re-run with --yes or set CONFIRM=1/,
  );
});

test('parseArgs exposes --yes', () => {
  assert.equal(parseArgs(['-r', 'r.jsonl', '-s', 's']).yes, false);
  assert.equal(parseArgs(['-r', 'r.jsonl', '-s', 's', '--yes']).yes, true);
});

// -- the manifest is an importer input ----------------------------------------

test('the manifest rows carry exactly what the importer needs to upload', async () => {
  const { buildManifestPlan, readManifest } = await import('../content/import-media.mjs');
  const dir = tempDir();

  // What the converter would write after rescuing one .mov.
  const rows = buildManifest([
    {
      key: 'drive-1',
      state: 'converted',
      withinLimit: true,
      outRelPath: 'Bojutsu/Shoden/Ichimonji.mp4',
      contentType: 'video/mp4',
      outSizeBytes: 2048,
      topicId: 'c77c375e-3287-4e79-b3bd-6e04ccc8727f',
      topicKey: 'Bojutsu/Shoden',
      sourceRelPath: 'Bojutsu/Shoden/Ichimonji.MOV',
    },
  ]);
  const manifestPath = join(dir, 'manifest.jsonl');
  writeManifest(manifestPath, rows);

  // ...and what the importer makes of it, against the converted tree on disk.
  mkdirSync(join(dir, 'out', 'Bojutsu', 'Shoden'), { recursive: true });
  writeFileSync(join(dir, 'out', 'Bojutsu', 'Shoden', 'Ichimonji.mp4'), Buffer.alloc(2048));

  const { rows: parsed, invalid } = readManifest(manifestPath);
  assert.deepEqual(invalid, [], 'the converter must not emit a row the importer rejects');

  const plan = buildManifestPlan(parsed, { sourceRoot: join(dir, 'out') });
  assert.deepEqual(plan.topics, []);
  assert.deepEqual(plan.violations, []);
  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].topicId, 'c77c375e-3287-4e79-b3bd-6e04ccc8727f');
  assert.equal(plan.files[0].key, 'drive-1', 'the original source identity survives the round trip');
  rmSync(dir, { recursive: true, force: true });
});
