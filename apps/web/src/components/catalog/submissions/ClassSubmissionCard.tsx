'use client';

import Image from 'next/image';
import { useDict } from '@web/context/dict-context';
import type { SubmissionView } from '@web/lib/submissions-api';
import { NoteBadge } from '../notes/NoteBadge';
import { formatNoteTimestamp } from '../notes/NoteCard';
import { KIND_ICONS } from './SubmissionCard';
import { submissionKind } from './submission-format';

type ClassSubmissionCardProps = {
  submission: SubmissionView;
  onOpen: (submission: SubmissionView) => void;
};

/**
 * One shared submission in the *Class* grid: thumbnail or kind icon, title,
 * author name and date, the caller's own marked *You*. Read-only — the whole
 * card opens the viewer.
 */
export function ClassSubmissionCard({ submission, onOpen }: ClassSubmissionCardProps) {
  const t = useDict().submissions;
  const kind = submissionKind(submission.contentType);
  const date = formatNoteTimestamp(submission.sharedAt ?? submission.createdAt);

  return (
    <article aria-label={submission.title} className="h-full">
      <button
        type="button"
        onClick={() => onOpen(submission)}
        aria-label={t.card.open(submission.title)}
        className="flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[12px] border text-left transition-colors duration-150"
        style={{ borderColor: 'var(--aq-border)', background: 'var(--aq-bg2)' }}
      >
        <span
          className="relative flex aspect-video w-full items-center justify-center"
          style={{ background: 'var(--aq-bg3)' }}
        >
          {kind === 'image' && submission.url ? (
            <Image src={submission.url} alt="" fill sizes="(min-width: 640px) 280px, 50vw" className="object-cover" unoptimized />
          ) : (
            <span className="text-[32px]" aria-hidden>
              {KIND_ICONS[kind]}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          <span className="break-words text-[13px] font-bold" style={{ color: 'var(--aq-text)' }}>
            {submission.title}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: 'var(--aq-text2)' }}>
            <span className="min-w-0 break-words">{submission.authorName}</span>
            {submission.isMine && <NoteBadge tone="accent">{t.class.you}</NoteBadge>}
          </span>
          <time
            dateTime={(submission.sharedAt ?? submission.createdAt).replace(' ', 'T')}
            className="text-[11px]"
            style={{ color: 'var(--aq-text3)' }}
          >
            {t.class.sharedOn(date)}
          </time>
        </span>
      </button>
    </article>
  );
}
