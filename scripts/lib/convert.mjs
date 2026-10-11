/**
 * scripts/lib/convert.mjs — the `.mov` remux/transcode ladder and the
 * LibreOffice document conversion shared by the operational scripts.
 *
 * Used by `scripts/media/convert-skipped.mjs` (the bulk rescue CLI) and by
 * `aq-mcp` (the local MCP server) so a `.mov` lands in the API as the same
 * `.mp4` whichever tool produced it: a lossless remux when the streams are
 * already H.264/AAC, a transcode to the web-safe baseline otherwise, then a
 * bounded size-fitting ladder.
 *
 * External binaries (`ffmpeg`/`ffprobe`, `soffice`) are DETECTED and REPORTED
 * with their install command — never installed behind the operator's back.
 *
 * stdlib only, ESM, zero dependencies; never imports from `scripts/content/`
 * or `scripts/media/`.
 */

import { spawn } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * External binaries, with the candidate names to look for on PATH and the
 * command that installs the missing one. Following the provisioning contract
 * used elsewhere in this repo, a missing dependency is DETECTED and REPORTED
 * with its fix — never installed behind the operator's back.
 */
export const TOOLS = {
  ffmpeg: {
    binaries: { ffmpeg: ['ffmpeg'], ffprobe: ['ffprobe'] },
    fix: 'sudo apt-get install -y ffmpeg',
  },
  soffice: {
    binaries: { soffice: ['soffice', 'libreoffice'] },
    fix: 'sudo apt-get install -y libreoffice-writer',
  },
};

/** Default H.264 quality. Lower is better and bigger; 23 is ffmpeg's own default. */
export const DEFAULT_CRF = 23;

/**
 * Escalation applied ONLY when an encode lands over the API's size limit:
 * a quality step, then a quality step plus a 720p cap. Bounded on purpose —
 * each rung is a full re-encode of the same file.
 */
const FIT_LADDER = [
  { crfDelta: 4, maxWidth: null },
  { crfDelta: 8, maxWidth: 1280 },
];

// -- external tools -----------------------------------------------------------

/** First candidate name that exists and is executable on PATH; null otherwise. */
export function findExecutable(candidates, { path = process.env.PATH ?? '', delimiter = ':', canExecute = defaultCanExecute } = {}) {
  for (const name of candidates) {
    for (const dir of path.split(delimiter)) {
      if (dir === '') continue;
      const candidate = join(dir, name);
      if (canExecute(candidate)) return candidate;
    }
  }
  return null;
}

function defaultCanExecute(absPath) {
  try {
    accessSync(absPath, fsConstants.X_OK);
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the binaries the planned jobs actually need. A tool nobody needs is
 * not required to be installed: a `--only mov` run must not demand LibreOffice.
 */
export function resolveTools(toolNames, { find = (candidates) => findExecutable(candidates) } = {}) {
  const resolved = {};
  const missing = [];
  for (const toolName of toolNames) {
    const spec = TOOLS[toolName];
    if (!spec) continue;
    for (const [role, candidates] of Object.entries(spec.binaries)) {
      const found = find(candidates);
      if (found) resolved[role] = found;
      else missing.push({ tool: toolName, role, candidates, fix: spec.fix });
    }
  }
  return { resolved, missing };
}

/** Spawn a command, capture its output, reject with the stderr tail on failure. */
export function run(command, args, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      // Keep the tail only: ffmpeg is happy to emit megabytes of progress.
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (err) => reject(new Error(`${basename(command)} could not be started: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${basename(command)} exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' / ') || 'no output'}`));
    });
  });
}

// -- ffmpeg -------------------------------------------------------------------

export function ffprobeArgs(input) {
  return ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', input];
}

/** Codec names per stream type, from `ffprobe`'s JSON. Absent stream -> null. */
export function parseProbe(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { video: null, audio: null };
  }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const find = (type) => streams.find((stream) => stream.codec_type === type)?.codec_name ?? null;
  return { video: find('video'), audio: find('audio') };
}

/**
 * A QuickTime container holding H.264 video and AAC audio is already a valid
 * MP4 payload: rewrapping it is lossless and takes a second, where a re-encode
 * would take minutes and throw away quality. `+faststart` moves the index to
 * the front so the browser can start playing before the file is complete.
 */
export function canRemux(probe) {
  return probe.video === 'h264' && (probe.audio === null || probe.audio === 'aac');
}

