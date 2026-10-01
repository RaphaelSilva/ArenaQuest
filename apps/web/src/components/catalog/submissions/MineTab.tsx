'use client';

import { useCallback, useMemo, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import {
  SUBMISSION_MOVE_MAX_IDS,
  type Submission,
  type SubmissionSummary,
  type SubmissionView,
  type uploadToPresignedUrl,
} from '@web/lib/submissions-api';
import { useNotePages } from '../notes/useNotePages';
import { LoadMoreButton } from '../notes/LoadMoreButton';
import { EditSubmissionDialog } from './EditSubmissionDialog';
import { MoveDialog } from './MoveDialog';
import { SubmissionCard } from './SubmissionCard';
import { SubmissionViewer } from './SubmissionViewer';
import { UploadForm, type UploadOutcome } from './UploadForm';

type MineTabProps = {
  topicId: string;
  summary: SubmissionSummary;
  /** Re-reads the summary after anything that changes the caller's usage. */
  onUsageChanged: () => void;
  /** The PUT; injectable for tests. */
  upload?: typeof uploadToPresignedUrl;
};

/**
 * *Minhas*: the send button (sticky at the bottom on a phone), the upload
 * form, and the caller's own submissions newest first — ready cards,
 * interrupted uploads and staff tombstones. A ready card moves to another
 * topic on its own; *Select* picks up to 10 ready cards to move at once.
 */
export function MineTab({ topicId, summary, onUsageChanged, upload }: MineTabProps) {
  const dict = useDict();
  const t = dict.submissions;
  const client = useApiClient();

  const fetchPage = useCallback(
    (cursor: string | null) => client.submissions.listMine(topicId, cursor),
    [client, topicId],
  );
  const pages = useNotePages<SubmissionView>(fetchPage);

  const [formOpen, setFormOpen] = useState(false);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SubmissionView | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moving, setMoving] = useState<SubmissionView[] | null>(null);

  const { reload, update } = pages;

  const onUploadFinished = useCallback(
    (outcome: UploadOutcome) => {
      if (outcome === 'uploaded') {
        setFormOpen(false);
        setNotice(t.upload.success);
      } else if (outcome === 'cancelled') {
        setFormOpen(false);
        setNotice(t.upload.cancelled);
      }
      reload();
      onUsageChanged();
    },
    [onUsageChanged, reload, t.upload.cancelled, t.upload.success],
  );

  const onDelete = useCallback(
    async (submission: SubmissionView) => {
      await client.submissions.remove(topicId, submission.id);
      reload();
      onUsageChanged();
    },
    [client, onUsageChanged, reload, topicId],
  );

  const toggleSelected = (submission: SubmissionView) => {
    setSelectedIds((prev) => {
      if (prev.includes(submission.id)) return prev.filter((id) => id !== submission.id);
      // The API moves at most 10 per request; the UI never builds a larger one.
      return prev.length >= SUBMISSION_MOVE_MAX_IDS ? prev : [...prev, submission.id];
    });
  };

  const stopSelecting = () => {
    setSelecting(false);
    setSelectedIds([]);
  };

  const onMoved = useCallback(() => {
    setSelecting(false);
    setSelectedIds([]);
    reload();
    onUsageChanged();
  }, [onUsageChanged, reload]);

  const onSaved = (saved: Submission) => {
    update(saved.id, saved);
    setEditing(null);
  };

  // The upload in flight is shown by its progress bar, not as an interrupted row.
  const items = pages.items.filter((item) => item.id !== activeUploadId);
  // The viewer steps through the ready items only; pending rows and tombstones have no file.
  const readyItems = useMemo(() => pages.items.filter((item) => item.status === 'ready' && item.url), [pages.items]);
  const canSelect = items.some((item) => item.status === 'ready');
  const selectionFull = selectedIds.length >= SUBMISSION_MOVE_MAX_IDS;

  const moveSelected = () => {
    const chosen = pages.items.filter((item) => selectedIds.includes(item.id));
    // Request order follows the selection order, as the API moves in order.
    chosen.sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id));
    if (chosen.length > 0) setMoving(chosen);
  };

  return (
    <div>
      {notice && !formOpen && (
        <p role="status" className="mb-4 text-[13px] font-semibold" style={{ color: 'var(--aq-accent)' }}>
          {notice}
        </p>
      )}

      {formOpen ? (
        <UploadForm
          topicId={topicId}
          summary={summary}
          upload={upload}
          onActiveUploadChange={setActiveUploadId}
          onFinished={onUploadFinished}
          onClose={() => setFormOpen(false)}
        />
      ) : (
        <div
          className="sticky bottom-0 z-10 -mx-4 mb-6 border-t px-4 py-3 md:static md:mx-0 md:border-0 md:p-0"
          style={{ borderColor: 'var(--aq-border)', background: 'var(--aq-bg)' }}
        >
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setFormOpen(true);
            }}
            className="w-full cursor-pointer rounded-[8px] px-4 py-2.5 text-[14px] font-bold md:w-auto"
            style={{ background: 'var(--aq-accent)', color: 'var(--aq-bg)' }}
          >
            {t.upload.open}
          </button>
        </div>
      )}

      {pages.state === 'loading' && (
        <p role="status" className="text-[13px]" style={{ color: 'var(--aq-text3)' }}>
          {t.list.loading}
        </p>
      )}

      {pages.state === 'error' && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-[13px] font-semibold" style={{ color: 'var(--aq-error)' }}>
            {t.list.loadError}
          </p>
          <button
            type="button"
            onClick={reload}
            className="cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text)' }}
          >
            {t.list.retry}
          </button>
        </div>
      )}

      {pages.state === 'ready' && items.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-[15px] font-semibold" style={{ color: 'var(--aq-text2)' }}>
            {t.list.empty}
          </p>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--aq-text3)' }}>
            {t.list.emptyHint}
          </p>
        </div>
      )}

      {pages.state === 'ready' && canSelect && (
        <div
          role="toolbar"
          aria-label={t.select.start}
          className="mb-3 flex flex-wrap items-center gap-2"
        >
          {selecting ? (
            <>
              <span role="status" className="text-[12px] font-semibold" style={{ color: 'var(--aq-text)' }}>
                {t.select.count(selectedIds.length, SUBMISSION_MOVE_MAX_IDS)}
              </span>
              <button
                type="button"
                onClick={moveSelected}
                disabled={selectedIds.length === 0}
                className="cursor-pointer rounded-[8px] px-3 py-1.5 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--aq-accent)', color: 'var(--aq-bg)' }}
              >
                {t.select.moveSelected}
              </button>
              <button
                type="button"
                onClick={stopSelecting}
                className="cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold"
                style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
              >
                {t.select.cancel}
              </button>
              {selectionFull && (
                <span className="w-full text-[12px]" style={{ color: 'var(--aq-text2)' }}>
                  {t.select.limitReached(SUBMISSION_MOVE_MAX_IDS)}
                </span>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setSelecting(true)}
              className="cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold"
              style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text)' }}
            >
              {t.select.start}
            </button>
          )}
        </div>
      )}

      {pages.state === 'ready' && items.length > 0 && (
        <ul aria-label={t.list.label} className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <SubmissionCard
                submission={item}
                onOpen={(submission) => setViewingId(submission.id)}
                onEdit={setEditing}
                onMove={(submission) => setMoving([submission])}
                onDelete={onDelete}
                selection={
                  selecting && item.status === 'ready'
                    ? { selected: selectedIds.includes(item.id), disabled: selectionFull, onToggle: toggleSelected }
                    : undefined
                }
              />
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

      {moving && <MoveDialog submissions={moving} onMoved={onMoved} onClose={() => setMoving(null)} />}

      {editing && (
        <EditSubmissionDialog
          topicId={topicId}
          submission={editing}
          sharingEnabled={summary.sharingEnabled}
          onSaved={onSaved}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
