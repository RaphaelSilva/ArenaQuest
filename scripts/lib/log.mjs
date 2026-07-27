/**
 * scripts/lib/log.mjs
 *
 * JS logging helpers for the ArenaQuest Node operational scripts — the
 * counterpart to `scripts/lib/log.sh`, sharing the same icon vocabulary so
 * `make doctor`, `label check` and the deploy CLI all read alike:
 *   →  info   ·  ✔  ok   ·  ⚠  warn/skip   ·  ✖  fail/hard gap
 *
 * stdlib only (uses the `process` global). Colours are emitted only when the
 * relevant stream is a TTY, so piped/CI output stays clean.
 */

const isTTY = Boolean(process.stderr.isTTY || process.stdout.isTTY);

const C = {
  cyan: '\x1b[0;36m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  red: '\x1b[0;31m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

function paint(color, text) {
  return isTTY ? `${color}${text}${C.reset}` : text;
}

/** Informational step (stdout). */
export function info(msg) {
  console.log(paint(C.cyan, `  →  ${msg}`));
}

/** Success (stdout). */
export function ok(msg) {
  console.log(paint(C.green, `  ✔  ${msg}`));
}

/** Soft gap / skipped (stdout). */
export function warn(msg) {
  console.log(paint(C.yellow, `  ⚠  ${msg}`));
}

/** Hard gap (stderr). */
export function fail(msg) {
  console.error(paint(C.red, `  ✖  ${msg}`));
}

/** Secondary hint under a line (stdout). */
export function hint(msg) {
  console.log(paint(C.dim, `      → ${msg}`));
}

/** Section heading (stdout). */
export function heading(msg) {
  console.log('');
  console.log(paint(C.bold, `  ${msg}`));
  console.log('');
}

/** A command line to be run (or previewed under --dry-run). */
export function cmd(line) {
  console.log(paint(C.dim, `      $ ${line}`));
}

/**
 * Fatal: print to stderr and exit non-zero. Never returns. Used by the
 * side-effecting entrypoints, not by the pure core.
 */
export function die(msg, code = 1) {
  console.error(paint(C.red, `  ✖  ${msg}`));
  process.exit(code);
}

export default { info, ok, warn, fail, hint, heading, cmd, die };
