'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '@web/components/spinner';
import { useDict } from '@web/context/dict-context';
import type { ClassifiedObject, StorageObjectDetail, StorageReference } from '@web/lib/admin-storage-api';
import { StorageDeleteButton, isDeletableStatus } from './storage-delete-action';
import { StorageStatusBadge } from './storage-status-badge';
import { StorageObjectPreview } from './storage-object-preview';
import { formatBytes, formatTimestamp, HINT_KEY } from './storage-format';

export type StorageObjectState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'ready'; detail: StorageObjectDetail };

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, iframe, video[controls], [tabindex]:not([tabindex="-1"])';

/**
 * Side drawer with everything the API knows about one object: every
 * reference, the raw key, the orphan hint and an inline preview. Focus is
 * trapped inside while open, Escape closes, and focus returns to the row that
 * opened it. An `orphan` / `deleted-row` object gets a *Delete* action in the
 * footer, which only opens the page's confirmation dialog.
 */
export function StorageObjectDrawer({
  objectKey,
  state,
  onClose,
  onRetry,
  onDeleteObject,
}: {
  objectKey: string;
  state: StorageObjectState;
  onClose: () => void;
  onRetry: () => void;
  onDeleteObject?: (object: ClassifiedObject) => void;
}) {
  const d = useDict().adminStorage.drawer;
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !containerRef.current) return;
      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !containerRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !containerRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-object-drawer-title"
        className="relative flex h-dvh w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-zinc-900"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 id="storage-object-drawer-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {d.title}
            </h2>
            <p className="break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">{objectKey}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={d.close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <DrawerBody state={state} onRetry={onRetry} />
        </div>

        {state.status === 'ready' && onDeleteObject && (
          <DeleteFooter detail={state.detail} onDeleteObject={onDeleteObject} />
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Rendered only when the object is deletable; otherwise nothing at all. */
function DeleteFooter({
  detail,
  onDeleteObject,
}: {
  detail: StorageObjectDetail;
  onDeleteObject: (object: ClassifiedObject) => void;
}) {
  if (!isDeletableStatus(detail.status)) return null;
  return (
    <footer className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <StorageDeleteButton key={detail.key} object={detail} onDelete={onDeleteObject} />
    </footer>
  );
}

function DrawerBody({ state, onRetry }: { state: StorageObjectState; onRetry: () => void }) {
  const dict = useDict().adminStorage;
  const d = dict.drawer;

  if (state.status === 'loading') {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <Spinner className="h-5 w-5" />
        {d.loading}
      </div>
    );
  }

  if (state.status === 'not-found') {
    return (
      <p role="alert" className="text-sm text-zinc-700 dark:text-zinc-300">
        {d.notFound}
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-800 dark:text-red-200">
        <span>{d.error}</span>
        <button type="button" onClick={onRetry} className="rounded-md border border-current px-3 py-1 font-medium">
          {dict.retry}
        </button>
      </div>
    );
  }

  const { detail } = state;

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">{d.key}</dt>
        <dd className="break-all font-mono text-xs text-zinc-900 dark:text-zinc-100">{detail.key}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">{d.status}</dt>
        <dd>
          <StorageStatusBadge status={detail.status} stale={detail.stale} />
        </dd>

        {detail.hint && (
          <>
            <dt className="text-zinc-500 dark:text-zinc-400">{d.hint}</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">
              {dict.hint[HINT_KEY[detail.hint]]}
              <span className="ml-1 font-mono text-xs text-zinc-500">({detail.hint})</span>
            </dd>
          </>
        )}

        <dt className="text-zinc-500 dark:text-zinc-400">{d.size}</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">{formatBytes(detail.size)}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">{d.uploadedAt}</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">{formatTimestamp(detail.uploadedAt)}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">{d.contentType}</dt>
        <dd className="font-mono text-xs text-zinc-900 dark:text-zinc-100">
          {detail.contentType ?? d.unknownContentType}
        </dd>
      </dl>

      <section aria-labelledby="storage-object-references">
        <h3 id="storage-object-references" className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {d.references}
        </h3>
        {detail.references.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.noReferences}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.references.map((reference, index) => (
              <li
                key={`${reference.kind}-${index}`}
                className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <ReferenceDetail reference={reference} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="storage-object-preview">
        <h3 id="storage-object-preview" className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {d.preview}
        </h3>
        <StorageObjectPreview detail={detail} />
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {d.previewExpires(formatTimestamp(detail.downloadUrlExpiresAt))}
        </p>
      </section>
    </div>
  );
}

function ReferenceDetail({ reference }: { reference: StorageReference }) {
  const r = useDict().adminStorage.reference;
  const label = 'text-zinc-500 dark:text-zinc-400';
  const value = 'break-all text-zinc-900 dark:text-zinc-100';

  if (reference.kind === 'media') {
    return (
      <>
      <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-50">{r.kind.media}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className={label}>{r.topic}</dt>
        <dd className={value}>{reference.topic?.title ?? reference.topicId}</dd>
        <dt className={label}>{r.originalName}</dt>
        <dd className={value}>{reference.originalName}</dd>
        <dt className={label}>{r.uploader}</dt>
        <dd className={value}>{reference.uploader?.name ?? r.unknownUploader}</dd>
        <dt className={label}>{r.recordStatus}</dt>
        <dd className={value}>{r.mediaStatus[reference.status]}</dd>
      </dl>
      </>
    );
  }

  if (reference.kind === 'submission') {
    return (
      <>
      <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-50">{r.kind.submission}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className={label}>{r.submissionTitle}</dt>
        <dd className={value}>{reference.title}</dd>
        <dt className={label}>{r.topic}</dt>
        <dd className={value}>{reference.topic?.title ?? reference.topicId}</dd>
        <dt className={label}>{r.originalName}</dt>
        <dd className={value}>{reference.originalName}</dd>
        <dt className={label}>{r.author}</dt>
        <dd className={value}>{reference.author?.name ?? r.unknownUploader}</dd>
        <dt className={label}>{r.recordStatus}</dt>
        <dd className={value}>{r.submissionStatus[reference.status]}</dd>
      </dl>
      </>
    );
  }

  return (
    <>
    <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-50">
      {reference.kind === 'event-flyer' ? r.kind.eventFlyer : r.kind.eventFlyerDisplaced}
    </p>
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
      <dt className={label}>{r.event}</dt>
      <dd className={value}>{reference.title}</dd>
      {reference.flyerName && (
        <>
          <dt className={label}>{r.originalName}</dt>
          <dd className={value}>{reference.flyerName}</dd>
        </>
      )}
      <dt className={label}>{r.recordStatus}</dt>
      <dd className={value}>{r.flyerStatus[reference.flyerStatus]}</dd>
    </dl>
    </>
  );
}
