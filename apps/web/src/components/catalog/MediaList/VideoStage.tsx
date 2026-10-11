'use client';

import React, { useEffect, useRef } from 'react';

/** Fraction of the duration after which a video counts as watched. */
const WATCHED_THRESHOLD = 0.9;

type Props = {
  url: string;
  onInteraction?: () => void;
  /**
   * Fired at most once per mounted video (per `url`), when playback crosses
   * 90 % of the duration or the video ends — whichever comes first. A replay
   * never fires it again. Fire-and-forget: errors thrown by the handler are
   * swallowed so reporting can never interrupt playback.
   */
  onWatched?: () => void;
};

export default function VideoStage({ url, onInteraction, onWatched }: Props) {
  const reportedRef = useRef(false);

  // A new source is a new video: it may be reported once again.
  useEffect(() => {
    reportedRef.current = false;
  }, [url]);

  const reportWatched = () => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    try {
      onWatched?.();
    } catch {
      // Non-blocking report — never let it break the player.
    }
  };

  const handleTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    onInteraction?.();
    const { currentTime, duration } = event.currentTarget;
    if (Number.isFinite(duration) && duration > 0 && currentTime / duration >= WATCHED_THRESHOLD) {
      reportWatched();
    }
  };

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[8px] border border-[var(--aq-border)] bg-[#0b0e17]">
      <video
        src={url}
        controls
        className="h-full w-full object-contain"
        onPlay={onInteraction}
        onTimeUpdate={handleTimeUpdate}
        onEnded={reportWatched}
      />
    </div>
  );
}
