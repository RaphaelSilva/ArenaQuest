'use client';

import { useMemo } from 'react';
import {
  IMAGE_MEDIA_TYPES,
  MEDIA_SIZE_LIMIT_BYTES,
} from '@arenaquest/shared/domain/media/limits';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { MediaUploadTarget } from '@web/components/admin/media-upload-target';
import { AdminEventsApiError } from '@web/lib/admin-events-api';

/** The flyer ceiling, read from the shared table rather than re-declared. */
export const FLYER_MAX_BYTES = MEDIA_SIZE_LIMIT_BYTES['image/jpeg'];

/** `accept` for the file input — a flyer is an image and nothing else. */
const FLYER_ACCEPT = IMAGE_MEDIA_TYPES.join(',');

/**
 * The event-flyer implementation of `MediaUploadTarget`.
 *
 * Same component, same three steps, different endpoints — see
 * `components/admin/media-upload-target.ts`. `handle` is the empty string
 * because an event owns exactly one flyer and finalize needs no second id.
 *
 * `multiple` is false: a second file would race the first for the one flyer
 * slot, and the loser's bytes would sit in the bucket unreferenced.
 */
export function useEventFlyerTarget(eventId: string): MediaUploadTarget {
  const client = useApiClient();
  const dict = useDict();
  const labels = dict.admin.events.flyer;

  return useMemo<MediaUploadTarget>(
    () => ({
      maxBytes: FLYER_MAX_BYTES,
      multiple: false,
      accept: FLYER_ACCEPT,
      labels: {
        dropzoneTitle: labels.dropzoneTitle,
        dropzoneHint: labels.dropzoneHint,
        fileTooBig: labels.fileTooBig,
      },
      async presign(input) {
        try {
          const result = await client.adminEvents.presignFlyer(eventId, input);
          return { uploadUrl: result.uploadUrl, handle: '' };
        } catch (error) {
          throw translateFlyerError(error, labels);
        }
      },
      async finalize() {
        try {
          await client.adminEvents.finalizeFlyer(eventId);
        } catch (error) {
          throw translateFlyerError(error, labels);
        }
      },
    }),
    [client, eventId, labels],
  );
}

/**
 * Turn the API's error code into the sentence this build speaks.
 *
 * Both rejections have to read clearly, and they arrive at different moments:
 * `presign` refuses before a byte moves, `finalize` refuses *after* the upload
 * completed — which is exactly the case that would otherwise look like a silent
 * failure, since the progress bar already reached 100%.
 */
function translateFlyerError(
  error: unknown,
  labels: ReturnType<typeof useDict>['admin']['events']['flyer'],
): Error {
  if (!(error instanceof AdminEventsApiError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  switch (error.code) {
    case 'FileTooLarge':
      return new Error(
        labels.errorTooLarge(Math.round((error.maxBytes ?? FLYER_MAX_BYTES) / (1024 * 1024))),
      );
    case 'UnsupportedMediaType':
      return new Error(labels.errorUnsupported);
    case 'NotUploaded':
    case 'NoPendingFlyer':
      return new Error(labels.errorNotUploaded);
    default:
      return error;
  }
}
