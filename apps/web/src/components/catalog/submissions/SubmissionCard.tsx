'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useDict } from '@web/context/dict-context';
import type { SubmissionView } from '@web/lib/submissions-api';
import { NoteBadge } from '../notes/NoteBadge';
import { formatNoteTimestamp } from '../notes/NoteCard';
import { submissionErrorMessage } from './submission-errors';
import { formatBytes, submissionKind } from './submission-format';

type SubmissionCardProps = {
  submission: SubmissionView;
  /** Opens a ready submission in the viewer. */
  onOpen: (submission: SubmissionView) => void;
  onEdit: (submission: SubmissionView) => void;
  /**
   * Deletes the row: a ready submission (after confirmation), an interrupted
   * upload (*Discard*) or a tombstone (*Dismiss*). Rejects on failure.
   */
  onDelete: (submission: SubmissionView) => Promise<void>;
};

export const KIND_ICONS = { video: '🎬', image: '🖼️', pdf: '📄' } as const;

const secondaryButton = 'cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold disabled:cursor-wait disabled:opacity-60';

/** Plain-text excerpt of the Markdown description for the card. */
function excerpt(markdown: string, max = 140): string {
  const text = markdown.replace(/[#*_`>[\]()!~]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * One of the student's own submissions. A ready one shows its preview, title,
 * excerpt, date, size and badges with *Edit* and *Delete*; a pending one is an
 * interrupted upload with *Discard*; a removed one is the staff tombstone with
 * only *Dismiss*.
 */
export function SubmissionCard({ submission, onOpen, onEdit, onDelete }: SubmissionCardProps) {
  const dict = useDict();
  const t = dict.submissions;
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setWorking(true);
    setError(null);
    try {
      await onDelete(submission);
    } catch (err) {
      setError(submissionErrorMessage(dict, err));
      setWorking(false);
    }
  };

  const errorLine = error && (
    <p role="alert" className="mt-2 text-[12px] font-semibold" style={{ color: 'var(--aq-error)' }}>
      {error}
    </p>
  );

  if (submission.status === 'removed') {
    return (
      <article
        aria-label={t.tombstone.label}
        className="rounded-[12px] border border-dashed p-4"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
      >
        <p className="text-[13px] font-bold" style={{ color: 'var(--aq-text2)' }}>
          {t.tombstone.label}
        </p>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
          {submission.title}
        </p>
        {errorLine}
        <div className="mt-3 flex">
          <button
            type="button"
            onClick={remove}
            disabled={working}
            className={secondaryButton}
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {t.tombstone.dismiss}
          </button>
        </div>
      </article>
    );
  }

  if (submission.status === 'pending') {
    return (
      <article
        aria-label={submission.title}
        className="rounded-[12px] border p-4"
        style={{ borderColor: 'var(--aq-error)', background: 'var(--aq-bg2)' }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-bold" style={{ color: 'var(--aq-text)' }}>
            {submission.title}
          </span>
          <NoteBadge tone="warning">{t.interrupted.label}</NoteBadge>
        </div>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
          {t.interrupted.hint}
        </p>
        {errorLine}
        <div className="mt-3 flex">
          <button
            type="button"
            onClick={remove}
            disabled={working}
            className={secondaryButton}
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {t.interrupted.discard}
          </button>
        </div>
      </article>
    );
  }

  const kind = submissionKind(submission.contentType);
  const kindLabel = kind === 'video' ? t.card.kindVideo : kind === 'image' ? t.card.kindImage : t.card.kindPdf;
  const text = excerpt(submission.description);

  return (
    <article
      aria-label={submission.title}
      className="flex gap-3 rounded-[12px] border p-3 sm:p-4"
      style={{ borderColor: 'var(--aq-border)', background: 'var(--aq-bg2)' }}
    >
      <button
        type="button"
        onClick={() => onOpen(submission)}
        aria-label={t.card.open(submission.title)}
        className="relative flex h-20 w-20 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border sm:h-24 sm:w-24"
        style={{ borderColor: 'var(--aq-border)', background: 'var(--aq-bg3)' }}
      >
        {kind === 'image' && submission.url ? (
          <Image src={submission.url} alt="" fill sizes="96px" className="object-cover" unoptimized />
        ) : (
          <span className="text-[28px]" aria-hidden>
            {KIND_ICONS[kind]}
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="min-w-0 break-words text-[14px] font-bold" style={{ color: 'var(--aq-text)' }}>
            {submission.title}
          </h4>
          <NoteBadge tone={submission.visibility === 'shared' ? 'accent' : 'neutral'}>
            {submission.visibility === 'shared' ? t.badges.shared : t.badges.private}
          </NoteBadge>
          {submission.moderated && <NoteBadge tone="warning">{t.badges.moderated}</NoteBadge>}
        </div>
        {text && (
          <p className="mt-1 break-words text-[13px]" style={{ color: 'var(--aq-text2)' }}>
            {text}
          </p>
        )}
        <p className="mt-1 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
          <time dateTime={submission.createdAt.replace(' ', 'T')}>
            {t.card.uploadedOn(formatNoteTimestamp(submission.createdAt))}
          </time>
          {' · '}
          {kindLabel}
          {' · '}
          {formatBytes(dict, submission.sizeBytes)}
        </p>

        {errorLine}

        {confirming ? (
          <div role="group" className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px]" style={{ color: 'var(--aq-text)' }}>
              {t.delete.confirm}
            </span>
            <button
              type="button"
              onClick={remove}
              disabled={working}
              aria-busy={working}
              className={secondaryButton}
              style={{ borderColor: 'var(--aq-error)', color: 'var(--aq-error)' }}
            >
              {working ? t.delete.deleting : t.delete.confirmAction}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={working}
              className={secondaryButton}
              style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
            >
              {t.delete.cancel}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onEdit(submission)}
              className={secondaryButton}
              style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text)' }}
            >
              {t.card.edit}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={secondaryButton}
              style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
            >
              {t.card.delete}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
