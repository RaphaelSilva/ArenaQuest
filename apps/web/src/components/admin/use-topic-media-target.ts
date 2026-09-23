'use client';

import { useMemo } from 'react';
import { MEDIA_SIZE_LIMIT_BYTES } from '@arenaquest/shared/domain/media/limits';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { MediaUploadTarget } from './media-upload-target';

/**
 * The topic-media implementation of {@link MediaUploadTarget}.
 *
 * This is the behaviour `MediaUploader` used to hold inline: the same three
 * calls, the same declared `file.size`, the same 100 MB courtesy check (the
 * ceiling of the largest type the topic uploader accepts, `video/mp4`), and the
 * same copy. Lifting it out is what lets event flyers reuse the component
 * instead of forking it.
 */
export function useTopicMediaTarget(topicId: string): MediaUploadTarget {
  const client = useApiClient();
  const dict = useDict();
  const labels = dict.admin.topics.media.uploader;

  return useMemo<MediaUploadTarget>(
    () => ({
      maxBytes: MEDIA_SIZE_LIMIT_BYTES['video/mp4'],
      multiple: true,
      labels: {
        dropzoneTitle: labels.dropzoneTitle,
        dropzoneHint: labels.dropzoneHint,
        fileTooBig: labels.fileTooBig,
      },
      async presign(input) {
        const { uploadUrl, media } = await client.adminMedia.getPresignedUrl(topicId, input);
        return { uploadUrl, handle: media.id };
      },
      async finalize(handle) {
        await client.adminMedia.finalize(topicId, handle);
      },
    }),
    [client, topicId, labels],
  );
}
