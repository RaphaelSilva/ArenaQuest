'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ScanStatus = 'idle' | 'running' | 'stopped' | 'done' | 'error';

export type ScanPage<T> = {
  items: T[];
  scanned: number;
  nextCursor?: string;
};

export type ScanPageFetcher<T> = (cursor: string | undefined, signal: AbortSignal) => Promise<ScanPage<T>>;

type ScanState<T> = {
  status: ScanStatus;
  items: T[];
  /** Sum of `scanned` over every page received in this run. */
  scanned: number;
  /**
   * The cursor the next page is requested with — the one the last good page
   * returned (`undefined` before the first page). "Retry" resumes from it.
   */
  resumeCursor: string | undefined;
};

const idle = <T,>(): ScanState<T> => ({ status: 'idle', items: [], scanned: 0, resumeCursor: undefined });

/**
 * Drives a stateless, cursor-paged audit from the browser (RFC 0018 §5).
 *
 * One request in flight at a time: the loop only asks for the next page after
 * the previous one settled, and only while the server still returns a
 * `nextCursor`. `stop()` aborts the in-flight request and issues nothing more;
 * a failed page keeps what was accumulated and `retry()` resumes from the last
 * good cursor. Results live in component state only — nothing is persisted.
 */
export function useStorageScan<T>(fetchPage: ScanPageFetcher<T>) {
  const [state, setState] = useState<ScanState<T>>(idle);
  // Latest fetcher without restarting anything when its identity changes.
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  }, [fetchPage]);

  // Every run gets an id; a settled request whose run is no longer current is
  // ignored, so a stopped or superseded run can never write state.
  const runId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const halt = useCallback(() => {
    runId.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  const run = useCallback(
    async (from: string | undefined) => {
      halt();
      const id = runId.current;
      const abort = new AbortController();
      controller.current = abort;
      setState((current) => ({ ...current, status: 'running' }));

      let cursor = from;
      for (;;) {
        let page: ScanPage<T>;
        try {
          page = await fetchRef.current(cursor, abort.signal);
        } catch {
          if (id !== runId.current || abort.signal.aborted) return;
          controller.current = null;
          setState((current) => ({ ...current, status: 'error' }));
          return;
        }
        if (id !== runId.current) return;

        const next = page.nextCursor;
        setState((current) => ({
          status: next ? 'running' : 'done',
          items: page.items.length > 0 ? [...current.items, ...page.items] : current.items,
          scanned: current.scanned + page.scanned,
          resumeCursor: next,
        }));
        if (!next) {
          controller.current = null;
          return;
        }
        cursor = next;
      }
    },
    [halt],
  );

  /** A fresh run from the start of the bucket; earlier results are cleared. */
  const start = useCallback(() => {
    halt();
    setState(idle);
    void run(undefined);
  }, [halt, run]);

  const stop = useCallback(() => {
    halt();
    setState((current) => (current.status === 'running' ? { ...current, status: 'stopped' } : current));
  }, [halt]);

  /** Re-requests the page that failed; accumulated results are kept. */
  const retry = useCallback(() => {
    void run(state.resumeCursor);
  }, [run, state.resumeCursor]);

  /** Drops the results without starting anything (used when the other scan starts). */
  const reset = useCallback(() => {
    halt();
    setState(idle);
  }, [halt]);

  // Leaving the page stops the run.
  useEffect(() => halt, [halt]);

  return { ...state, start, stop, retry, reset };
}
