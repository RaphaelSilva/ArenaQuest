'use client';

import Image from 'next/image';
import { useDict } from '@web/context/dict-context';
import type { StaffSubmissionView } from '@web/lib/submissions-api';
import { NoteBadge } from '../notes/NoteBadge';
import { formatNoteTimestamp } from '../notes/NoteCard';
import { KIND_ICONS } from './SubmissionCard';
import { StaffSubmissionActions } from './StaffSubmissionActions';
import { formatBytes, submissionKind } from './submission-format';

type StaffSubmissionCardProps = {
  submission: StaffSubmissionView;
  /** Opens a ready submission in the shared viewer. */
  onOpen: (submission: StaffSubmissionView) => void;
  /** Applies a staff action's result to the row in place. */
  onChange: (patch: Partial<StaffSubmissionView>) => void;
};

/**
 * A submission as staff see it on *Todos*: preview, title, date, kind and size
 * with the private / shared / moderated badges and the staff actions. A
 * removed one is a tombstone that says who removed it and when. No edit, move
 * or upload control here — staff author their own from *Minhas*.
 */
export function StaffSubmissionCard({ submission, onOpen, onChange }: StaffSubmissionCardProps) {
  const dict = useDict();
  const t = dict.submissions;

  if (submission.status === 'removed') {
    const date = submission.removedAt ? formatNoteTimestamp(submission.removedAt) : null;
    const line = date
      ? submission.removedByName
        ? t.staff.removedBy(submission.removedByName, date)
        : t.staff.removedOn(date)
      : null;
    return (
      <article
        aria-label={submission.title}
        className="rounded-[12px] border border-dashed p-4"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 break-words text-[14px] font-bold" style={{ color: 'var(--aq-text2)' }}>
            {submission.title}
          </h4>
          <NoteBadge tone="warning">{t.staff.removedBadge}</NoteBadge>
        </div>
        {line && (
          <p className="mt-1 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
            {line}
          </p>
        )}
      </article>
    );
  }

  const kind = submissionKind(submission.contentType);
  const kindLabel = kind === 'video' ? t.card.kindVideo : kind === 'image' ? t.card.kindImage : t.card.kindPdf;
  const shared = submission.visibility === 'shared';

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
          <NoteBadge tone={shared ? 'accent' : 'neutral'}>{shared ? t.badges.shared : t.badges.private}</NoteBadge>
          {submission.moderated && <NoteBadge tone="warning">{t.badges.moderated}</NoteBadge>}
        </div>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
          <time dateTime={submission.createdAt.replace(' ', 'T')}>
            {t.card.uploadedOn(formatNoteTimestamp(submission.createdAt))}
          </time>
          {' · '}
          {kindLabel}
          {' · '}
          {formatBytes(dict, submission.sizeBytes)}
        </p>
        <StaffSubmissionActions submission={submission} onChange={onChange} />
      </div>
    </article>
  );
}
