import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VideoStage from '../VideoStage';

function setPlayback(video: HTMLVideoElement, currentTime: number, duration: number) {
  Object.defineProperty(video, 'duration', { configurable: true, value: duration });
  Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: currentTime });
}

function renderStage(onWatched: () => void, url = 'https://example.com/lesson.mp4') {
  const utils = render(<VideoStage url={url} onWatched={onWatched} />);
  const video = utils.container.querySelector('video') as HTMLVideoElement;
  return { ...utils, video };
}

describe('VideoStage — watched report', () => {
  it('reports once when playback crosses 90 % of the duration', () => {
    const onWatched = vi.fn();
    const { video } = renderStage(onWatched);

    setPlayback(video, 50, 100);
    fireEvent.timeUpdate(video);
    expect(onWatched).not.toHaveBeenCalled();

    setPlayback(video, 90, 100);
    fireEvent.timeUpdate(video);
    setPlayback(video, 95, 100);
    fireEvent.timeUpdate(video);
    fireEvent.ended(video);

    expect(onWatched).toHaveBeenCalledTimes(1);
  });

  it('does not report below 90 %', () => {
    const onWatched = vi.fn();
    const { video } = renderStage(onWatched);

    setPlayback(video, 89, 100);
    fireEvent.timeUpdate(video);

    expect(onWatched).not.toHaveBeenCalled();
  });

  it('does not report while the duration is unknown', () => {
    const onWatched = vi.fn();
    const { video } = renderStage(onWatched);

    setPlayback(video, 10, Number.NaN);
    fireEvent.timeUpdate(video);
    setPlayback(video, 10, 0);
    fireEvent.timeUpdate(video);

    expect(onWatched).not.toHaveBeenCalled();
  });

  it('reports once on ended without ever crossing 90 %, and not again on replay', () => {
    const onWatched = vi.fn();
    const { video } = renderStage(onWatched);

    fireEvent.ended(video);
    expect(onWatched).toHaveBeenCalledTimes(1);

    // Replay: play from the start, cross 90 % and end again.
    fireEvent.play(video);
    setPlayback(video, 95, 100);
    fireEvent.timeUpdate(video);
    fireEvent.ended(video);

    expect(onWatched).toHaveBeenCalledTimes(1);
  });

  it('still forwards interactions on play and timeupdate', () => {
    const onInteraction = vi.fn();
    const { container } = render(
      <VideoStage url="https://example.com/lesson.mp4" onInteraction={onInteraction} />,
    );
    const video = container.querySelector('video') as HTMLVideoElement;

    fireEvent.play(video);
    setPlayback(video, 95, 100);
    fireEvent.timeUpdate(video);

    expect(onInteraction).toHaveBeenCalledTimes(2);
  });

  it('keeps the player rendered when the watched handler throws', () => {
    const onWatched = vi.fn(() => {
      throw new Error('network down');
    });
    const { video, container } = renderStage(onWatched);

    setPlayback(video, 99, 100);
    expect(() => fireEvent.timeUpdate(video)).not.toThrow();

    expect(onWatched).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBeInTheDocument();
  });

  it('reports again when the source changes to another video', () => {
    const onWatched = vi.fn();
    const { video, rerender, container } = renderStage(onWatched, 'https://example.com/a.mp4');

    fireEvent.ended(video);
    rerender(<VideoStage url="https://example.com/b.mp4" onWatched={onWatched} />);
    fireEvent.ended(container.querySelector('video') as HTMLVideoElement);

    expect(onWatched).toHaveBeenCalledTimes(2);
  });
});
