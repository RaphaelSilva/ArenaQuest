'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Button } from '@web/components/design-system';
import { AdminMediaApiError, type Media } from '@web/lib/admin-media-api';
import type { TopicNode } from '@web/lib/admin-topics-api';

/** One target in the picker, in tree order, with its depth for the indent. */
export type MediaMoveTarget = { id: string; title: string; depth: number };

type TreeTopic = Pick<TopicNode, 'id' | 'parentId' | 'title' | 'order' | 'archived' | 'status'>;

/**
 * The backoffice topics in tree order (siblings by `order`), each with its
 * depth, minus `currentTopicId` and archived topics. Mirrors `moveTargets` from
 * the submissions `MoveDialog`, typed for the admin `TopicNode`. A topic whose
 * parent is missing (or archived) becomes a root, so nothing is dropped.
 */
export function mediaMoveTargets(topics: readonly TreeTopic[], currentTopicId: string): MediaMoveTarget[] {
  const live = topics.filter((topic) => !topic.archived && topic.status !== 'archived');
  const ids = new Set(live.map((topic) => topic.id));
  const children = new Map<string | null, TreeTopic[]>();
  for (const topic of live) {
    const parent = topic.parentId && ids.has(topic.parentId) ? topic.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(topic);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  const out: MediaMoveTarget[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const topic of children.get(parent) ?? []) {
      if (visited.has(topic.id)) continue;
      visited.add(topic.id);
      if (topic.id !== currentTopicId) out.push({ id: topic.id, title: topic.title, depth });
      walk(topic.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

type MoveMediaDialogProps = {
  topicId: string;
  media: Pick<Media, 'id' | 'originalName'>;
  /** The topic tree the page already holds; no fetch happens here. */
  topics: readonly TreeTopic[];
  /** Called after the server moved the item, with the destination's title. */
  onMoved: (targetTitle: string) => void;
  onClose: () => void;
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Modal confirm for moving one ready media item to another topic. Focus starts
 * on *Cancel*, stays inside the dialog and Escape closes it (unless a request
 * is in flight). Errors keep it open with the message for the server's answer.
 */
export function MoveMediaDialog({ topicId, media, topics, onMoved, onClose }: MoveMediaDialogProps) {
  const dict = useDict();
  const t = dict.admin.topics.media.move;
  const client = useApiClient();
  const ids = { heading: useId(), picker: useId() };
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const targets = useMemo(
    () => mediaMoveTargets(topics, topicId).filter((target) => !removed.has(target.id)),
    [topics, topicId, removed],
  );
  const [targetId, setTargetId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = targets.find((target) => target.id === targetId) ?? null;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!moving) onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const errorMessage = (err: unknown, target: MediaMoveTarget): string => {
    if (!(err instanceof AdminMediaApiError)) return t.errors.generic;
    if (err.status === 409) return t.errors.notReady;
    if (err.status === 403) return t.errors.forbidden;
    if (err.status === 400 && err.code === 'SameTopic') return t.errors.sameTopic;
    if (err.status === 404) {
      if (err.detail === 'target topic not found') {
        setRemoved((prev) => new Set(prev).add(target.id));
        setTargetId(null);
        return t.errors.targetGone;
      }
      return t.errors.mediaGone;
    }
    return t.errors.generic;
  };

  const submit = async () => {
    if (!selected) return;
    setMoving(true);
    setError(null);
    try {
      await client.adminMedia.move(topicId, media.id, selected.id);
      onMoved(selected.title);
    } catch (err) {
      setError(errorMessage(err, selected));
      setMoving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !moving) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.heading}
        onKeyDown={onKeyDown}
        className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900"
      >
        <h2 id={ids.heading} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {t.heading}
        </h2>
        <p className="mt-1 break-words text-sm text-zinc-600 dark:text-zinc-400">{t.itemLabel(media.originalName)}</p>

        {targets.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{t.noTargets}</p>
        ) : (
          <fieldset className="mt-4 min-h-0 flex-1 overflow-hidden">
            <legend id={ids.picker} className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {t.pickerLabel}
            </legend>
            <ul className="max-h-[40dvh] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              {targets.map((target) => (
                <li key={target.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <label
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/50"
                    style={{ paddingLeft: `calc(0.75rem + ${target.depth} * 1rem)` }}
                  >
                    <input
                      type="radio"
                      name={ids.picker}
                      value={target.id}
                      checked={targetId === target.id}
                      disabled={moving}
                      onChange={() => {
                        setTargetId(target.id);
                        setError(null);
                      }}
                    />
                    <span className="min-w-0 flex-1 break-words">{target.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {selected && (
          <p className="mt-3 break-words text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {t.destination(selected.title)}
          </p>
        )}

        <div role="status" aria-live="polite" className="mt-3 text-sm">
          {error ? (
            <span className="font-medium text-red-600 dark:text-red-400">{error}</span>
          ) : moving ? (
            <span className="text-zinc-500 dark:text-zinc-400">{t.moving}</span>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <Button ref={cancelRef} type="button" variant="secondary" size="md" onClick={onClose} disabled={moving}>
            {t.cancel}
          </Button>
          <Button type="button" variant="primary" size="md" onClick={submit} disabled={!selected || moving} isLoading={moving}>
            {moving ? t.moving : t.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
