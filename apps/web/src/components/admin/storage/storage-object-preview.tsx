'use client';

import { useDict } from '@web/context/dict-context';
import type { StorageObjectDetail } from '@web/lib/admin-storage-api';

/**
 * Inline preview chosen by content type. The source is always the presigned
 * `downloadUrl` the API returned — nothing is fetched by key from the browser.
 */
export function StorageObjectPreview({ detail }: { detail: StorageObjectDetail }) {
  const d = useDict().adminStorage.drawer;
  const contentType = previewType(detail);

  if (contentType.startsWith('image/')) {
    // eslint-disable-next-line @next/next/no-img-element -- presigned, short-lived URL; next/image would proxy it
    return <img src={detail.downloadUrl} alt={detail.name} className="max-h-80 w-auto rounded-md border border-zinc-200 dark:border-zinc-800" />;
  }

  if (contentType === 'application/pdf') {
    return (
      <iframe
        src={detail.downloadUrl}
        title={d.previewFrameTitle(detail.name)}
        className="h-96 w-full rounded-md border border-zinc-200 dark:border-zinc-800"
      />
    );
  }

  if (contentType.startsWith('video/')) {
    return (
      <video
        src={detail.downloadUrl}
        controls
        tabIndex={0}
        preload="metadata"
        aria-label={d.previewFrameTitle(detail.name)}
        className="max-h-80 w-full rounded-md bg-black"
      />
    );
  }

  return <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.noPreview}</p>;
}

/** The object's own content type, else the one recorded on its media row. */
function previewType(detail: StorageObjectDetail): string {
  if (detail.contentType) return detail.contentType.toLowerCase();
  const media = detail.references.find((reference) => reference.kind === 'media');
  return media && media.kind === 'media' ? media.type.toLowerCase() : '';
}
