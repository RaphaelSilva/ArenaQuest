/**
 * Centralized fetch wrapper that handles 401 responses by attempting
 * a silent token refresh and retrying the original request.
 *
 * Key behaviors:
 * - On 401: call refreshFn() once, retry if successful
 * - Concurrent 401s: only one refresh is issued (via in-flight promise)
 * - Refresh failures: call onSessionExpired() callback
 * - Non-401 errors: return as-is
 */

let refreshPromise: Promise<string | null> | null = null;

export interface FetchWithAuthOptions extends RequestInit {
  /** Skip 401 handling for refresh requests themselves */
  isRefreshRequest?: boolean;
}

/**
 * Fetch wrapper with 401 interception and automatic token refresh.
 *
 * @param url - Request URL
 * @param options - Fetch options (may include isRefreshRequest flag)
 * @param accessToken - Current access token
 * @param refreshFn - Async function that returns new token or null on failure
 * @param onTokenUpdate - Callback to store the new token in context
 * @param onSessionExpired - Callback to handle session expiry (clear state, redirect)
 */
export async function fetchWithAuth(
  url: string,
  options: FetchWithAuthOptions,
  accessToken: string | null,
  refreshFn: () => Promise<string | null>,
  onTokenUpdate: (token: string) => void,
  onSessionExpired: () => void,
): Promise<Response> {
  // Initial fetch with current token
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // If not a 401 or already a refresh request, return as-is
  if (response.status !== 401 || options.isRefreshRequest) {
    return response;
  }

  // Handle concurrent 401s: reuse in-flight refresh if one exists
  if (!refreshPromise) {
    refreshPromise = refreshFn().finally(() => {
      refreshPromise = null;
    });
  }

  const newToken = await refreshPromise;

  // If refresh failed, call onSessionExpired and return original 401
  if (!newToken) {
    onSessionExpired();
    return response;
  }

  // Token was refreshed: update context and retry
  onTokenUpdate(newToken);

  // Retry the original request with the new token
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${newToken}`,
    },
  });
}
