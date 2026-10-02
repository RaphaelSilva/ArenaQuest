'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import {
  AdminStorageApiError,
  deleteConflictOf,
  type ClassifiedObject,
  type StorageDeleteConflict,
  type StorageDeleteResponse,
} from '@web/lib/admin-storage-api';
import { StorageStatusBadge } from './storage-status-badge';
import { STATUS_KEY, formatBytes } from './storage-format';

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type Phase =
  | { kind: 'confirm' }
  | { kind: 'deleting' }
  | { kind: 'conflict'; conflict: StorageDeleteConflict }
  | { kind: 'error' };

export type StorageDeleteDialogProps = {
  object: ClassifiedObject;
  onClose: () => void;
  /** The object is gone from the bucket; the dialog is expected to close. */
  onDeleted: (result: StorageDeleteResponse) => void;
  /** `404`: the object was already removed by someone else. */
  onGone: (key: string) => void;
  /** `409`: the server's current classification, to refresh the row with. */
  onConflict: (object: ClassifiedObject) => void;
};

/**
 * Explicit confirmation before removing one object (RFC 0018 §6). Modal,
 * focus-trapped, Escape closes, focus starts on *Cancel*. It repeats the key,
 * size and status, and on `409` shows why the server refused, derived from the
 * classification it returned — so the UI never contradicts the server.
 *
 * It sits above the object drawer, so its key handler runs in the capture
 * phase and stops Escape/Tab from also reaching the drawer's own handler.
 */
export function StorageDeleteDialog({ object, onClose, onDeleted, onGone, onConflict }: StorageDeleteDialogProps) {
  const dict = useDict().adminStorage;
  const d = dict.delete;
  const client = useApiClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busy = phase.kind === 'deleting';

  // Latest handlers without re-running the focus effect.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !containerRef.current) return;
      event.stopPropagation();
      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
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
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const confirm = async () => {
    setPhase({ kind: 'deleting' });
    try {
      const result = await client.adminStorage.deleteObject(object.key);
      onDeleted(result);
    } catch (error: unknown) {
      const conflict = deleteConflictOf(error);
      if (conflict) {
        setPhase({ kind: 'conflict', conflict });
        onConflict(conflict.object);
        return;
      }
      if (error instanceof AdminStorageApiError && error.status === 404) {
        onGone(object.key);
        return;
      }
      setPhase({ kind: 'error' });
    }
  };

  // Keep focus inside the dialog once the confirm button disappears.
  useEffect(() => {
    if (phase.kind === 'conflict' || phase.kind === 'error') cancelRef.current?.focus();
  }, [phase.kind]);

  const shown = phase.kind === 'conflict' ? phase.conflict.object : object;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="storage-delete-dialog-title"
        aria-describedby="storage-delete-dialog-description"
        className="relative flex w-full max-w-md flex-col gap-4 rounded-lg bg-white p-5 shadow-2xl dark:bg-zinc-900"
      >
        <h2 id="storage-delete-dialog-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {d.title}
        </h2>
        <p id="storage-delete-dialog-description" className="text-sm text-zinc-600 dark:text-zinc-400">
          {d.description}
        </p>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-zinc-500 dark:text-zinc-400">{dict.drawer.key}</dt>
          <dd className="break-all font-mono text-xs text-zinc-900 dark:text-zinc-100">{shown.key}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">{dict.drawer.size}</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">{formatBytes(shown.size)}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">{dict.drawer.status}</dt>
          <dd data-testid="delete-dialog-status">
            <StorageStatusBadge status={shown.status} stale={shown.stale} />
          </dd>
        </dl>

        <div role="status" aria-live="polite" className="text-sm">
          {phase.kind === 'deleting' && (
            <span className="inline-flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <Spinner className="h-4 w-4" />
              {d.deleting}
            </span>
          )}
          {phase.kind === 'conflict' && (
            <span className="block rounded-md bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
              <span className="block font-medium">{d.refused}</span>
              <RefusalReason conflict={phase.conflict} />
            </span>
          )}
          {phase.kind === 'error' && (
            <span className="block rounded-md bg-red-50 px-3 py-2 text-red-800 dark:bg-red-900/30 dark:text-red-200">
              {d.error}
            </span>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {phase.kind === 'conflict' ? d.close : d.cancel}
          </button>
          {phase.kind !== 'conflict' && (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-60"
            >
              {d.confirm}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Human reason for a `409`, from the refusal code and the returned classification. */
function RefusalReason({ conflict }: { conflict: StorageDeleteConflict }) {
  const dict = useDict().adminStorage;
  const r = dict.delete.reason;
  const { object } = conflict;

  let text: string;
  if (conflict.reason === 'within-grace-window') {
    text = r.tooRecent;
  } else {
    const reference = object.references[0];
    if (reference?.kind === 'media') text = r.linkedToTopic(reference.topic?.title ?? reference.topicId);
    else if (reference?.kind === 'submission') text = r.linkedToSubmission(reference.title);
    else if (reference) text = r.linkedToEvent(reference.title);
    else text = r.nowStatus(dict.status[STATUS_KEY[object.status]]);
  }
  return <span className="block">{text}</span>;
}
