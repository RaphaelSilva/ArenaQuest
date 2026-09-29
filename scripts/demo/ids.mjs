/**
 * ids.mjs — deterministic identities for the demo seed (RFC 0021 §3.1).
 *
 * Every demo row gets a UUIDv5 derived from one committed namespace and a name
 * of the form
 *
 *     <label>:<entity>:<key>          e.g.  budo:topic:root-2/module-1/lesson-2
 *
 * so the same label/entity/key yields the same id on every run (the seed can
 * `INSERT … ON CONFLICT(id) DO UPDATE` and converge), two labels never share an
 * id, and every id is a real RFC 4122 UUID the API's `uuid()` route params
 * accept.
 *
 * Entities in use (the `entity` segment): `user`, `group`, `topic`, `tag`,
 * `media`, `enrollment`, `mission`. Keys are the stable identifiers of
 * `scripts/demo/dataset/base.json` (`student-1`, `root-1/module-2`, …); a media
 * row's key is {@link demoMediaKey}.
 *
 * The e-mail rule lives here too, because the production guard (Task 07) needs
 * both halves: `demo.<userKey>@<label>.demo.invalid`. `.invalid` is reserved
 * (RFC 2606), so a demo account can never receive mail.
 *
 * Pure except for {@link demoUserIds}' default (reads `base.json`) and
 * {@link listLabels} (reads `config/labels/`). Stdlib only.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/demo/..)

/**
 * The demo namespace. Generated once (2026-09-29) and committed.
 *
 * NEVER CHANGE IT: every demo id in every staging database is derived from it,
 * and the production guard matches on those ids. A new value would orphan the
 * existing demo rows and blind the guard to them.
 */
export const DEMO_NAMESPACE = 'c3ad3071-4fc4-4d1f-aa84-8b6f71f9b0e1';

/** Every demo e-mail ends with `@<label>` + this suffix. */
export const DEMO_EMAIL_DOMAIN_SUFFIX = '.demo.invalid';

/** A lowercase RFC 4122 UUID of version 5 (name-based, SHA-1). */
export const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const LABEL_PATTERN = /^[a-z][a-z0-9-]*$/;
const ENTITY_PATTERN = /^[a-z][a-z-]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RFC 4122 §4.3 UUIDv5 of `name` inside `namespace`.
 *
 * SHA-1 over the 16 namespace bytes followed by the UTF-8 name; the first 16
 * bytes of the digest, with the version nibble set to 5 and the variant to 10xx.
 */
export function uuidV5(namespace, name) {
  if (typeof namespace !== 'string' || !UUID_PATTERN.test(namespace)) {
    throw new TypeError(`uuidV5: namespace is not a UUID: ${namespace}`);
  }
  if (typeof name !== 'string') throw new TypeError('uuidV5: name must be a string');

  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const bytes = createHash('sha1').update(nsBytes).update(name, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertLabel(label) {
  if (typeof label !== 'string' || !LABEL_PATTERN.test(label)) {
    throw new TypeError(`invalid label "${label}" (expected ${LABEL_PATTERN})`);
  }
}

/**
 * The UUIDv5 name of a demo entity: `<label>:<entity>:<key>`.
 *
 * `label` and `entity` may not contain `:` (their patterns forbid it), so the
 * name is unambiguous even when `key` does.
 */
export function demoName(label, entity, key) {
  assertLabel(label);
  if (typeof entity !== 'string' || !ENTITY_PATTERN.test(entity)) {
    throw new TypeError(`invalid entity "${entity}" (expected ${ENTITY_PATTERN})`);
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError(`invalid key for ${label}:${entity} (expected a non-empty string)`);
  }
  return `${label}:${entity}:${key}`;
}

/** The deterministic id of a demo entity. */
export function demoId(label, entity, key) {
  return uuidV5(DEMO_NAMESPACE, demoName(label, entity, key));
}

/**
 * The key of the media row that attaches manifest file `manifestKey` to topic
 * `topicKey` — a media row belongs to exactly one topic, so the same file on
 * two topics is two rows. Pass it to `demoId(label, 'media', …)`.
 */
export function demoMediaKey(topicKey, manifestKey) {
  return `${topicKey}@${manifestKey}`;
}

/** `demo.<userKey>@<label>.demo.invalid` */
export function demoEmail(label, userKey) {
  assertLabel(label);
  if (typeof userKey !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(userKey)) {
    throw new TypeError(`invalid demo user key "${userKey}"`);
  }
  return `demo.${userKey}@${label}${DEMO_EMAIL_DOMAIN_SUFFIX}`;
}

/** True for any address in a `@<something>.demo.invalid` domain, case-insensitively. */
export function isDemoEmail(email) {
  if (typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domain.endsWith(DEMO_EMAIL_DOMAIN_SUFFIX) && domain.length > DEMO_EMAIL_DOMAIN_SUFFIX.length;
}

/** The user keys of the baseline dataset (`base.json`), in file order. */
export function baseUserKeys() {
  const base = JSON.parse(readFileSync(join(HERE, 'dataset', 'base.json'), 'utf8'));
  return base.users.map((user) => user.key);
}

/**
 * The ids of every demo user of `label`.
 *
 * A label override may rename users but never add one (see `dataset.mjs`), so
 * the baseline keys are the complete list for any label.
 */
export function demoUserIds(label, userKeys = baseUserKeys()) {
  return userKeys.map((key) => demoId(label, 'user', key));
}

/** Label names, from `config/labels/*.jsonc`, sorted. */
export function listLabels(repoRoot = ROOT) {
  return readdirSync(join(repoRoot, 'config', 'labels'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonc'))
    .map((entry) => entry.name.slice(0, -'.jsonc'.length))
    .sort();
}
