'use client';

import type { Media } from '@web/lib/admin-media-api';
import { PdfViewer } from './MediaViewers/PdfViewer';
import { VideoPlayer } from './MediaViewers/VideoPlayer';
import { ImageGallery } from './MediaViewers/ImageGallery';

type MediaViewerProps = {
  media: Media;
};

export function MediaViewer({ media }: MediaViewerProps) {
  // We only show 'ready' media, which should be guaranteed by the API, but check anyway.
  if (media.status !== 'ready') return null;

  const mimeType = media.type || '';

  if (mimeType === 'application/pdf') {
    return <PdfViewer url={media.url} title={media.originalName} />;
  }

  if (mimeType.startsWith('video/')) {
    return <VideoPlayer url={media.url} title={media.originalName} mimeType={mimeType} />;
  }

  if (mimeType.startsWith('image/')) {
    return <ImageGallery url={media.url} title={media.originalName} />;
  }

  // Fallback for unknown media types
  return (
    <div className="flex flex-col space-y-4">
      <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{media.originalName}</h3>
      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="flex items-center gap-4">
          <svg className="h-8 w-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Unknown file type</p>
            <p className="text-xs text-zinc-500">{media.sizeBytes} bytes</p>
          </div>
        </div>
        <a
          href={media.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20"
        >
          Download
        </a>
      </div>
    </div>
  );
}
