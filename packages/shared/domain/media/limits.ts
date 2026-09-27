/**
 * Media limits — the allowed upload types and their per-type byte ceilings.
 *
 * Pure: no I/O, no environment read, no framework import, no provider type. The
 * table is callable from the Worker, from the web build and from a plain Node
 * script alike.
 *
 * This module exists because the table was duplicated. It was a literal in
 * `apps/api/src/controllers/admin-media.controller.ts` — which `CLAUDE.md`
 * already called "the source of truth" — and a second copy inside
 * `scripts/content/import-media.mjs`'s `validateMediaFile`. A third copy, for
 * event flyers, would have settled the matter the wrong way (RFC 0014 section 3).
 *
 * The numbers are carried over verbatim: changing one is a regression in the
 * topic uploader and the bulk importer at once.
 */

/**
 * Every content type the upload lifecycle accepts.
 *
 * Declared `as const` because `PresignSchema`'s `z.enum(...)` needs a readonly
 * tuple of literals to narrow `contentType` — a plain `string[]` would widen the
 * route contract.
 */
export const ALLOWED_MEDIA_TYPES = [
  'application/pdf',
  'video/mp4',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** One of the content types the upload lifecycle accepts. */
export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

/**
 * The image subset of {@link ALLOWED_MEDIA_TYPES}.
 *
 * An event flyer is an image and nothing else (RFC 0014 section 3); it reuses
 * the image ceiling below rather than inventing a second one.
 */
export const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** An image content type — the flyer subset of {@link AllowedMediaType}. */
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * Maximum stored size, in bytes, for each allowed content type.
 *
 * Written as explicit `n * 1024 * 1024` products, exactly as both former copies
 * spelled them: the importer's parity test reads this literal out of the source
 * (it runs without a build step and cannot import the compiled module), so the
 * shape is load-bearing.
 */
export const MEDIA_SIZE_LIMIT_BYTES: Readonly<Record<AllowedMediaType, number>> = {
  'application/pdf': 25 * 1024 * 1024, // 25 MB
  'video/mp4': 100 * 1024 * 1024, // 100 MB
  'image/jpeg': 5 * 1024 * 1024, // 5 MB
  'image/png': 5 * 1024 * 1024, // 5 MB
  'image/webp': 5 * 1024 * 1024, // 5 MB
};

/** Narrows an arbitrary string to an accepted content type. */
export function isAllowedMediaType(contentType: string): contentType is AllowedMediaType {
  return (ALLOWED_MEDIA_TYPES as readonly string[]).includes(contentType);
}

/** Narrows an arbitrary string to an accepted image content type. */
export function isImageMediaType(contentType: string): contentType is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(contentType);
}

/**
 * The ceiling for `contentType`, or `null` when the type is not accepted at all.
 *
 * `null` rather than a fallback number: an unknown type has no ceiling to
 * compare against, and defaulting one would silently admit it.
 */
export function mediaSizeLimitFor(contentType: string): number | null {
  return isAllowedMediaType(contentType) ? MEDIA_SIZE_LIMIT_BYTES[contentType] : null;
}
