'use client';

import { useCallback, useMemo, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { StaffSubmissionView } from '@web/lib/submissions-api';
import { SectionEmpty } from '../SectionEmpty';
import { LoadMoreButton } from '../notes/LoadMoreButton';
import { NotesListError, NotesListLoading } from '../notes/NotesListStatus';
import { useNotePages } from '../notes/useNotePages';
import { StaffSubmissionCard } from './StaffSubmissionCard';
import { SubmissionViewer } from './SubmissionViewer';

export type AuthorGroup<T> = { authorId: string; authorName: string; items: T[] };

/** Groups rows by author, keeping the order in which each author first appears (newest first). */
export function groupByAuthor<T extends { authorId: string; authorName: string }>(rows: readonly T[]): AuthorGroup<T>[] {
  const groups = new Map<string, AuthorGroup<T>>();
  for (const row of rows) {
    let group = groups.get(row.authorId);
    if (!group) {
      group = { authorId: row.authorId, authorName: row.authorName, items: [] };
      groups.set(row.authorId, group);
    }
    group.items.push(row);
  }
  return [...groups.values()];
}

/**
 * *Todos* (staff only): every ready and removed submission on the topic,
 * grouped by student, with the staff badges and actions. A ready card opens
 * the shared viewer, which steps through the loaded ready items in list order.
 */
export function AllTab({ topicId }: { topicId: string }) {
  const t = useDict().submissions;
  const client = useApiClient();

  const fetchPage = useCallback(
    (cursor: string | null) => client.submissions.listAll(topicId, cursor),
    [client, topicId],
  );
  const pages = useNotePages<StaffSubmissionView>(fetchPage);
  const groups = useMemo(() => groupByAuthor(pages.items), [pages.items]);
  const readyItems = useMemo(() => pages.items.filter((item) => item.status === 'ready' && item.url), [pages.items]);
  const [viewingId, setViewingId] = useState<string | null>(null);

  if (pages.state === 'loading') return <NotesListLoading label={t.staff.loading} />;
  if (pages.state === 'error') return <NotesListError message={t.staff.loadError} onRetry={pages.reload} />;
  if (groups.length === 0) return <SectionEmpty title={t.staff.empty} icon="🎬" />;

  return (
    <div>
      <div aria-label={t.staff.allLabel} role="region" className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.authorId} aria-labelledby={`all-author-${group.authorId}`}>
            <h3
              id={`all-author-${group.authorId}`}
              className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold"
              style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', color: 'var(--aq-text)' }}
            >
              <span className="min-w-0 break-words">{group.authorName}</span>
              <span className="text-[12px] font-semibold" style={{ color: 'var(--aq-text3)' }}>
                {t.staff.groupCount(group.items.length)}
              </span>
            </h3>
            <ul aria-label={t.staff.groupLabel(group.authorName)} className="flex flex-col gap-3">
              {group.items.map((item) => (
                <li key={item.id}>
                  <StaffSubmissionCard
                    submission={item}
                    onOpen={(submission) => setViewingId(submission.id)}
                    onChange={(patch) => pages.update(item.id, patch)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {pages.hasMore && (
        <LoadMoreButton
          label={t.list.loadMore}
          loadingLabel={t.list.loadingMore}
          errorLabel={t.list.loadMoreError}
          loading={pages.loadingMore}
          failed={pages.loadMoreFailed}
          onClick={pages.loadMore}
        />
      )}

      {viewingId && readyItems.some((item) => item.id === viewingId) && (
        <SubmissionViewer
          items={readyItems}
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
