# API Client Architecture

This document defines the canonical pattern for all backend communication in the web frontend (`apps/web`).

## Layer diagram

```
┌─────────────────────────────────────────────────────────┐
│  (auth) pages — login, register, activate, reset, forgot │
│  auth-context.tsx — login / logout / refresh             │
└───────────────────────┬─────────────────────────────────┘
                        │ import authApi
                        ▼
              ┌─────────────────────┐
              │    auth-api.ts      │  ← direct fetch, credentials: 'include'
              │  no Authorization   │     pre-session; intentionally bypasses ApiClient
              └─────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  (protected) components, pages, hooks                    │
└───────────────────────┬─────────────────────────────────┘
                        │ useApiClient()
                        ▼
              ┌─────────────────────┐
              │    api-client.ts    │  ← ApiClient class, domain-grouped getters
              │  createFetchTransport│     token injected from auth context
              └───────────────────┬─┘
                                  │
                                  ▼
                   ┌──────────────────────────┐
                   │    fetch-with-auth.ts    │  ← raw fetch + 401→refresh→retry
                   │   single-flight refresh  │     Authorization header injection
                   └──────────────────────────┘
```

---

## Files and their roles

### `src/lib/fetch-with-auth.ts`

Low-level fetch primitive. Responsibilities:
- Injects `Authorization: Bearer <token>` on every request.
- On 401: calls `refreshFn()` once, retries the original request with the new token.
- Concurrent 401s: coalesces multiple in-flight refreshes into one via a shared promise.
- On refresh failure: calls `onSessionExpired()` and returns the original 401 response.

**Import rule:** imported **only** by `api-client.ts`. Nothing else should touch it directly.

### `src/lib/api-client.ts`

`ApiClient` class and `createFetchTransport` factory. Responsibilities:
- Wraps `fetchWithAuth` into the `HttpTransport` interface.
- Exposes domain-grouped namespaces as getters (`topics`, `account`, `comments`, `tasks`, …).
- Instantiated once per auth session in `auth-context.tsx`; exposed to components via `useApiClient()`.

**Import rule:** domain modules (`*-api.ts`) import `HttpTransport` from this file. Components never import `ApiClient` directly — they call `useApiClient()`.

### `src/lib/*-api.ts` domain modules

One file per backend domain area. Each exports a `createXxxApi(http: HttpTransport)` factory and an `XxxApiError` class. Responsibilities:
- Map business arguments to HTTP calls through `HttpTransport`.
- Own the DTO types for their domain (promote to `packages/shared` when shared with the API).
- Define a typed error code union so callers can discriminate failure modes.

**Import rule:** domain modules accept `HttpTransport` and nothing else — no token, no `API_URL`, no `fetch`.

Current domain modules:

| File | `ApiClient` getter | Endpoints covered |
|---|---|---|
| `topics-api.ts` | `client.topics` | `/topics/*`, `/me/progress/topics` |
| `tasks-api.ts` | `client.tasks` | `/tasks/*` |
| `account-api.ts` | `client.account` | `/account/*`, `/me/badges` |
| `comments-api.ts` | `client.comments` | `/topics/{id}/comments`, `/comments/{id}/like` |
| `dashboard-api.ts` | `client.dashboard` | `/dashboard` |
| `progress-api.ts` | `client.progress` | `/me/progress/*` |
| `admin-topics-api.ts` | `client.adminTopics` | `/admin/topics/*` |
| `admin-tasks-api.ts` | `client.adminTasks` | `/admin/tasks/*` |
| `admin-users-api.ts` | `client.adminUsers` | `/admin/users/*` |
| `admin-media-api.ts` | `client.adminMedia` | `/admin/media/*` |
| `admin-enrollment-api.ts` | `client.adminEnrollment` | `/admin/enrollment/*` |

### `src/lib/auth-api.ts`

**Intentional exception.** Handles the pre-session auth flow. Responsibilities:
- `login`, `register`, `logout`, `refresh`, `activate`, `forgotPassword`, `resetPassword`.
- Uses raw `fetch` with `credentials: 'include'` (cookie-based refresh token); no `Authorization` header.

**Why it bypasses ApiClient:** the `refresh` path is called by `fetchWithAuth` itself when a 401 is encountered. If `refresh` went through `ApiClient` → `fetchWithAuth`, a 401 on the refresh call would trigger another refresh, creating infinite recursion.

**Import rule:** imported only by `auth-context.tsx` and `(auth)` pages. Never import it from `(protected)` pages or components.

---

## Consuming the client

### In Client Components

```tsx
'use client';
import { useApiClient } from '@web/context/auth-context';

export function MyComponent() {
  const client = useApiClient();

  useEffect(() => {
    client.topics.list().then(setTopics);
  }, [client]);
}
```

### Adding a new endpoint

1. Identify the domain file (`src/lib/*-api.ts`). Create one if the domain is new.
2. Add the method to the `createXxxApi` factory. Accept only business arguments — no token, no URL.
3. Define or extend the `XxxApiError` class with at least: `Unauthorized`, `NetworkError`, `Unknown`.
4. If the domain file is new, register a getter on `ApiClient` in `api-client.ts`.
5. Write tests in `src/lib/__tests__/*-api.test.ts` covering: success, 401 → `Unauthorized`, network throw → `NetworkError`.

### Testing components that call the client

Mock `useApiClient` at the module boundary — do not mock `global.fetch`:

```ts
vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({
      comments: {
        createForTopic: mockCreateForTopic,
        toggleLike: mockToggleLike,
      },
    }),
  };
});
```

---

## Non-negotiable invariants

- **No direct `fetch` in components.** Every call to the backend from `(protected)` code goes through `useApiClient()`.
- **No manual `Authorization` headers.** Token injection is the responsibility of `fetchWithAuth`; components and domain modules never build auth headers.
- **No `NEXT_PUBLIC_API_URL` in components.** Only `api-client.ts`, `auth-api.ts`, and `fetch-with-auth.ts` read this variable.
- **`auth-api.ts` stays isolated.** It is the only legitimate exception to the rules above. It must never be imported from `(protected)` code.

### Static checks (run in CI or locally)

```bash
# No direct fetch with API_URL or NEXT_PUBLIC_API_URL outside auth files
grep -rn 'fetch(`${API_URL}\|process.env.NEXT_PUBLIC_API_URL' \
  apps/web/src --include="*.ts" --include="*.tsx"
# Expected: matches only in auth-api.ts, api-client.ts, fetch-with-auth.ts

# No manual Bearer header outside auth files
grep -rn 'Bearer ${accessToken}\|Bearer ${token}' \
  apps/web/src --include="*.ts" --include="*.tsx"
# Expected: matches only in auth-api.ts, fetch-with-auth.ts
```
