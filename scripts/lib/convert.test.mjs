/**
 * scripts/lib/convert.test.mjs — focused tests for the shared conversion lib.
 *
 * The exhaustive behaviour is still asserted by
 * scripts/media/convert-skipped.test.mjs through the CLI's re-exports; this
 * suite pins the library's own contract: the remux decision, the transcode
 * ladder and its order, tool detection against a fake PATH, and `convertVideo`
 * driven by a stubbed `exec`. No real ffmpeg or LibreOffice is ever spawned.
 *
 * Run: node --test scripts/lib/convert.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEFAULT_CRF,
  TOOLS,
  canRemux,
  convertDocument,
  convertVideo,
  ffmpegRemuxArgs,
  ffmpegTranscodeArgs,
  ffprobeArgs,
  findExecutable,
  parseProbe,
  resolveTools,
  run,
  sofficeArgs,
  videoAttempts,
} from './convert.mjs';
import * as cli from '../media/convert-skipped.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'aq-convert-lib-test-'));
}

// -- re-exports keep identity -------------------------------------------------

test('the CLI re-exports the very same functions and tables', () => {
  assert.equal(cli.TOOLS, TOOLS);
  assert.equal(cli.DEFAULT_CRF, DEFAULT_CRF);
  assert.equal(cli.findExecutable, findExecutable);
  assert.equal(cli.resolveTools, resolveTools);
  assert.equal(cli.run, run);
  assert.equal(cli.ffprobeArgs, ffprobeArgs);
  assert.equal(cli.parseProbe, parseProbe);
  assert.equal(cli.canRemux, canRemux);
  assert.equal(cli.ffmpegRemuxArgs, ffmpegRemuxArgs);
  assert.equal(cli.ffmpegTranscodeArgs, ffmpegTranscodeArgs);
  assert.equal(cli.videoAttempts, videoAttempts);
  assert.equal(cli.sofficeArgs, sofficeArgs);
  assert.equal(cli.convertVideo, convertVideo);
  assert.equal(cli.convertDocument, convertDocument);
});

test('tools are detected and reported with their install command, never installed', () => {
  assert.equal(DEFAULT_CRF, 23);
  assert.deepEqual(Object.keys(TOOLS), ['ffmpeg', 'soffice']);
  assert.deepEqual(TOOLS.ffmpeg.binaries, { ffmpeg: ['ffmpeg'], ffprobe: ['ffprobe'] });
  assert.deepEqual(TOOLS.soffice.binaries, { soffice: ['soffice', 'libreoffice'] });
  assert.match(TOOLS.ffmpeg.fix, /apt-get install -y ffmpeg/);
  assert.match(TOOLS.soffice.fix, /apt-get install -y libreoffice-writer/);
});

// -- probe + remux decision ---------------------------------------------------

test('parseProbe reads codec names per stream and tolerates garbage', () => {
  const stdout = JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', codec_name: 'aac' }] });
  assert.deepEqual(parseProbe(stdout), { video: 'h264', audio: 'aac' });
  assert.deepEqual(parseProbe(JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'hevc' }] })), { video: 'hevc', audio: null });
  assert.deepEqual(parseProbe('not json'), { video: null, audio: null });
  assert.deepEqual(ffprobeArgs('in.mov'), ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', 'in.mov']);
});

test('canRemux is true only for H.264 with AAC or no audio', () => {
  assert.equal(canRemux({ video: 'h264', audio: 'aac' }), true);
  assert.equal(canRemux({ video: 'h264', audio: null }), true);
  assert.equal(canRemux({ video: 'h264', audio: 'pcm_s16le' }), false);
  assert.equal(canRemux({ video: 'hevc', audio: 'aac' }), false);
  assert.equal(canRemux({ video: null, audio: null }), false);
});

// -- ffmpeg arguments ---------------------------------------------------------

test('ffmpegRemuxArgs copies the streams into a faststart mp4 with an explicit muxer', () => {
  const args = ffmpegRemuxArgs('in.mov', 'out.mp4.part');
  assert.deepEqual(args, ['-nostdin', '-y', '-loglevel', 'error', '-i', 'in.mov', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', 'out.mp4.part']);
});

test('ffmpegTranscodeArgs encodes the web-safe baseline and only scales when capped', () => {
  const plain = ffmpegTranscodeArgs('in.mov', 'out.part');
  assert.equal(plain.includes('-vf'), false, 'no scale filter without a width cap');
  assert.equal(plain[plain.indexOf('-crf') + 1], String(DEFAULT_CRF));
  assert.equal(plain[plain.indexOf('-pix_fmt') + 1], 'yuv420p');
  assert.equal(plain[plain.indexOf('-c:v') + 1], 'libx264');
  assert.equal(plain[plain.indexOf('-c:a') + 1], 'aac');
  assert.deepEqual(plain.slice(-3), ['-f', 'mp4', 'out.part']);

  const capped = ffmpegTranscodeArgs('in.mov', 'out.part', { crf: 31, maxWidth: 1280 });
  assert.equal(capped[capped.indexOf('-vf') + 1], "scale='min(1280,iw)':-2", 'never upscales, keeps even dimensions');
  assert.equal(capped[capped.indexOf('-crf') + 1], '31');
});

test('videoAttempts orders remux, transcode, then the bounded fitting ladder', () => {
  const remuxable = videoAttempts({ input: 'in.mov', output: 'o.part', probe: { video: 'h264', audio: 'aac' }, crf: 20 });
  assert.deepEqual(
    remuxable.map((attempt) => attempt.label),
    ['remux (stream copy)', 'transcode crf=20', 'transcode crf=24', 'transcode crf=28 width<=1280'],
  );
  assert.deepEqual(remuxable[0].args, ffmpegRemuxArgs('in.mov', 'o.part'));
  assert.deepEqual(remuxable[3].args, ffmpegTranscodeArgs('in.mov', 'o.part', { crf: 28, maxWidth: 1280 }));

  const encodeOnly = videoAttempts({ input: 'in.mov', output: 'o.part', probe: { video: 'hevc', audio: 'aac' } });
  assert.deepEqual(
    encodeOnly.map((attempt) => attempt.label),
    [`transcode crf=${DEFAULT_CRF}`, `transcode crf=${DEFAULT_CRF + 4}`, `transcode crf=${DEFAULT_CRF + 8} width<=1280`],
  );
});

// -- tool detection -----------------------------------------------------------

test('findExecutable walks a fake PATH and returns the first executable candidate', () => {
  const dir = tempDir();
  try {
    const binA = join(dir, 'a');
    const binB = join(dir, 'b');
    mkdirSync(binA);
    mkdirSync(binB);
    writeFileSync(join(binB, 'ffmpeg'), '#!/bin/sh\n');
    chmodSync(join(binB, 'ffmpeg'), 0o755);
    writeFileSync(join(binA, 'libreoffice'), '#!/bin/sh\n');
    chmodSync(join(binA, 'libreoffice'), 0o644); // present but not executable

    const path = `${binA}:${binB}::${join(dir, 'missing')}`;
    assert.equal(findExecutable(['ffmpeg'], { path }), join(binB, 'ffmpeg'));
    assert.equal(findExecutable(['soffice', 'libreoffice'], { path }), null, 'a non-executable file does not count');
    assert.equal(findExecutable(['nothing'], { path }), null);

    // The candidate order wins over the PATH order.
    const seen = [];
    const found = findExecutable(['soffice', 'libreoffice'], { path: '/x;/y', delimiter: ';', canExecute: (p) => (seen.push(p), p === '/y/soffice') });
    assert.equal(found, '/y/soffice');
    assert.deepEqual(seen, ['/x/soffice', '/y/soffice']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveTools demands only the binaries the planned jobs need', () => {
  const find = (candidates) => (candidates[0] === 'ffmpeg' ? '/usr/bin/ffmpeg' : null);
  const { resolved, missing } = resolveTools(new Set(['ffmpeg', 'soffice', 'unknown']), { find });
  assert.deepEqual(resolved, { ffmpeg: '/usr/bin/ffmpeg' });
  assert.deepEqual(
    missing.map(({ tool, role, candidates, fix }) => ({ tool, role, candidates, fix })),
    [
      { tool: 'ffmpeg', role: 'ffprobe', candidates: ['ffprobe'], fix: TOOLS.ffmpeg.fix },
      { tool: 'soffice', role: 'soffice', candidates: ['soffice', 'libreoffice'], fix: TOOLS.soffice.fix },
    ],
  );
  assert.deepEqual(resolveTools(['ffmpeg'], { find: () => null }).missing.map((m) => m.role), ['ffmpeg', 'ffprobe']);
});

// -- convertVideo with a stubbed exec -----------------------------------------

/**
 * A fake ffmpeg: ffprobe answers the given probe, each encode writes the next
 * size from `sizes` to the output path (the last argument). Nothing is spawned.
 */
