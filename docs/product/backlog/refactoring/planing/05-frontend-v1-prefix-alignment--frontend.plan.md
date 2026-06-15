# Plan — 05-frontend-v1-prefix-alignment--frontend

**Task:** [05-frontend-v1-prefix-alignment--frontend.task.md](../05-frontend-v1-prefix-alignment--frontend.task.md)
**Source:** Backlog | Refactoring
**Assigned personas:** frontend-developer
**Branch:** feature/backlog/refactoring/05-frontend-v1-prefix-alignment--frontend.task

## Objective

The API already serves every business route under `/v1`, but the web app still passes un-prefixed paths to the transport (`/topics`, `/auth/login`, …), relying on a backward-compat shim in `apps/api/src/index.ts` that rewrites them. This plan centralizes the `/v1` prefix in the transport layer once, fixes several pre-existing path-structure bugs discovered during the audit (routes that the shim could never rescue), and adopts generated types from `api-types.gen.ts` for the public catalog and auth modules.

## Affected areas

**Modified files:**
- `apps/web/src/lib/api-client.ts` — add `/v1` constant, prepend in transport
- `apps/web/src/lib/auth-api.ts` — add `/v1` prefix to all standalone fetch calls; adopt `components['schemas']['LoginResponse']` from gen types
- `apps/web/src/app/(auth)/login/page.tsx` — fix OAuth anchor path
- `apps/web/src/lib/topics-api.ts` — fix path structure bugs (`visit`, `complete`); adopt `components['schemas']['TopicNode']`
- `apps/web/src/lib/comments-api.ts` — fix `toggleLike` path structure bug (`/comments/` → `/me/comments/`)
- `apps/web/src/lib/tasks-api.ts` — fix `checkIn` path structure bug (`/tasks/.../check-in` → `/me/tasks/.../check-in`)
- `apps/web/src/lib/account-api.ts` — fix `changePassword` path structure bug (`/account/change-password` → `/me/change-password`)
- `apps/web/src/lib/admin-topics-api.ts` — no path changes needed (all correct `/admin/...`); no type changes
- `apps/web/src/lib/admin-tasks-api.ts` — no path changes needed
- `apps/web/src/lib/admin-users-api.ts` — no path changes needed
- `apps/web/src/lib/admin-media-api.ts` — no path changes needed
- `apps/web/src/lib/admin-enrollment-api.ts` — no path changes needed
- `apps/web/src/lib/progress-api.ts` — no path changes needed (already uses `/me/progress/...`)
- `apps/web/src/lib/dashboard-api.ts` — no path changes needed (already uses `/me/dashboard`, `/leaderboard`, `/topics`, `/me/progress/topics`)
- `apps/web/.env.example` — clarify base-URL convention comment
- `apps/web/src/lib/__tests__/comments-api.test.ts` — update `toggleLike` path expectation
- `apps/web/src/lib/__tests__/topics-api.test.ts` — no change needed (markVideoWatched path unchanged)
- `apps/web/src/lib/__tests__/account-api.test.ts` — no change needed (tests getBadges only)

**New files:** none

**Out of scope:** any `apps/api` change, UI/UX changes, regenerating `api-types.gen.ts`

## Path-structure bugs discovered (pre-existing, must fix together with prefix)

The legacy shim rewrites `startsWith('/auth|/me|/admin|/topics|/tasks|/leaderboard|/catalog')` — it prepends `/v1` but cannot change path structure. The following web paths would still break even after the shim removal because they call the wrong path segments:

| File | Current path | Correct path (API actual) | Why broken |
|---|---|---|---|
| `topics-api.ts:37` | `/topics/${id}/visit` | `/me/topics/${id}/visit` | Mounted at `/v1/me/topics/{id}/visit` |
| `topics-api.ts:55` | `/topics/${id}/complete` | `/me/topics/${id}/complete` | Mounted at `/v1/me/topics/{id}/complete` |
| `tasks-api.ts:53` | `/tasks/${taskId}/stages/${stageId}/check-in` | `/me/tasks/${taskId}/stages/${stageId}/check-in` | Mounted at `/v1/me/tasks/{id}/stages/{stageId}/check-in` |
| `comments-api.ts:59` | `/comments/${commentId}/like` | `/me/comments/${commentId}/like` | Mounted at `/v1/me/comments/{id}/like`; shim doesn't rewrite `/comments` |
| `account-api.ts:36` | `/account/change-password` | `/me/change-password` | Shim doesn't rewrite `/account`; API has no such route |

## Step-by-step

### Frontend

1. **`api-client.ts` — add single-source `/v1` prefix to transport**
   - Add constant `const API_VERSION = '/v1';` at the top of the module.
   - In `createFetchTransport`, change `${apiUrl}${path}` to `${apiUrl}${API_VERSION}${path}`.
   - No other file should hardcode `/v1`.

