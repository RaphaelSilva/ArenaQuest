'use client';

import { useEffect, useRef, useState, type TouchEvent } from 'react';
import PdfStage from '@web/components/catalog/MediaList/PdfStage';
import { ImageGallery } from '@web/components/catalog/MediaViewers/ImageGallery';
import { MarkdownViewer } from '@web/components/catalog/MarkdownViewer';
import { useDict } from '@web/context/dict-context';
import type { SubmissionView } from '@web/lib/submissions-api';
import { formatNoteTimestamp } from '../notes/NoteCard';
import { SubmissionModal } from './SubmissionModal';
import { SubmissionVideo } from './SubmissionVideo';
import { formatBytes, submissionKind } from './submission-format';

/** Horizontal travel, in px, that counts as a swipe. */
const SWIPE_MIN_DISTANCE = 50;

type SubmissionViewerProps = {
  /** The list the viewer steps through, in order (the class list, the caller's ready items, …). */
  items: SubmissionView[];
  /** The submission on screen; must be one of `items`. */
  currentId: string;
  onNavigate: (id: string) => void;
  onClose: () => void;
  /** The list has another cursor page; *Next* past the last item loads it. */
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreFailed?: boolean;
  onLoadMore?: () => void;
};

/** The direct link of a submission; it encodes ids only, access stays with the API. */
export function submissionLink(submission: Pick<SubmissionView, 'id' | 'topicNodeId'>): string {
  const path = `/catalog/${encodeURIComponent(submission.topicNodeId)}/submissions/${encodeURIComponent(submission.id)}`;
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

/**
 * The full-screen submission viewer (a modal on desktop, full screen on a
 * phone): the course player (`VideoStage` behind the playback fallback,
 * `PdfStage`, the image viewer), then title, author, date and the rendered
 * description. *Previous* / *Next* — and a swipe on touch, or the arrow keys —
 * step through `items`; *Next* past the last loaded item fetches the next page
 * and lands on its first item. A step never autoplays: each item mounts a
 * fresh, paused player.
 */
export function SubmissionViewer({
  items,
  currentId,
  onNavigate,
  onClose,
  hasMore = false,
  loadingMore = false,
  loadMoreFailed = false,
  onLoadMore,
}: SubmissionViewerProps) {
  const dict = useDict();
  const t = dict.submissions;
  const index = items.findIndex((item) => item.id === currentId);
  const submission = index >= 0 ? items[index] : null;

  // Set to the length of the list when *Next* asked for another page: once the
  // list grows past it, the viewer lands on the first new item.
  const [advanceTo, setAdvanceTo] = useState<number | null>(null);
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // Reacts to the parent's paging state (an external store from here): landing
  // on the new item and clearing the request are one-shot reactions to it.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (advanceTo === null) return;
    if (items.length > advanceTo) {
      onNavigate(items[advanceTo].id);
      setAdvanceTo(null);
    } else if (!loadingMore && !loadMoreFailed) {
      // The page arrived but added nothing this list shows (e.g. only pending rows): keep going or give up.
      if (hasMore && onLoadMore) onLoadMore();
      else setAdvanceTo(null);
    }
  }, [advanceTo, items, onNavigate, loadingMore, loadMoreFailed, hasMore, onLoadMore]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const waiting = advanceTo !== null && items.length <= advanceTo && !loadMoreFailed;
  const hasPrevious = index > 0;
  const hasNext = index >= 0 && (index < items.length - 1 || hasMore);

  const goPrevious = () => {
    if (!hasPrevious) return;
    setAdvanceTo(null);
    onNavigate(items[index - 1].id);
  };

  const goNext = () => {
    if (index < 0 || waiting) return;
    if (index < items.length - 1) {
      setAdvanceTo(null);
      onNavigate(items[index + 1].id);
    } else if (hasMore && onLoadMore) {
      setAdvanceTo(items.length);
      onLoadMore();
    }
  };

  // The arrow keys step too, unless focus is in a control that uses them.
  const keys = useRef({ goPrevious, goNext });
  useEffect(() => {
    keys.current = { goPrevious, goNext };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, video, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') keys.current.goPrevious();
      else if (event.key === 'ArrowRight') keys.current.goNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!submission) return null;

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) goNext();
    else goPrevious();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(submissionLink(submission));
      setCopied({ id: submission.id, ok: true });
    } catch {
      setCopied({ id: submission.id, ok: false });
    }
  };

  const kind = submissionKind(submission.contentType);
  const url = submission.url;
  const shared = submission.visibility === 'shared';
  const date = shared && submission.sharedAt
    ? t.class.sharedOn(formatNoteTimestamp(submission.sharedAt))
    : t.card.uploadedOn(formatNoteTimestamp(submission.createdAt));
  const copyStatus = copied?.id === submission.id ? copied : null;

  const navButton =
    'cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <SubmissionModal
      label={t.viewer.label(submission.title)}
      onClose={onClose}
      fullScreen
      actions={
        shared && (
          <button
            type="button"
            onClick={copyLink}
            className="cursor-pointer rounded-[8px] border px-3 py-1 text-[12px] font-bold"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text)' }}
          >
            {t.viewer.copyLink}
          </button>
        )
      }
    >
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {copyStatus && (
          <p
            role="status"
            className="mb-2 text-[12px] font-semibold"
            style={{ color: copyStatus.ok ? 'var(--aq-accent)' : 'var(--aq-error)' }}
          >
            {copyStatus.ok ? t.viewer.linkCopied : t.viewer.copyFailed}
          </p>
        )}

        {/* Keyed per item: stepping mounts a fresh, paused player and resets the fallback. */}
        <div key={submission.id}>
          {!url ? (
            <p className="text-[13px]" style={{ color: 'var(--aq-text2)' }}>
              {t.viewer.unavailable}
            </p>
          ) : kind === 'video' ? (
            <SubmissionVideo url={url} originalName={submission.originalName} />
          ) : kind === 'image' ? (
            <ImageGallery url={url} title={submission.title} />
          ) : (
            <PdfStage url={url} originalName={submission.originalName} fileSize={formatBytes(dict, submission.sizeBytes)} />
          )}
        </div>

        <div className="mt-4">
          <h4 className="break-words text-[16px] font-bold" style={{ color: 'var(--aq-text)' }}>
            {submission.title}
          </h4>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
            {submission.isMine ? t.viewer.byYou : t.viewer.by(submission.authorName)}
            {' · '}
            <time dateTime={(shared && submission.sharedAt ? submission.sharedAt : submission.createdAt).replace(' ', 'T')}>
              {date}
            </time>
          </p>
          {submission.description && (
            <MarkdownViewer content={submission.description} className="mt-3 break-words text-[14px]" />
          )}
        </div>

        {(items.length > 1 || hasMore) && (
          <nav className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goPrevious}
              disabled={!hasPrevious}
              className={navButton}
              style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text)' }}
            >
              <span aria-hidden>← </span>
              {t.viewer.previous}
            </button>
            {waiting && (
              <span role="status" className="text-[12px]" style={{ color: 'var(--aq-text3)' }}>
                {t.viewer.loadingNext}
              </span>
            )}
            {advanceTo !== null && loadMoreFailed && (
              <span role="alert" className="text-[12px] font-semibold" style={{ color: 'var(--aq-error)' }}>
                {t.viewer.loadNextError}
              </span>
            )}
            <button
              type="button"
              onClick={goNext}
              disabled={!hasNext || waiting || loadingMore}
              aria-busy={waiting}
              className={navButton}
              style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text)' }}
            >
              {t.viewer.next}
              <span aria-hidden> →</span>
            </button>
          </nav>
        )}
      </div>
    </SubmissionModal>
  );
}
