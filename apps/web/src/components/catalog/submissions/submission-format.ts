import {
  SUBMISSION_MEDIA_TYPES,
  isSubmissionMediaType,
  isSubmissionVideoType,
  mediaSizeLimitFor,
  type SubmissionMediaType,
} from '@arenaquest/shared/domain/media/limits';
import type { Dictionary } from '@web/i18n/types';
import type { SubmissionSummary } from '@web/lib/submissions-api';

/**
 * The file input's `accept` list: every submission type plus the `.mov`
 * extension, so an iPhone offers the camera or the library and a desktop
 * browser that reports no type for a `.mov` still lists it.
 */
export const SUBMISSION_ACCEPT = [...SUBMISSION_MEDIA_TYPES, '.mov'].join(',');

/** Extension fallback for browsers that report an empty `File.type` (common for `.mov`). */
const TYPE_BY_EXTENSION: Record<string, SubmissionMediaType> = {
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** The submission content type of a picked file, or `null` when it is not accepted. */
export function resolveSubmissionType(file: Pick<File, 'name' | 'type'>): SubmissionMediaType | null {
  if (file.type && isSubmissionMediaType(file.type)) return file.type;
  const dot = file.name.lastIndexOf('.');
  if (dot < 0) return null;
  return TYPE_BY_EXTENSION[file.name.slice(dot + 1).toLowerCase()] ?? null;
}

export type SubmissionKind = 'video' | 'image' | 'pdf';

export function submissionKind(contentType: string): SubmissionKind {
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('image/')) return 'image';
  return 'pdf';
}

/** The per-file ceiling for a type: the env-configured video limit, or the shared media table. */
export function submissionSizeLimit(contentType: SubmissionMediaType, summary: SubmissionSummary): number | null {
  return isSubmissionVideoType(contentType) ? summary.limits.videoMaxBytes : mediaSizeLimitFor(contentType);
}

/**
 * Binary units, one decimal at most, through the dictionary so each language
 * writes its own decimal separator (i18n-spec section 3.5: no `Intl.*`).
 */
export function formatBytes(dict: Dictionary, bytes: number): string {
  const units = [dict.submissions.size.kb, dict.submissions.size.mb, dict.submissions.size.gb];
  if (bytes < 1024) return dict.submissions.size.bytes(Math.max(0, bytes));
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return units[unit](Math.round(value * 10) / 10);
}

/** The title a picked file suggests: its name without the extension. */
export function titleFromFileName(name: string, max: number): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).trim();
  return base.slice(0, max);
}

export type PreflightResult =
  | { ok: true; contentType: SubmissionMediaType }
  | { ok: false; message: string };

/**
 * Checks a picked file against the topic summary before any request: type,
 * per-type size, the topic slot count and the remaining storage. Every limit
 * comes from the API's summary or the shared media table.
 */
export function preflightSubmission(dict: Dictionary, file: File, summary: SubmissionSummary): PreflightResult {
  const t = dict.submissions.preflight;
  const contentType = resolveSubmissionType(file);
  if (!contentType) return { ok: false, message: t.unsupportedType };
  if (file.size <= 0) return { ok: false, message: t.empty };

  const max = submissionSizeLimit(contentType, summary);
  if (max === null) return { ok: false, message: t.unsupportedType };
  if (file.size > max) return { ok: false, message: t.tooLarge(formatBytes(dict, max)) };

  const { perTopicMax, storagePerStudentBytes } = summary.limits;
  if (summary.usage.topicCount >= perTopicMax) return { ok: false, message: t.topicFull(perTopicMax) };

  const remaining = Math.max(0, storagePerStudentBytes - summary.usage.bytes);
  if (file.size > remaining) {
    return {
      ok: false,
      message: t.storageFull(formatBytes(dict, remaining), formatBytes(dict, storagePerStudentBytes)),
    };
  }
  return { ok: true, contentType };
}
