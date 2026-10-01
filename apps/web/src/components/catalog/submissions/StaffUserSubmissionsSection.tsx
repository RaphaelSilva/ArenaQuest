'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { StaffAuthoredSubmission } from '@web/lib/submissions-api';
import { SectionEmpty } from '../SectionEmpty';
import { LoadMoreButton } from '../notes/LoadMoreButton';
import { groupNotesByTopic } from '../notes/MyNotesList';
import { NotesListError, NotesListLoading } from '../notes/NotesListStatus';
import { useNotePages } from '../notes/useNotePages';
import { StaffSubmissionCard } from './StaffSubmissionCard';
import { SubmissionViewer } from './SubmissionViewer';

/**
 * The user backoffice *Demonstrations* section: every ready and removed
 * submission one student sent, grouped by topic, with the same badges and
 * staff actions as the topic's *All* tab. Self-contained — its own fetch
 * through the staff route and its own loading / error states.
 */
export function StaffUserSubmissionsSection({ userId }: { userId: string }) {
  const dict = useDict();
  const t = dict.submissions;
  const s = t.staff.userSection;
  const client = useApiClient();

  const fetchPage = useCallback(
    (cursor: string | null) => client.submissions.listByUser(userId, cursor),
    [client, userId],
  );
  const pages = useNotePages<StaffAuthoredSubmission>(fetchPage);
  const groups = useMemo(() => groupNotesByTopic(pages.items), [pages.items]);
  const readyItems = useMemo(() => pages.items.filter((item) => item.status === 'ready' && item.url), [pages.items]);
  const [viewingId, setViewingId] = useState<string | null>(null);

  let content;
  if (pages.state === 'loading') content = <NotesListLoading label={s.loading} />;
  else if (pages.state === 'error') content = <NotesListError message={s.loadError} onRetry={pages.reload} />;
  else if (groups.length === 0) content = <SectionEmpty title={s.empty} description={s.emptyHint} icon="🎬" />;
  else {
    content = (
      <div>
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.topicNodeId} aria-labelledby={`staff-submissions-topic-${group.topicNodeId}`}>
              <h3
                id={`staff-submissions-topic-${group.topicNodeId}`}
                className="mb-2 text-[15px] font-bold"
                style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', color: 'var(--aq-text)' }}
              >
                <Link
                  href={`/catalog/${encodeURIComponent(group.topicNodeId)}/submissions?tab=all`}
                  className="hover:underline"
                >
                  {group.topicTitle}
                </Link>
              </h3>
              <ul aria-label={s.groupLabel(group.topicTitle)} className="flex flex-col gap-3">
                {group.notes.map((item) => (
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
      </div>
    );
  }

  return (
    <section aria-labelledby="staff-user-submissions" className="mt-8">
      <h2
        id="staff-user-submissions"
        className="mb-4 text-[13px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        {s.title}
      </h2>
      {content}
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
    </section>
  );
}
