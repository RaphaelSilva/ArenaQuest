import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import type { SubmissionView } from '@web/lib/submissions-api';
import { view } from './fixtures';
import { MEDIA_ERR_SRC_NOT_SUPPORTED } from '../SubmissionVideo';
import { SubmissionViewer } from '../SubmissionViewer';

const t = dictPt.submissions;

const items: SubmissionView[] = [
  view({ id: 'a', title: 'Primeiro', visibility: 'shared', isMine: false, authorName: 'Ana', url: 'https://r2.example/a.mov', originalName: 'a.mov', contentType: 'video/quicktime' }),
  view({ id: 'b', title: 'Segundo', visibility: 'shared', isMine: false, authorName: 'Bia' }),
];

function setup(overrides: Partial<Parameters<typeof SubmissionViewer>[0]> = {}) {
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  render(<SubmissionViewer items={items} currentId="a" onNavigate={onNavigate} onClose={onClose} {...overrides} />);
  return { onNavigate, onClose };
}

function failVideo(code: number) {
  const video = document.querySelector('video');
  if (!video) throw new Error('no video element');
  Object.defineProperty(video, 'error', { value: { code }, configurable: true });
  fireEvent.error(video);
}

describe('SubmissionViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces the player with the translated message and a Baixar link on MEDIA_ERR_SRC_NOT_SUPPORTED', () => {
    setup();
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).not.toHaveAttribute('autoplay');

    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);

    expect(screen.getByRole('alert')).toHaveTextContent(t.viewer.unsupportedVideo);
    expect(t.viewer.unsupportedVideo).toBe('Este vídeo não pode ser reproduzido neste navegador.');
    const download = screen.getByRole('link', { name: t.viewer.download });
    expect(download).toHaveAttribute('href', 'https://r2.example/a.mov');
    expect(download).toHaveAttribute('download', 'a.mov');
    expect(document.querySelector('video')).toBeNull();
  });

  it('keeps the player on other media errors (e.g. a network failure)', () => {
    setup();
    failVideo(2);
    expect(document.querySelector('video')).not.toBeNull();
    expect(screen.queryByText(t.viewer.unsupportedVideo)).not.toBeInTheDocument();
  });

  it('copies the [sid] URL with Copiar link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();

    fireEvent.click(screen.getByRole('button', { name: t.viewer.copyLink }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/catalog/t1/submissions/a`));
    expect(await screen.findByText(t.viewer.linkCopied)).toBeInTheDocument();
  });

  it('reports a copy failure', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();

    fireEvent.click(screen.getByRole('button', { name: t.viewer.copyLink }));
    expect(await screen.findByText(t.viewer.copyFailed)).toBeInTheDocument();
  });

  it('offers no Copiar link on a private submission', () => {
    setup({ items: [view({ id: 'p', visibility: 'private' })], currentId: 'p' });
    expect(screen.queryByRole('button', { name: t.viewer.copyLink })).not.toBeInTheDocument();
  });

  it('steps with a horizontal swipe and the arrow keys', () => {
    const { onNavigate } = setup();
    const body = screen.getByText('Primeiro', { selector: 'h4' }).closest('[class="mt-4"]')?.parentElement as HTMLElement;

    fireEvent.touchStart(body, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(body, { changedTouches: [{ clientX: 120, clientY: 110 }] });
    expect(onNavigate).toHaveBeenLastCalledWith('b');

    // A mostly vertical drag is a scroll, not a swipe.
    onNavigate.mockClear();
    fireEvent.touchStart(body, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(body, { changedTouches: [{ clientX: 220, clientY: 400 }] });
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onNavigate).toHaveBeenLastCalledWith('b');
  });

  it('shows the author as "Por você" on the caller’s own submission, and the rendered description', () => {
    setup({
      items: [view({ id: 'm', isMine: true, description: '**Kihon** forte' })],
      currentId: 'm',
    });
    expect(screen.getByText(new RegExp(t.viewer.byYou))).toBeInTheDocument();
    expect(screen.getByText('Kihon', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(t.viewer.next) })).not.toBeInTheDocument();
  });

  it('closes with Fechar', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: t.viewer.close }));
    expect(onClose).toHaveBeenCalled();
  });
});
