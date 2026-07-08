'use client';

import { useRef, useState } from 'react';
import type { Media } from '@web/lib/admin-media-api';
import { useDict } from '@web/context/dict-context';
import { useApiClient } from '@web/context/auth-context';

type Props = {
  videos: Media[];
  topicId: string;
  onWatched?: (mediaId: string) => void;
};

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5 3L13 8L5 13V3Z" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function VideoPlayerWithPlaylist({ videos, topicId, onWatched }: Props) {
  const dict = useDict();
  const client = useApiClient();
  const [activeId, setActiveId] = useState(videos[0]?.id ?? '');
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);

  const activeVideo = videos.find((v) => v.id === activeId) ?? videos[0];

  async function markWatched(mediaId: string) {
    if (watchedIds.has(mediaId)) return;
    setWatchedIds((prev) => new Set(prev).add(mediaId));
    onWatched?.(mediaId);
    await client.topics.markVideoWatched(topicId, mediaId);
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || !activeVideo) return;
    if (video.duration > 0 && video.currentTime / video.duration >= 0.9) {
      void markWatched(activeVideo.id);
    }
  }

  function handleEnded() {
    if (activeVideo) void markWatched(activeVideo.id);
  }

  function selectVideo(id: string) {
    setActiveId(id);
    setTimeout(() => videoRef.current?.load(), 0);
  }

  if (videos.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--aq-text3)' }}>
        {dict.catalog.videoPlaylist.noVideos}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Video player */}
      <div
        className="relative aspect-video w-full overflow-hidden rounded-[14px]"
        style={{ background: '#000' }}
      >
        <video
          ref={videoRef}
          key={activeVideo?.id}
          controls
          controlsList="nodownload"
          className="h-full w-full object-contain"
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        >
          {activeVideo && <source src={activeVideo.url} type={activeVideo.type} />}
          {dict.catalog.videoPlaylist.noSupport}
        </video>
      </div>

      {/* Playlist */}
      {videos.length > 1 && (
        <div
          className="overflow-hidden rounded-[12px]"
          style={{ border: '1px solid var(--aq-border)', background: 'var(--aq-bg2)' }}
        >
          {videos.map((v, i) => {
            const isActive = v.id === activeId;
            const isWatched = watchedIds.has(v.id);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => selectVideo(v.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
                style={{
                  background: isActive ? 'var(--aq-accent-glow)' : undefined,
                  borderTop: i > 0 ? '1px solid var(--aq-border)' : undefined,
                }}
              >
                {/* Thumbnail area */}
                <div
                  className="flex h-10 w-16 flex-shrink-0 items-center justify-center rounded-[8px]"
                  style={{ background: isActive ? 'var(--aq-accent)' : 'var(--aq-bg3)' }}
                >
                  <span style={{ color: isActive ? '#0B0E17' : 'var(--aq-text3)' }}>
                    <PlayIcon />
                  </span>
                </div>
                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[13px] font-medium"
                    style={{ color: isActive ? 'var(--aq-accent)' : 'var(--aq-text)' }}
                  >
                    {i + 1}. {v.originalName}
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
                    {(v.sizeBytes / 1_000_000).toFixed(1)} MB
                  </p>
                </div>
                {/* Watched indicator */}
                {isWatched && (
                  <span
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'var(--aq-accent3)', color: 'white' }}
                  >
                    <CheckIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
