'use client';

import type { Media } from '@web/lib/admin-media-api';
import { useDict } from '@web/context/dict-context';

type Props = { photos: Media[] };

export function PhotosGrid({ photos }: Props) {
  const dict = useDict();

  if (photos.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--aq-text3)' }}>
        {dict.catalog.photosGrid.noPhotos}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((p) => (
        <a
          key={p.id}
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group overflow-hidden rounded-[12px]"
          style={{ border: '1px solid var(--aq-border)' }}
          title={p.originalName}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.url}
            alt={p.originalName}
            className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}
