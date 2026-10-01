import { SUBMISSION_DESCRIPTION_MAX, SUBMISSION_TITLE_MAX } from '@arenaquest/shared/domain/submissions/limits';
import type { Dictionary } from '@web/i18n/types';
import { SubmissionsApiError } from '@web/lib/submissions-api';
import { formatBytes } from './submission-format';

/** Maps any error from the submissions API onto a translated, user-facing message. */
export function submissionErrorMessage(dict: Dictionary, error: unknown): string {
  const t = dict.submissions.errors;
  if (!(error instanceof SubmissionsApiError)) return t.generic;
  const { meta } = error;

  switch (error.code) {
    case 'Quota':
      if (meta.reason === 'storage' && meta.limit !== undefined) return t.quotaStorage(formatBytes(dict, meta.limit));
      if (meta.limit !== undefined) return t.quotaCount(meta.limit);
      return t.generic;
    case 'Moderated':
      return t.moderated;
    case 'SharingDisabled':
      return t.sharingDisabled;
    case 'Removed':
      return t.removed;
    case 'FileTooLarge':
      return meta.maxBytes !== undefined ? t.fileTooLarge(formatBytes(dict, meta.maxBytes)) : t.fileTooLargeGeneric;
    case 'UploadMismatch':
      return t.uploadMismatch;
    case 'NotUploaded':
      return t.notUploaded;
    case 'RateLimited':
      return t.rateLimited(Math.max(1, Math.ceil((meta.retryAfterSeconds ?? 60) / 60)));
    case 'TitleInvalid':
      return t.titleInvalid(SUBMISSION_TITLE_MAX);
    case 'DescriptionTooLong':
      return t.descriptionTooLong(SUBMISSION_DESCRIPTION_MAX);
    case 'UnsupportedMediaType':
      return t.unsupportedType;
    case 'StorageUnavailable':
      return t.storageUnavailable;
    case 'NetworkError':
      return t.network;
    case 'NotFound':
      return t.notFound;
    default:
      return t.generic;
  }
}
