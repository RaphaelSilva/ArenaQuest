import type { IAuthAdapter, VerifiedToken } from '@arenaquest/shared/ports';

// Augments Hono's global ContextVariableMap so c.get/c.set are typed
// everywhere without repeating generic parameters on every Hono instance.
declare module 'hono' {
  interface ContextVariableMap {
    /** Injected once per request by the setup middleware in index.ts. */
    auth: IAuthAdapter;
    /** Injected by authGuard after the access token is verified. */
    user: VerifiedToken;
  }
}
