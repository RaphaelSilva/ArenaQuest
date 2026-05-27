'use client';

import { useState } from 'react';
import type { Media } from '@web/lib/topics-api';
import { VideoPlayer } from './VideoPlayer';
import { useDict } from '@web/context/dict-context';

type MediaCardProps = {
  media: Media;
};

function getMediaTypeIcon(type: string): string {
  const lowerType = type.toLowerCase();
  if (lowerType.includes('video') || lowerType.includes('mp4')) return '🎬';
  if (lowerType.includes('pdf')) return '📄';
  if (lowerType.includes('image') || lowerType.includes('jpg') || lowerType.includes('png')) return '🖼️';
  if (lowerType.includes('document') || lowerType.includes('doc')) return '📃';
  return '📎';
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function MediaCard({ media }: MediaCardProps) {
  const dict = useDict();
  const [isExpanded, setIsExpanded] = useState(false);
  const isVideo = media.type.toLowerCase().includes('video') || media.type.toLowerCase().includes('mp4');
  const isPdf = media.type.toLowerCase().includes('pdf');
  const isImage = media.type.toLowerCase().includes('image') || media.type.toLowerCase().includes('jpg') || media.type.toLowerCase().includes('png');

  const typeIcon = getMediaTypeIcon(media.type);
  const fileSize = formatFileSize(media.sizeBytes);

  return (
    <div className="overflow-hidden rounded-[8px] border" style={{ borderColor: 'var(--aq-border)' }}>
      <div
        className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-opacity-50"
        style={{ backgroundColor: 'var(--aq-bg3)' }}
        onClick={() => isVideo && setIsExpanded(!isExpanded)}
      >
        <div className="flex flex-1 items-center gap-3">
          <span className="text-[20px]" aria-hidden>{typeIcon}</span>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-[14px] font-medium" style={{ color: 'var(--aq-text1)' }}>
              {media.originalName}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--aq-text3)' }}>
              {media.type} · {fileSize}
            </p>
          </div>
        </div>

        {isVideo && (
          <button
            className="ml-4 flex-shrink-0 text-[12px] font-medium"
            style={{ color: 'var(--aq-accent)' }}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? dict.catalog.mediaCard.hide : dict.catalog.mediaCard.play}
          </button>
        )}

        {(isPdf || isImage) && (
          <a
            href={media.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-4 flex-shrink-0 text-[12px] font-medium"
            style={{ color: 'var(--aq-accent)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {isPdf ? dict.catalog.mediaCard.view : dict.catalog.mediaCard.open}
          </a>
        )}
      </div>

      {isVideo && isExpanded && (
        <div className="border-t p-4" style={{ borderColor: 'var(--aq-border)' }}>
          <VideoPlayer src={media.url} title={media.originalName} />
        </div>
      )}

      {isImage && (
        <div className="border-t p-4" style={{ borderColor: 'var(--aq-border)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={media.url}
            alt={media.originalName}
            className="max-h-[400px] w-full rounded object-contain"
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
}
