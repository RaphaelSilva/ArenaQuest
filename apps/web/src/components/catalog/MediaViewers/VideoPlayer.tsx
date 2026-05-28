'use client';

import { useDict } from '@web/context/dict-context';

type VideoPlayerProps = {
  url: string;
  title: string;
  mimeType: string;
};

export function VideoPlayer({ url, title, mimeType }: VideoPlayerProps) {
  const dict = useDict();

  return (
    <div className="flex flex-col space-y-4">
      <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{title}</h3>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-200 bg-black shadow-sm dark:border-zinc-800">
        <video
          controls
          controlsList="nodownload"
          className="h-full w-full object-contain"
          preload="metadata"
        >
          <source src={url} type={mimeType} />
          {dict.catalog.videoPlayer.noSupport}
        </video>
      </div>
    </div>
  );
}
