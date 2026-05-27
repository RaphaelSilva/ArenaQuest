'use client';

import type { Media } from '@web/lib/topics-api';
import { MediaCard } from './MediaCard';
import { useDict } from '@web/context/dict-context';

type MediaGalleryProps = {
  media: Media[];
};

export function MediaGallery({ media }: MediaGalleryProps) {
  const dict = useDict();

  if (!media || media.length === 0) {
    return null;
  }

  const sortedMedia = [...media].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <section className="mb-8">
      <h2
        className="mb-4 text-[15px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        {dict.catalog.topicPage.mediaGalleryTitle}
      </h2>
      <div className="flex flex-col gap-3">
        {sortedMedia.map((m) => (
          <MediaCard key={m.id} media={m} />
        ))}
      </div>
    </section>
  );
}
