/**
 * Cross-tab session signalling.
 *
 * The access token lives only in each tab's memory, so a logout in one tab
 * leaves every other tab working until its token expires (up to 15 min). The
 * tab that changes the session announces it here and the others react:
 *
 *   logout → drop the in-memory session (the protected layout redirects).
 *   login  → restore the session from the refresh cookie the login just set.
 *
 * A BroadcastChannel never delivers a message back to the instance that sent
 * it, so a tab does not react to its own announcement. Browsers without
 * BroadcastChannel get a no-op: they keep the old behaviour (the other tab
 * notices at its next refresh) rather than failing.
 */

export const AUTH_CHANNEL_NAME = 'arenaquest:auth';

export type AuthBroadcastMessage = { type: 'login' } | { type: 'logout' };

export interface AuthBroadcast {
  post(message: AuthBroadcastMessage): void;
  close(): void;
}

function isAuthMessage(data: unknown): data is AuthBroadcastMessage {
  if (typeof data !== 'object' || data === null) return false;
  const type = (data as { type?: unknown }).type;
  return type === 'login' || type === 'logout';
}

export function openAuthBroadcast(onMessage: (message: AuthBroadcastMessage) => void): AuthBroadcast {
  if (typeof BroadcastChannel === 'undefined') {
    return { post() {}, close() {} };
  }

  const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent) => {
    if (isAuthMessage(event.data)) onMessage(event.data);
  };

  return {
    post(message) {
      try {
        channel.postMessage(message);
      } catch {
        // A closed channel (provider unmounting mid-logout) is not an error worth surfacing.
      }
    },
    close() {
      channel.onmessage = null;
      channel.close();
    },
  };
}
