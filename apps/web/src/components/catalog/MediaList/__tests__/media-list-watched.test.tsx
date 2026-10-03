import React, { Suspense } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Media } from '@web/lib/topics-api';

// Resolve the code-split stages through React.lazy so the real VideoStage renders in jsdom.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
    const Lazy = React.lazy(loader);
    return function DynamicStage(props: Record<string, unknown>) {
      return (
        <Suspense fallback={null}>
          <Lazy {...props} />
        </Suspense>
      );
    };
  },
}));

import { MediaList } from '../MediaList';

const TOPIC_ID = 'topic-1';

const makeMedia = (overrides: Partial<Media>): Media =>
  ({
    id: 'video-1',
    topicNodeId: TOPIC_ID,
    url: 'https://example.com/lesson.mp4',
    storageKey: 'topics/topic-1/lesson.mp4',
    originalName: 'lesson.mp4',
    type: 'video/mp4',
    sizeBytes: 1024,
    status: 'ready',
    uploadedBy: 'creator-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }) as Media;

function setPlayback(video: HTMLVideoElement, currentTime: number, duration: number) {
  Object.defineProperty(video, 'duration', { configurable: true, value: duration });
  Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: currentTime });
}

async function openVideo(container: HTMLElement, name: string): Promise<HTMLVideoElement> {
  fireEvent.click(screen.getByText(name));
  await waitFor(() => expect(container.querySelector('video')).toBeInTheDocument());
  return container.querySelector('video') as HTMLVideoElement;
}

describe('MediaList — watched wiring', () => {
  const markVideoWatched = vi.fn<(topicId: string, mediaId: string) => Promise<void>>();
  const onVideoWatched = (mediaId: string) => {
    void markVideoWatched(TOPIC_ID, mediaId).catch(() => {});
  };

  beforeEach(() => {
    markVideoWatched.mockReset();
    markVideoWatched.mockResolvedValue(undefined);
  });

  it('calls markVideoWatched(topicId, mediaId) exactly once when the video passes 90 %', async () => {
    const { container } = render(
      <MediaList media={[makeMedia({})]} onVideoWatched={onVideoWatched} />,
    );
    const video = await openVideo(container, 'lesson.mp4');

    setPlayback(video, 91, 100);
    fireEvent.timeUpdate(video);
    setPlayback(video, 99, 100);
    fireEvent.timeUpdate(video);
    fireEvent.ended(video);

    expect(markVideoWatched).toHaveBeenCalledTimes(1);
    expect(markVideoWatched).toHaveBeenCalledWith(TOPIC_ID, 'video-1');
  });

  it('reports a video once per page view even after collapsing and reopening it', async () => {
    const { container } = render(
      <MediaList media={[makeMedia({})]} onVideoWatched={onVideoWatched} />,
    );
    let video = await openVideo(container, 'lesson.mp4');
    fireEvent.ended(video);

    // Collapse (unmounts the stage), reopen and watch it again.
    fireEvent.click(screen.getByText('lesson.mp4'));
    await waitFor(() => expect(container.querySelector('video')).not.toBeInTheDocument());
    video = await openVideo(container, 'lesson.mp4');
    fireEvent.ended(video);

    expect(markVideoWatched).toHaveBeenCalledTimes(1);
  });

  it('reports each distinct video with its own media id', async () => {
    const { container } = render(
      <MediaList
        media={[
          makeMedia({ id: 'video-1', originalName: 'first.mp4', createdAt: '2026-10-02T00:00:00.000Z' }),
          makeMedia({ id: 'video-2', originalName: 'second.mp4', createdAt: '2026-10-01T00:00:00.000Z' }),
        ]}
        onVideoWatched={onVideoWatched}
      />,
    );

    fireEvent.ended(await openVideo(container, 'first.mp4'));
    fireEvent.click(screen.getByText('first.mp4'));
    await waitFor(() => expect(container.querySelector('video')).not.toBeInTheDocument());
    fireEvent.ended(await openVideo(container, 'second.mp4'));

    expect(markVideoWatched.mock.calls).toEqual([
      [TOPIC_ID, 'video-1'],
      [TOPIC_ID, 'video-2'],
    ]);
  });

  it('keeps the player rendered and shows no error when markVideoWatched rejects', async () => {
    markVideoWatched.mockRejectedValue(new Error('500'));
    const { container } = render(
      <MediaList media={[makeMedia({})]} onVideoWatched={onVideoWatched} />,
    );
    const video = await openVideo(container, 'lesson.mp4');

    setPlayback(video, 95, 100);
    fireEvent.timeUpdate(video);
    await Promise.resolve();

    expect(markVideoWatched).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not report a video when no handler is wired', async () => {
    const onVisitTopic = vi.fn();
    const { container } = render(<MediaList media={[makeMedia({})]} onVisitTopic={onVisitTopic} />);
    const video = await openVideo(container, 'lesson.mp4');

    expect(() => fireEvent.ended(video)).not.toThrow();
    expect(markVideoWatched).not.toHaveBeenCalled();
    // Visit semantics are unchanged: expanding the row still fires the visit.
    expect(onVisitTopic).toHaveBeenCalledTimes(1);
  });
});