function fakeExec({ probe, sizes }) {
  const calls = [];
  let encodes = 0;
  const exec = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'ffprobe') return { stdout: JSON.stringify({ streams: probe }), stderr: '' };
    const output = args[args.length - 1];
    writeFileSync(output, Buffer.alloc(sizes[Math.min(encodes, sizes.length - 1)]));
    encodes += 1;
    return { stdout: '', stderr: '' };
  };
  return { exec, calls };
}

const H264_AAC = [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', codec_name: 'aac' }];

test('convertVideo commits the first attempt within the limit and removes the .part file', async () => {
  const dir = tempDir();
  try {
    const job = { absPath: join(dir, 'in.mov'), outPath: join(dir, 'out.mp4'), sizeLimit: 100 };
    const { exec, calls } = fakeExec({ probe: H264_AAC, sizes: [50] });
    const attempts = [];
    const result = await convertVideo(job, { tools: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, crf: 23, exec, onAttempt: (_job, attempt, index) => attempts.push([index, attempt.label]) });

    assert.deepEqual(result, { outSizeBytes: 50, withinLimit: true, strategy: 'remux (stream copy)', attempts: 1 });
    assert.deepEqual(attempts, [[0, 'remux (stream copy)']]);
    assert.deepEqual(calls.map((c) => c.tool), ['ffprobe', 'ffmpeg']);
    assert.equal(calls[1].args[calls[1].args.length - 1], `${job.outPath}.part`, 'encodes land on a .part file');
    assert.equal(existsSync(job.outPath), true);
    assert.equal(existsSync(`${job.outPath}.part`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('convertVideo climbs the ladder while the output misses the limit and keeps the smallest encode', async () => {
  const dir = tempDir();
  try {
    const job = { absPath: join(dir, 'in.mov'), outPath: join(dir, 'out.mp4'), sizeLimit: 100 };
    // remux 400, crf=23 300, crf=27 200, crf=31@720p 150: every rung is over.
    const { exec, calls } = fakeExec({ probe: H264_AAC, sizes: [400, 300, 200, 150] });
    const result = await convertVideo(job, { tools: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, crf: 23, exec });

    assert.deepEqual(result, { outSizeBytes: 150, withinLimit: false, strategy: 'transcode crf=31 width<=1280', attempts: 4 });
    assert.equal(calls.filter((c) => c.tool === 'ffmpeg').length, 4);
    assert.equal(existsSync(job.outPath), true, 'the smallest encode is kept for a human decision');
    assert.equal(existsSync(`${job.outPath}.part`), false);

    // A rung that fits stops the climb.
    const fits = fakeExec({ probe: H264_AAC, sizes: [400, 90] });
    const fitted = await convertVideo(job, { tools: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, crf: 23, exec: fits.exec });
    assert.deepEqual(fitted, { outSizeBytes: 90, withinLimit: true, strategy: 'transcode crf=23', attempts: 2 });

    // No limit means the first attempt always wins.
    const unlimited = fakeExec({ probe: H264_AAC, sizes: [400] });
    const free = await convertVideo({ ...job, sizeLimit: null }, { tools: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, crf: 23, exec: unlimited.exec });
    assert.equal(free.attempts, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('convertVideo leaves no .part behind when ffmpeg fails', async () => {
  const dir = tempDir();
  try {
    const job = { absPath: join(dir, 'in.mov'), outPath: join(dir, 'out.mp4'), sizeLimit: 100 };
    const exec = async (tool, args) => {
      if (tool === 'ffprobe') return { stdout: JSON.stringify({ streams: H264_AAC }) };
      writeFileSync(args[args.length - 1], Buffer.alloc(10));
      throw new Error('ffmpeg exited 1: boom');
    };
    await assert.rejects(convertVideo(job, { tools: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, crf: 23, exec }), /ffmpeg exited 1/);
    assert.equal(existsSync(`${job.outPath}.part`), false);
    assert.equal(existsSync(job.outPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -- LibreOffice --------------------------------------------------------------

test('sofficeArgs runs headless with a private profile and the pdf filter', () => {
  const args = sofficeArgs('/src/Exame.docx', '/work', '/work/profile');
  assert.equal(args[0], '--headless');
  assert.ok(args.some((arg) => arg.startsWith('-env:UserInstallation=file://')));
  assert.deepEqual(args.slice(-5), ['--convert-to', 'pdf', '--outdir', '/work', '/src/Exame.docx']);
});

test('convertDocument proves the conversion by the produced file, not the exit code', async () => {
  const dir = tempDir();
  try {
    const job = { absPath: join(dir, 'Exame.docx'), outPath: join(dir, 'out', 'Exame.pdf'), sizeLimit: 1000 };
    mkdirSync(join(dir, 'out'));

    const silent = async () => ({ stdout: '', stderr: '' });
    await assert.rejects(convertDocument(job, { tools: { soffice: 'soffice' }, exec: silent }), /produced no PDF/);
    assert.equal(existsSync(job.outPath), false);

    const writes = async (_tool, args) => {
      const outDir = args[args.indexOf('--outdir') + 1];
      writeFileSync(join(outDir, 'Exame.pdf'), Buffer.alloc(42));
      return { stdout: '', stderr: '' };
    };
    const result = await convertDocument(job, { tools: { soffice: 'soffice' }, exec: writes });
    assert.deepEqual(result, { outSizeBytes: 42, withinLimit: true, strategy: 'libreoffice --convert-to pdf', attempts: 1 });
    assert.equal(existsSync(job.outPath), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
