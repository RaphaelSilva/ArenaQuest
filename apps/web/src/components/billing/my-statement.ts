'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useApiClient } from '@web/context/auth-context';
import type { MyBillingStatement } from '@web/lib/me-billing-api';

/**
 * The student's own statement, read **once** for the whole application shell.
 *
 * The standing notice in the protected layout and the dashboard's *payment due*
 * card describe the same `GET /v1/me/billing` answer. Each of them reading it
 * on its own would double the request on every dashboard load, so both
 * subscribe here: the first subscriber starts the read, every later one joins
 * it, and a quiet `refresh()` after a pay action reaches all of them.
 *
 * The store is keyed on the API client instance and lives only while someone
 * is subscribed — when the last reader unmounts (a sign-out unmounts the
 * shell) the statement is dropped, so nothing outlives the session it was
 * read for.
 *
 * A statement that cannot be read is `null`, exactly like one still loading:
 * nobody here turns a billing read into an error state. A **refresh** that
 * fails keeps the statement already on screen.
 */

type StatementSource = { meBilling: { getMyStatement(): Promise<MyBillingStatement> } };

type Store = {
  statement: MyBillingStatement | null;
  /** Bumped by every read and by the reset, so a superseded answer is ignored. */
  generation: number;
  started: boolean;
  listeners: Set<() => void>;
};

const stores = new WeakMap<object, Store>();

function storeFor(client: object): Store {
  let store = stores.get(client);
  if (!store) {
    store = { statement: null, generation: 0, started: false, listeners: new Set() };
    stores.set(client, store);
  }
  return store;
}

function read(client: StatementSource, store: Store): void {
  const generation = ++store.generation;
  store.started = true;
  void (async () => {
    let next: MyBillingStatement | null;
    try {
      next = await client.meBilling.getMyStatement();
    } catch {
      // The first read failing leaves `null`; a refresh failing leaves what
      // was there.
      next = store.statement;
    }
    if (store.generation !== generation || store.statement === next) return;
    store.statement = next;
    for (const listener of store.listeners) listener();
  })();
}

function subscribe(client: StatementSource, listener: () => void): () => void {
  const store = storeFor(client);
  store.listeners.add(listener);
  if (!store.started) read(client, store);
  return () => {
    store.listeners.delete(listener);
    // Deferred, so an immediate re-subscribe (a development double-mount, a
    // sibling mounting in the same commit) keeps the read it already has.
    queueMicrotask(() => {
      if (store.listeners.size > 0) return;
      store.generation += 1;
      store.started = false;
      store.statement = null;
    });
  };
}

const serverSnapshot = (): MyBillingStatement | null => null;

export type SharedStatement = {
  /** `null` while loading and when the statement could not be read. */
  statement: MyBillingStatement | null;
  /** Re-reads the statement for every subscriber, keeping the current one on screen meanwhile. */
  refresh: () => void;
};

export function useMyStatement(): SharedStatement {
  const client = useApiClient() as StatementSource;

  const subscribeToClient = useCallback(
    (listener: () => void) => subscribe(client, listener),
    [client],
  );
  const snapshot = useCallback(() => storeFor(client).statement, [client]);
  const statement = useSyncExternalStore(subscribeToClient, snapshot, serverSnapshot);

  const refresh = useCallback(() => {
    const store = storeFor(client);
    if (store.listeners.size > 0) read(client, store);
  }, [client]);

  return { statement, refresh };
}