2. **`auth-api.ts` — prefix standalone auth calls + adopt LoginResponse type**
   - Add constant `const API_VERSION = '/v1';` at the top.
   - Change every `fetch(\`${API_URL}/auth/...`)` to `fetch(\`${API_URL}${API_VERSION}/auth/...\`)`:
     - `login` → `/v1/auth/login`
     - `logout` → `/v1/auth/logout`
     - `refresh` → `/v1/auth/refresh`
     - `register` → `/v1/auth/register`
     - `forgotPassword` → `/v1/auth/forgot-password`
     - `resetPassword` → `/v1/auth/reset-password`
     - `activate` → `/v1/auth/activate`
   - Import `type { components } from './api-types.gen'`.
   - Replace the hand-written `LoginResponse` type with `type LoginResponse = components['schemas']['LoginResponse']`.

3. **`login/page.tsx` — fix OAuth anchor**
   - Line 265: change `href={...}/auth/google` to `href={...}/v1/auth/google`.

4. **`topics-api.ts` — fix path structure bugs + adopt TopicNode type**
   - Import `type { components } from './api-types.gen'`.
   - Replace the `TopicNode`-based return type annotations on `list()` and `getById()` with `components['schemas']['TopicNode']` from gen. (Keep `TopicProgressEntry` and `TopicProgressStatus` as hand-written — no schema for these in gen.)
   - Fix `visit()`: change `/topics/${id}/visit` → `/me/topics/${id}/visit`.
   - Fix `complete()`: change `/topics/${id}/complete` → `/me/topics/${id}/complete`.
   - Keep `markVideoWatched` at `/topics/${topicId}/videos/${mediaId}/watched` — correct, served at `/v1/topics/:id/videos/:videoId/watched`.
   - Keep `listProgress()` at `/me/progress/topics` — correct.
   - Remove the `import type { TopicNode, Media }` from `./admin-topics-api` if it was used for return types; these are now sourced from gen. Keep the re-export `export type { TopicNode, Media }` using the gen type.

   **Important:** The generated `TopicNode` schema is missing `archived` and `mediaCount` fields present in the hand-written type. This is a contract drift — do NOT add them back; surface the mismatch by letting callers that depend on `archived` or `mediaCount` fail the TypeScript build. Document in a comment: `// archived and mediaCount are absent from the OpenAPI schema — reconcile when api-types.gen.ts is regenerated`.

5. **`comments-api.ts` — fix toggleLike path**
   - Change `http('POST', \`/comments/${commentId}/like\`)` to `http('POST', \`/me/comments/${commentId}/like\`)`.
   - No type adoption change for comments (no generated schema for CommentItem in api-types.gen.ts).

6. **`tasks-api.ts` — fix checkIn path**
   - Change `http('POST', \`/tasks/${taskId}/stages/${stageId}/check-in\`)` to `http('POST', \`/me/tasks/${taskId}/stages/${stageId}/check-in\`)`.

7. **`account-api.ts` — fix changePassword path**
   - Change `http('POST', '/account/change-password', ...)` to `http('POST', '/me/change-password', ...)`.

8. **`.env.example` — document base-URL convention**
   - Update the comment to clearly state: `NEXT_PUBLIC_API_URL` must be a bare origin (no trailing slash, no path segment). The `/v1` prefix is injected in code by `api-client.ts`. Example: `http://localhost:8787`.

9. **`comments-api.test.ts` — update toggleLike path expectation**
   - Change the `http` call assertion for `toggleLike` from `'/comments/c1/like'` to `'/me/comments/c1/like'`.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Every transport-routed call resolves to `/v1/...`; prefix defined in one place in `api-client.ts` | 1 | frontend | grep for `/v1` in domain modules (must be zero); grep for `API_VERSION` in api-client.ts |
| `auth-api.ts` and `login/page.tsx` OAuth link target `/v1/auth/...` | 2, 3 | frontend | code review + network tab on login |
| No `*-api.ts` module hardcodes `/v1` in individual path strings | 1–7 | frontend | `grep -rn '"/v1' apps/web/src/lib` returns zero hits |
| At least public/catalog and comments client methods consume types from `api-types.gen.ts` | 4, 2 | frontend | TypeScript build passes; `topics-api.ts` imports from gen; `auth-api.ts` LoginResponse from gen |
| `.env.example` documents the base-URL convention; no `/v1/v1` double-prefix | 8 | frontend | `NEXT_PUBLIC_API_URL=http://localhost:8787` in example; transport builds `${baseUrl}/v1/...` |
| `make lint`, `make test-web`, `make build` pass | all | frontend | CI commands |

## Risks & open questions

- **`TopicNode` shape mismatch:** The generated schema omits `archived` and `mediaCount`. Any component that references these fields will fail the TypeScript build after type adoption. Treat each failure as a real contract gap (not a test to loosen). Likely candidates: the admin topics tree view. Add a `// TODO(api-types): reconcile after next api-types.gen.ts regeneration` comment near the mismatch.
- **`TaskSummary` / `PublicTaskDetail` / `CheckInResult` not in gen types:** `tasks-api.ts` types remain hand-written for now; only the path structure bug (checkIn) is fixed.
- **Comments schema absent:** `CommentItem` has no named schema in `api-types.gen.ts` — the router uses inline Zod schemas not extracted as reusable components. Type adoption for comments is deferred; only the path bug is fixed in this task.
- **Double-prefix guard:** The shim matches `startsWith('/auth|/me|/admin|/topics|/tasks|/leaderboard|/catalog')`. After this task, all calls use `/v1/...` which does not start with any of these prefixes — so the shim will fall through to `buildApp(env).fetch(request, env, ctx)` which correctly routes `/v1/...`. No double-prefix.

## Verification

- Frontend: `make lint && make test-web`
- Build: `make build`
- Manual: `make dev` (web + api); exercise login, catalog list/detail, topic complete, comments list/post/like, tasks checkin, dashboard; confirm all Network tab requests hit `/v1/...` and succeed.
- Post-check: `grep -rn '"/v1' apps/web/src/lib` must return zero hits (no hardcoded `/v1` in domain modules).
- Post-check: `grep -rn "'/topics\|'/auth\|'/tasks\|'/me\|'/admin\|'/leaderboard" apps/web/src/lib` — confirm paths look structurally correct (no `/account/change-password`, no `/comments/` top-level).

## Out of scope

- Any backend change or removing the legacy shim (Task 06).
- Regenerating `api-types.gen.ts` (backend concern).
- New UI, pages, or UX changes.
- Adopting generated types for admin modules, tasks, progress, or dashboard (no matching schemas in gen).
