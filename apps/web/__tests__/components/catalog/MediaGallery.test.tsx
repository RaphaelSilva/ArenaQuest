import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MediaGallery } from '@web/components/catalog/MediaGallery';
import type { Media } from '@web/lib/topics-api';

import { dictPt } from '@web/i18n/dict-pt';

describe('MediaGallery', () => {
  it('renders nothing when media array is empty', () => {
    const { container } = render(<MediaGallery media={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when media is null or undefined', () => {
    const { container: container1 } = render(<MediaGallery media={null as unknown as Media[]} />);
    const { container: container2 } = render(<MediaGallery media={undefined as unknown as Media[]} />);
    expect(container1.firstChild).toBeNull();
    expect(container2.firstChild).toBeNull();
  });

  it('renders gallery section with heading when media exists', () => {
    const media: Media[] = [
      {
        id: '1',
        topicNodeId: 'topic1',
        url: 'https://example.com/video.mp4',
        type: 'video/mp4',
        storageKey: 'video.mp4',
        sizeBytes: 5000000,
        originalName: 'intro.mp4',
        uploadedById: 'user1',
        status: 'ready',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ];

    render(<MediaGallery media={media} />);
    expect(screen.getByText(dictPt.catalog.topicPage.mediaGalleryTitle)).toBeInTheDocument();
  });

  it('renders multiple media items', () => {
    const media: Media[] = [
      {
        id: '1',
        topicNodeId: 'topic1',
        url: 'https://example.com/video.mp4',
        type: 'video/mp4',
        storageKey: 'video.mp4',
        sizeBytes: 5000000,
        originalName: 'intro.mp4',
        uploadedById: 'user1',
        status: 'ready',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: '2',
        topicNodeId: 'topic1',
        url: 'https://example.com/image.png',
        type: 'image/png',
        storageKey: 'image.png',
        sizeBytes: 200000,
        originalName: 'diagram.png',
        uploadedById: 'user1',
        status: 'ready',
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      },
    ];

    render(<MediaGallery media={media} />);
    expect(screen.getByText('intro.mp4')).toBeInTheDocument();
    expect(screen.getByText('diagram.png')).toBeInTheDocument();
  });

  it('sorts media by createdAt descending (newest first)', () => {
    const media: Media[] = [
      {
        id: '1',
        topicNodeId: 'topic1',
        url: 'https://example.com/old.mp4',
        type: 'video/mp4',
        storageKey: 'old.mp4',
        sizeBytes: 5000000,
        originalName: 'old_video.mp4',
        uploadedById: 'user1',
        status: 'ready',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: '2',
        topicNodeId: 'topic1',
        url: 'https://example.com/new.mp4',
        type: 'video/mp4',
        storageKey: 'new.mp4',
        sizeBytes: 5000000,
        originalName: 'new_video.mp4',
        uploadedById: 'user1',
        status: 'ready',
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      },
    ];

    const { container } = render(<MediaGallery media={media} />);
    const items = container.querySelectorAll('[style*="var(--aq-bg3)"]');
    // Newest should come first
    expect(items[0].textContent).toContain('new_video.mp4');
    expect(items[1].textContent).toContain('old_video.mp4');
  });
});
