'use client';

import { useRef } from 'react';

type VideoPlayerProps = {
  src: string;
  title: string;
};

export function VideoPlayer({ src, title }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="w-full overflow-hidden rounded-[8px] bg-black">
      <video
        ref={videoRef}
        src={src}
        title={title}
        controls
        className="w-full"
        style={{ maxHeight: '500px', display: 'block' }}
      />
    </div>
  );
}
