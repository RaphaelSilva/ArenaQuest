import type { Media } from '@web/lib/topics-api';
import { MediaCard } from './MediaCard';

type MediaGalleryProps = {
  media: Media[];
};

export function MediaGallery({ media }: MediaGalleryProps) {
  if (!media || media.length === 0) {
    return null;
  }

  // Sort media by createdAt (newest first)
  const sortedMedia = [...media].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <section className="mb-8">
      <h2
        className="mb-4 text-[15px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        Media Gallery
      </h2>
      <div className="flex flex-col gap-3">
        {sortedMedia.map((m) => (
          <MediaCard key={m.id} media={m} />
        ))}
      </div>
    </section>
  );
}
