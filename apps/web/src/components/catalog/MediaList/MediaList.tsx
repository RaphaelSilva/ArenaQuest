'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import type { Media } from '@web/lib/topics-api';
import { useDict } from '@web/context/dict-context';

// Code-split stages using next/dynamic with ssr: false
const VideoStage = dynamic(() => import('./VideoStage'), { ssr: false });
const AudioStage = dynamic(() => import('./AudioStage'), { ssr: false });
const PdfStage = dynamic(() => import('./PdfStage'), { ssr: false });

type MediaListProps = {
  media: Media[];
  onVisitTopic?: () => void;
};

function getMediaTypeIcon(type: string): string {
  const lowerType = type.toLowerCase();
  if (lowerType.includes('video') || lowerType.includes('mp4')) return '🎬';
  if (lowerType.includes('pdf')) return '📄';
  if (lowerType.includes('audio') || lowerType.includes('mp3') || lowerType.includes('wav')) return '🎵';
  return '📎';
}

function getMediaTypeLabel(type: string): string {
  const lowerType = type.toLowerCase();
  if (lowerType.includes('video') || lowerType.includes('mp4')) return 'Video';
  if (lowerType.includes('pdf')) return 'PDF';
  if (lowerType.includes('audio') || lowerType.includes('mp3') || lowerType.includes('wav')) return 'Audio';
  return 'Document';
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function MediaList({ media, onVisitTopic }: MediaListProps) {
  const dict = useDict();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!media || media.length === 0) {
    return null;
  }

  const sortedMedia = [...media].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      onVisitTopic?.(); // Trigger progress / visit endpoint
    }
  };

  const handleInteraction = () => {
    onVisitTopic?.(); // Trigger progress on audio play / video scrub etc.
  };

  return (
    <section className="mb-8">
      <h2
        className="mb-4 text-[13px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        {dict.catalog.topicPage.mediaGalleryTitle}
      </h2>
      <div className="flex flex-col gap-3">
        {sortedMedia.map((m) => {
          const isExpanded = expandedId === m.id;
          const isVideo = m.type.toLowerCase().includes('video') || m.type.toLowerCase().includes('mp4');
          const isPdf = m.type.toLowerCase().includes('pdf');
          const isAudio = m.type.toLowerCase().includes('audio') || m.type.toLowerCase().includes('mp3') || m.type.toLowerCase().includes('wav');

          const icon = getMediaTypeIcon(m.type);
          const typeLabel = getMediaTypeLabel(m.type);
          const fileSize = formatFileSize(m.sizeBytes);

          return (
            <div
              key={m.id}
              className="overflow-hidden rounded-[10px] border transition-all duration-200"
              style={{
                borderColor: 'var(--aq-border)',
                background: 'var(--aq-bg2)',
              }}
            >
              {/* Row Header */}
              <div
                onClick={() => toggleExpand(m.id)}
                className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-[var(--aq-bg3)]"
              >
                <div className="flex flex-1 items-center gap-3 min-w-0">
                  <span className="text-[20px] flex-shrink-0" aria-hidden>
                    {icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className="truncate text-[14px] font-bold"
                      style={{
                        fontFamily: 'var(--font-space-grotesk), sans-serif',
                        color: 'var(--aq-text)',
                      }}
                    >
                      {m.originalName}
                    </p>
                    <p className="text-[12px] mt-0.5" style={{ color: 'var(--aq-text3)' }}>
                      {fileSize}
                    </p>
                  </div>
                </div>

                {/* Right side Badge & Chevron */}
                <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                  <span
                    className="rounded-[6px] px-2 py-0.5 text-[10px] font-semibold uppercase"
                    style={{ background: 'var(--aq-bg4)', color: 'var(--aq-text3)' }}
                  >
                    {typeLabel}
                  </span>
                  <span
                    className="text-[14px] font-medium transition-transform duration-200"
                    style={{
                      color: 'var(--aq-text3)',
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                  >
                    ▶
                  </span>
                </div>
              </div>

              {/* Collapsible Player Stage */}
              {isExpanded && (
                <div className="border-t p-4" style={{ borderColor: 'var(--aq-border)', background: 'var(--aq-bg3)' }}>
                  {isVideo && <VideoStage url={m.url} onInteraction={handleInteraction} />}
                  {isAudio && <AudioStage url={m.url} onInteraction={handleInteraction} />}
                  {isPdf && (
                    <PdfStage
                      url={m.url}
                      originalName={m.originalName}
                      fileSize={fileSize}
                      onInteraction={handleInteraction}
                    />
                  )}
                  {!isVideo && !isAudio && !isPdf && (
                    <div className="p-3 text-[13px] text-center" style={{ color: 'var(--aq-text3)' }}>
                      <a href={m.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--aq-accent)]" onClick={handleInteraction}>
                        {dict.catalog.mediaCard.open}
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
