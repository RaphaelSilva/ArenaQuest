'use client';

import React from 'react';

type Props = {
  url: string;
  onInteraction?: () => void;
};

export default function VideoStage({ url, onInteraction }: Props) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[8px] border border-[var(--aq-border)] bg-[#0b0e17]">
      <video
        src={url}
        controls
        className="h-full w-full object-contain"
        onPlay={onInteraction}
        onTimeUpdate={onInteraction}
      />
    </div>
  );
}
