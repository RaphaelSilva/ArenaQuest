'use client';

import { useCallback, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { useNotePages } from '../notes/useNotePages';
import { LoadMoreButton } from '../notes/LoadMoreButton';
import type { SubmissionView } from '@web/lib/submissions-api';
import { ClassSubmissionCard } from './ClassSubmissionCard';
import { SubmissionViewer } from './SubmissionViewer';

type ClassTabProps = {
  topicId: string;
  /** The empty state's shortcut to the *Mine* tab. */
  onGoToMine: () => void;
};

/**
 * *Da turma*: the topic's shared submissions as a card grid, newest first,
 * with no edit or move actions. A card opens the full-screen viewer, which
 * steps through this list and pulls the next cursor page at its end. The page
 * only renders this tab while sharing is on.
 */
export function ClassTab({ topicId, onGoToMine }: ClassTabProps) {
  const t = useDict().submissions;
  const client = useApiClient();

  const fetchPage = useCallback(
    (cursor: string | null) => client.submissions.listClass(topicId, cursor),
    [client, topicId],
  );
  const pages = useNotePages<SubmissionView>(fetchPage);
  const [viewingId, setViewingId] = useState<string | null>(null);

  return (
    <div>
      {pages.state === 'loading' && (
        <p role="status" className="text-[13px]" style={{ color: 'var(--aq-text3)' }}>
          {t.class.loading}
        </p>
      )}

      {pages.state === 'error' && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-[13px] font-semibold" style={{ color: 'var(--aq-error)' }}>
            {t.class.loadError}
          </p>
          <button
            type="button"
            onClick={pages.reload}
            className="cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text)' }}
          >
            {t.list.retry}
          </button>
        </div>
      )}

      {pages.state === 'ready' && pages.items.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-[15px] font-semibold" style={{ color: 'var(--aq-text2)' }}>
            {t.class.empty}
          </p>
          <button
            type="button"
            onClick={onGoToMine}
            className="mt-3 cursor-pointer rounded-[8px] border px-4 py-2 text-[13px] font-bold"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-accent)' }}
          >
            {t.class.goToMine}
          </button>
        </div>
      )}

      {pages.state === 'ready' && pages.items.length > 0 && (
        <ul aria-label={t.class.label} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {pages.items.map((item) => (
            <li key={item.id}>
              <ClassSubmissionCard submission={item} onOpen={(submission) => setViewingId(submission.id)} />
            </li>
          ))}
        </ul>
      )}

      {pages.state === 'ready' && pages.hasMore && (
        <LoadMoreButton
          label={t.list.loadMore}
          loadingLabel={t.list.loadingMore}
          errorLabel={t.list.loadMoreError}
          loading={pages.loadingMore}
          failed={pages.loadMoreFailed}
          onClick={pages.loadMore}
        />
      )}

      {viewingId && (
        <SubmissionViewer
          items={pages.items}
          currentId={viewingId}
          onNavigate={setViewingId}
          onClose={() => setViewingId(null)}
          hasMore={pages.hasMore}
          loadingMore={pages.loadingMore}
          loadMoreFailed={pages.loadMoreFailed}
          onLoadMore={pages.loadMore}
        />
      )}
    </div>
  );
}
