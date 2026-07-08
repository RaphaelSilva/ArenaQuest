'use client';

import { useState } from 'react';
import type { Media } from '@web/lib/admin-media-api';
import { VideoPlayerWithPlaylist } from './VideoPlayerWithPlaylist';
import { FilesGrid } from './FilesGrid';
import { PhotosGrid } from './PhotosGrid';
import { useDict } from '@web/context/dict-context';

type Props = {
  videos: Media[];
  files: Media[];
  photos: Media[];
  topicId: string;
  onVideoWatched?: (mediaId: string) => void;
};

type Tab = 'videos' | 'files' | 'photos';

export function MediaTabs({ videos, files, photos, topicId, onVideoWatched }: Props) {
  const dict = useDict();
  const tabs: Tab[] = ['videos', 'files', 'photos'];
  const counts: Record<Tab, number> = { videos: videos.length, files: files.length, photos: photos.length };
  const firstNonEmpty: Tab = tabs.find((t) => counts[t] > 0) ?? 'videos';
  const [activeTab, setActiveTab] = useState<Tab>(firstNonEmpty);

  const tabLabels: Record<Tab, string> = {
    videos: dict.catalog.mediaTabs.videos,
    files: dict.catalog.mediaTabs.files,
    photos: dict.catalog.mediaTabs.photos,
  };

  return (
    <div>
      {/* Tab bar */}
      <div
        className="mb-5 flex gap-1"
        role="tablist"
        aria-label={dict.catalog.mediaTabs.ariaLabel}
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`tabpanel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className="flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[13px] font-medium transition-all"
            style={
              activeTab === tab
                ? { background: 'var(--aq-accent)', color: '#0B0E17' }
                : { background: 'var(--aq-bg3)', color: 'var(--aq-text2)' }
            }
          >
            {tabLabels[tab]}
            <span
              className="rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold"
              style={
                activeTab === tab
                  ? { background: 'rgba(0,0,0,0.2)', color: '#0B0E17' }
                  : { background: 'var(--aq-bg4)', color: 'var(--aq-text3)' }
              }
            >
              {counts[tab]}
            </span>
          </button>
        ))}
      </div>

      {/* Tab panels — use visibility instead of conditional rendering for Videos to preserve playback state */}
      <div
        id="tabpanel-videos"
        role="tabpanel"
        style={{ display: activeTab === 'videos' ? 'block' : 'none' }}
      >
        <VideoPlayerWithPlaylist
          videos={videos}
          topicId={topicId}
          onWatched={onVideoWatched}
        />
      </div>

      {activeTab === 'files' && (
        <div id="tabpanel-files" role="tabpanel">
          <FilesGrid files={files} />
        </div>
      )}

      {activeTab === 'photos' && (
        <div id="tabpanel-photos" role="tabpanel">
          <PhotosGrid photos={photos} />
        </div>
      )}
    </div>
  );
}
