'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { AdminStorageApiError } from '@web/lib/admin-storage-api';
import type { StorageObjectState } from './storage-object-drawer';

/**
 * Fetches `/object` for the selected key. Each open asks again, so the
 * presigned preview URL (valid for 5 minutes) is always fresh.
 */
export function useStorageObject(key: string | null) {
  const client = useApiClient();
  const [attempt, setAttempt] = useState(0);
  // The settled result, tagged with the request it answers. Anything that does
  // not match the current key/attempt reads as loading, so no effect has to
  // reset the state synchronously.
  const [result, setResult] = useState<{ token: string; state: StorageObjectState } | null>(null);
  const token = `${attempt}:${key ?? ''}`;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    client.adminStorage
      .getObject(key)
      .then((detail) => {
        if (!cancelled) setResult({ token, state: { status: 'ready', detail } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const notFound = error instanceof AdminStorageApiError && error.status === 404;
        setResult({ token, state: { status: notFound ? 'not-found' : 'error' } });
      });
    return () => {
      cancelled = true;
    };
  }, [client, key, token]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const state: StorageObjectState =
    result && result.token === token ? result.state : { status: 'loading' };

  return { state, retry };
}
