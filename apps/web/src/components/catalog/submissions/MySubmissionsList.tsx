'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { AuthoredSubmission, Submission, SubmissionView } from '@web/lib/submissions-api';
import { SectionEmpty } from '../SectionEmpty';
import { LoadMoreButton } from '../notes/LoadMoreButton';
import { groupNotesByTopic } from '../notes/MyNotesList';
import { NotesListError, NotesListLoading } from '../notes/NotesListStatus';
import { useNotePages } from '../notes/useNotePages';
import { EditSubmissionDialog } from './EditSubmissionDialog';
import { MoveDialog } from './MoveDialog';
import { SubmissionCard } from './SubmissionCard';
import { SubmissionViewer } from './SubmissionViewer';

/** A row as the shared card and viewer take it: every row here is the caller's own. */
type MyRow = AuthoredSubmission & SubmissionView;

const asView = (row: AuthoredSubmission): MyRow => ({ ...row, isMine: true });

/**
 * "My demonstrations": every submission the student owns, across topics,
 * grouped by topic with a link to each topic's Demonstrations page, on the
 * same cards and actions as *Mine*. A topic the student can no longer read has
 * no link, and its rows say why they are read-only — delete and move remain,
 * which is how a student rescues them.
 */
export function MySubmissionsList() {
  const dict = useDict();
  const t = dict.submissions.myDemonstrations;
  const client = useApiClient();

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const page = await client.submissions.listMyAll(cursor);
      return { data: page.data.map(asView), nextCursor: page.nextCursor };
    },
    [client],
  );
  const pages = useNotePages<MyRow>(fetchPage);
  const groups = useMemo(() => groupNotesByTopic(pages.items), [pages.items]);
  const readyItems = useMemo(() => pages.items.filter((item) => item.status === 'ready' && item.url), [pages.items]);

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [moving, setMoving] = useState<SubmissionView[] | null>(null);
  const [editing, setEditing] = useState<{ submission: SubmissionView; sharingEnabled: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { reload, update } = pages;

  const onDelete = useCallback(
    async (submission: SubmissionView) => {
      // Not behind the topic gate: a lost topic's upload can still be deleted.
      await client.submissions.remove(submission.topicNodeId, submission.id);
      reload();
    },
    [client, reload],
  );

  // The edit dialog needs the topic's sharing switch, which only its summary carries.
  const openEditor = useCallback(
    async (submission: SubmissionView) => {
      setActionError(null);
      try {
        const summary = await client.submissions.summary(submission.topicNodeId);
        setEditing({ submission, sharingEnabled: summary.sharingEnabled });
      } catch {
        setActionError(t.editLoadError);
      }
    },
    [client, t.editLoadError],
  );

  const onSaved = (saved: Submission) => {
    update(saved.id, saved);
    setEditing(null);
  };

  if (pages.state === 'loading') return <NotesListLoading label={t.loading} />;
  if (pages.state === 'error') return <NotesListError message={t.loadError} onRetry={reload} />;
  if (groups.length === 0) return <SectionEmpty title={t.empty} description={t.emptyHint} icon="🎬" />;

  return (
    <div>
      {actionError && (
        <p role="alert" className="mb-4 text-[13px] font-semibold" style={{ color: 'var(--aq-error)' }}>
          {actionError}
        </p>
      )}

      <div className="flex flex-col gap-6">
        {groups.map((group) => {
          const accessible = group.notes[0].topicAccessible;
          const headingId = `submissions-topic-${group.topicNodeId}`;
          return (
            <section key={group.topicNodeId} aria-labelledby={headingId}>
              <h2
                id={headingId}
                className="mb-2 text-[15px] font-bold"
                style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', color: 'var(--aq-text)' }}
              >
                {accessible ? (
                  <Link
                    href={`/catalog/${encodeURIComponent(group.topicNodeId)}/submissions`}
                    className="transition-colors duration-150 hover:text-[var(--aq-accent)]"
                  >
                    {group.topicTitle}
                  </Link>
                ) : (
                  group.topicTitle
                )}
              </h2>
              <ul aria-label={t.groupLabel(group.topicTitle)} className="flex flex-col gap-3">
                {group.notes.map((item) => {
                  const ready = item.status === 'ready';
                  return (
                    <li key={item.id}>
                      <SubmissionCard
                        submission={item}
                        onOpen={(submission) => setViewingId(submission.id)}
                        onEdit={item.topicAccessible ? openEditor : undefined}
                        onMove={ready ? (submission) => setMoving([submission]) : undefined}
                        onDelete={onDelete}
                        notice={
                          item.topicAccessible ? undefined : (
                            <p
                              role="note"
                              className="mt-2 rounded-[8px] border px-3 py-2 text-[12px] font-semibold"
                              style={{
                                borderColor: 'var(--aq-border2)',
                                background: 'var(--aq-bg3)',
                                color: 'var(--aq-text2)',
                              }}
                            >
                              {t.inaccessible}
                            </p>
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {pages.hasMore && (
        <LoadMoreButton
          label={t.loadMore}
          loadingLabel={t.loadingMore}
          errorLabel={t.loadMoreError}
          loading={pages.loadingMore}
          failed={pages.loadMoreFailed}
          onClick={pages.loadMore}
        />
      )}

      {viewingId && (
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

      {moving && <MoveDialog submissions={moving} onMoved={reload} onClose={() => setMoving(null)} />}

      {editing && (
        <EditSubmissionDialog
          topicId={editing.submission.topicNodeId}
          submission={editing.submission}
          sharingEnabled={editing.sharingEnabled}
          onSaved={onSaved}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
