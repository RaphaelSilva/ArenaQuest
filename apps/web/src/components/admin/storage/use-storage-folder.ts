'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';
import type { ClassifiedObject, StorageFolder } from '@web/lib/admin-storage-api';

type FolderState = {
  prefix: string;
  folders: StorageFolder[];
  objects: ClassifiedObject[];
  nextCursor: string | null;
  status: 'loading' | 'error' | 'ready';
  loadingMore: boolean;
};

const initial = (prefix: string): FolderState => ({
  prefix,
  folders: [],
  objects: [],
  nextCursor: null,
  status: 'loading',
  loadingMore: false,
});

/**
 * Browse state for one folder of the bucket: the pages accumulated so far and
 * the cursor for the next one. Pagination continues strictly on `nextCursor`
 * — a short page that still carries a cursor is not the end.
 *
 * `titles` collects the owner title of every folder row seen, keyed by prefix,
 * so the breadcrumb can label `topics/<id>/` with the topic's title.
 */
export function useStorageFolder(enabled: boolean) {
  const client = useApiClient();
  const [state, setState] = useState<FolderState>(() => initial(''));
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(() => new Map());
  // Guards against a slow response for a folder the admin already left.
  const requestId = useRef(0);

  const rememberTitles = useCallback((folders: StorageFolder[]) => {
    const owned = folders.filter((folder) => folder.owner);
    if (owned.length === 0) return;
    setTitles((previous) => {
      const next = new Map(previous);
      for (const folder of owned) next.set(folder.prefix, folder.owner!.title);
      return next;
    });
  }, []);

  /** Fetches the first page of `prefix`; state is only written after the await. */
  const fetchFirstPage = useCallback(
    async (prefix: string) => {
      const id = ++requestId.current;
      try {
        const page = await client.adminStorage.browse({ prefix });
        if (id !== requestId.current) return;
        rememberTitles(page.folders);
        setState({
          prefix,
          folders: page.folders,
          objects: page.objects,
          nextCursor: page.nextCursor ?? null,
          status: 'ready',
          loadingMore: false,
        });
      } catch {
        if (id !== requestId.current) return;
        setState((current) => ({ ...current, status: 'error' }));
      }
    },
    [client, rememberTitles],
  );

  const navigate = useCallback(
    (prefix: string) => {
      setState(initial(prefix));
      return fetchFirstPage(prefix);
    },
    [fetchFirstPage],
  );

  const loadMore = useCallback(async () => {
    const { prefix, nextCursor } = state;
    if (!nextCursor || state.loadingMore) return;
    const id = requestId.current;
    setState((current) => ({ ...current, loadingMore: true }));
    try {
      const page = await client.adminStorage.browse({ prefix, cursor: nextCursor });
      if (id !== requestId.current) return;
      rememberTitles(page.folders);
      setState((current) => ({
        ...current,
        folders: [...current.folders, ...page.folders],
        objects: [...current.objects, ...page.objects],
        nextCursor: page.nextCursor ?? null,
        loadingMore: false,
      }));
    } catch {
      if (id !== requestId.current) return;
      setState((current) => ({ ...current, loadingMore: false, status: 'error' }));
    }
  }, [client, rememberTitles, state]);

  /** Drops a deleted object from the pages loaded so far. */
  const removeObject = useCallback((key: string) => {
    setState((current) => ({ ...current, objects: current.objects.filter((o) => o.key !== key) }));
  }, []);

  /** Swaps in the server's current classification for an object already listed. */
  const replaceObject = useCallback((object: ClassifiedObject) => {
    setState((current) => ({
      ...current,
      objects: current.objects.map((o) => (o.key === object.key ? object : o)),
    }));
  }, []);

  // The initial state is already the loading root, so the first fetch needs no
  // reset; every write happens after the await.
  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await fetchFirstPage('');
    })();
  }, [enabled, fetchFirstPage]);

  return {
    ...state,
    titles,
    navigate,
    reload: () => navigate(state.prefix),
    loadMore,
    removeObject,
    replaceObject,
  };
}