export function ffmpegRemuxArgs(input, output) {
  // `-f mp4` is not redundant: the container is normally inferred from the
  // output extension, and conversions land on a `.part` file ffmpeg cannot map
  // to any muxer.
  return ['-nostdin', '-y', '-loglevel', 'error', '-i', input, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', output];
}

/**
 * Transcode to the web-safe baseline the API's players expect: H.264 in
 * `yuv420p` (10-bit or 4:2:2 sources otherwise decode to a black frame in
 * Safari) plus AAC audio.
 */
export function ffmpegTranscodeArgs(input, output, { crf = DEFAULT_CRF, maxWidth = null } = {}) {
  const args = ['-nostdin', '-y', '-loglevel', 'error', '-i', input];
  if (maxWidth) {
    // Even dimensions are required by yuv420p; -2 keeps the aspect ratio and
    // rounds to the nearest even height. `min()` never upscales a small source.
    args.push('-vf', `scale='min(${maxWidth},iw)':-2`);
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-f', 'mp4',
    output,
  );
  return args;
}

/**
 * The ordered attempts for one video: the cheap rewrap first when the streams
 * allow it, then a straight transcode, then the size-fitting ladder. Later
 * rungs only ever run if the previous output missed the API's limit.
 */
export function videoAttempts({ input, output, probe, crf = DEFAULT_CRF }) {
  const attempts = [];
  if (canRemux(probe)) attempts.push({ label: 'remux (stream copy)', args: ffmpegRemuxArgs(input, output) });
  attempts.push({ label: `transcode crf=${crf}`, args: ffmpegTranscodeArgs(input, output, { crf }) });
  for (const rung of FIT_LADDER) {
    const rungCrf = crf + rung.crfDelta;
    attempts.push({
      label: `transcode crf=${rungCrf}${rung.maxWidth ? ` width<=${rung.maxWidth}` : ''}`,
      args: ffmpegTranscodeArgs(input, output, { crf: rungCrf, maxWidth: rung.maxWidth }),
    });
  }
  return attempts;
}

// -- LibreOffice --------------------------------------------------------------

/**
 * Headless conversion into `outDir`.
 *
 * `-env:UserInstallation` is not optional here: LibreOffice serialises every
 * invocation that shares a user profile, so two concurrent jobs on the default
 * profile would have one of them silently exit without writing a PDF. A private
 * profile per job is what makes `--concurrency` real for documents.
 */
export function sofficeArgs(input, outDir, profileDir) {
  return [
    '--headless',
    '--norestore',
    '--nolockcheck',
    '--nodefault',
    `-env:UserInstallation=${pathToFileURL(resolvePath(profileDir)).href}`,
    '--convert-to', 'pdf',
    '--outdir', outDir,
    input,
  ];
}

// -- conversion ---------------------------------------------------------------

/**
 * Convert one video. Each attempt writes to a `.part` file; the first output
 * within the API's limit is committed. If even the last rung is over, the
 * smallest result is still kept and flagged `withinLimit: false` — a file that
 * needs a human decision is more useful on disk than deleted.
 */
export async function convertVideo(job, { tools, crf, exec = run, onAttempt = null }) {
  const part = `${job.outPath}.part`;
  try {
    const probe = parseProbe((await exec(tools.ffprobe, ffprobeArgs(job.absPath))).stdout);
    const attempts = videoAttempts({ input: job.absPath, output: part, probe, crf });

    let best = null;
    for (const [index, attempt] of attempts.entries()) {
      if (onAttempt) onAttempt(job, attempt, index);
      await exec(tools.ffmpeg, attempt.args);
      const size = statSync(part).size;
      if (!best || size < best.size) best = { size, label: attempt.label };
      if (job.sizeLimit === null || size <= job.sizeLimit) {
        renameSync(part, job.outPath);
        return { outSizeBytes: size, withinLimit: true, strategy: attempt.label, attempts: index + 1 };
      }
      // Over the limit: the next rung overwrites the same `.part`, and the loop
      // ends holding the smallest encode it managed.
    }

    renameSync(part, job.outPath);
    return { outSizeBytes: statSync(job.outPath).size, withinLimit: false, strategy: best.label, attempts: attempts.length };
  } finally {
    // A failed encode must not leave half a video behind: on a 200-file batch
    // those orphans are gigabytes, and one of them could later be mistaken for
    // a real output.
    rmSync(part, { force: true });
  }
}

/**
 * Convert one document. LibreOffice names its output after the input and will
 * not be told otherwise, so it runs into a private temp directory and the
 * result is copied to the real target — which also keeps a failed run from
 * leaving a partial PDF in the output tree.
 */
export async function convertDocument(job, { tools, exec = run, onAttempt = null }) {
  const workDir = mkdtempSync(join(tmpdir(), 'aq-convert-'));
  try {
    const attempt = { label: 'libreoffice --convert-to pdf', args: sofficeArgs(job.absPath, workDir, join(workDir, 'profile')) };
    if (onAttempt) onAttempt(job, attempt, 0);
    await exec(tools.soffice, attempt.args);

    const produced = join(workDir, `${basename(job.absPath, extname(job.absPath))}.pdf`);
    // LibreOffice reports success even when it converts nothing, so the file's
    // existence — not the exit code — is what proves the conversion happened.
    if (!existsSync(produced)) {
      throw new Error('LibreOffice exited cleanly but produced no PDF (the document may be password-protected or corrupt)');
    }

    // copy+unlink, not rename: the temp dir and the output tree are routinely
    // on different filesystems, where rename() fails with EXDEV.
    copyFileSync(produced, job.outPath);
    const size = statSync(job.outPath).size;
    return {
      outSizeBytes: size,
      withinLimit: job.sizeLimit === null || size <= job.sizeLimit,
      strategy: attempt.label,
      attempts: 1,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
