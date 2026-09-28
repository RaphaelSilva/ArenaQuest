'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotePage } from '@web/lib/notes-api';

export type NotePagesState = 'loading' | 'ready' | 'error';

export type NotePages<T> = {
  items: T[];
  state: NotePagesState;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  loadMore: () => void;
  reload: () => void;
  /** Merges `patch` into the loaded item with this id, in place (no refetch). */
  update: (id: string, patch: Partial<T>) => void;
};

/**
 * Cursor pagination over a notes list: the first page on mount, then one
 * page per `loadMore`, appended in the order the API returns them.
 * `fetchPage` must be stable (memoised) — a new identity restarts the list.
 */
export function useNotePages<T extends { id: string }>(fetchPage: (cursor: string | null) => Promise<NotePage<T>>): NotePages<T> {
  const [items, setItems] = useState<T[]>([]);
  const [state, setState] = useState<NotePagesState>('loading');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // Ignores responses from a superseded load (a reload, or a new fetchPage).
  const generation = useRef(0);

  const reload = useCallback(() => {
    const gen = ++generation.current;
    setState('loading');
    setItems([]);
    setCursor(null);
    setLoadMoreFailed(false);
    setLoadingMore(false);
    fetchPage(null).then(
      (page) => {
        if (gen !== generation.current) return;
        setItems(page.data);
        setCursor(page.nextCursor);
        setState('ready');
      },
      () => {
        if (gen !== generation.current) return;
        setState('error');
      },
    );
  }, [fetchPage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch is the canonical use case
    reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    fetchPage(cursor).then(
      (page) => {
        if (gen !== generation.current) return;
        setItems((prev) => [...prev, ...page.data]);
        setCursor(page.nextCursor);
        setLoadingMore(false);
      },
      () => {
        if (gen !== generation.current) return;
        setLoadingMore(false);
        setLoadMoreFailed(true);
      },
    );
  }, [cursor, fetchPage, loadingMore]);

  const update = useCallback((id: string, patch: Partial<T>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  return { items, state, hasMore: cursor !== null, loadingMore, loadMoreFailed, loadMore, reload, update };
}
