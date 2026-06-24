# Plan — Task 03: Admin level-definition editor endpoints

**Task:** [03-admin-level-definition-editor-endpoints.task.md](../03-admin-level-definition-editor-endpoints.task.md)
**Persona:** `backend-developer`
**Branch:** `feature/m15/03-admin-level-definition-editor-endpoints.task` (stacked on task 02)

## Goal

Add `GET /admin/levels` (ordered read) and a transactional `PUT /admin/levels`
whole-table upsert that validates the curve (strict `min_xp` monotonicity, no
gaps, exactly one final `max_xp = NULL` row) and rejects an invalid curve with
`400` before committing. The whole `/admin/levels` surface is `ADMIN`-only
(stricter than the `ADMIN, CONTENT_CREATOR` umbrella). No migration:
`level_definitions` already exists.

## Current state (verified)

- `level_definitions` schema: `level` (PK), `rank_title`, `min_xp`, `max_xp`
  (NULL for final). Seeded in `0017_seed_level_definitions.sql` (30 rows).
- `IGamificationRepository.listLevelDefinitions()` already returns the rows
  ordered by `level ASC`; `D1GamificationRepository` implements it
  (`apps/api/src/adapters/db/d1-gamification-repository.ts`) with
  `rowToLevelDefinition` + a `LevelDefinitionRow` type. `LevelDefinitionRecord =
  Entities.Gamification.LevelDefinition`.
- Container exposes it as `container.gamification.gamificationRepo`.
- Cloudflare D1 supports atomic batched statements via `db.batch([...])` — use it
  for the transactional whole-table replace (delete-all + insert-all).
- ADMIN-only sub-router pattern exists: `apps/api/src/routes/admin/users.ts`
  applies `router.use('*', requireRole(ROLES.ADMIN))` on its own sub-app.

## Scope decision (deviation noted)

The task/milestone guardrail mentions "an analogous level-definition repository".
Since the ordered level read already lives in `IGamificationRepository` /
`D1GamificationRepository`, I will **extend those two files** with the new
`replaceAllLevelDefinitions` write method rather than create a parallel repo —
this keeps all level persistence in one owner and avoids duplicating the read.
This is the only deviation from the literal guardrail file list; recorded here so
a reviewer expects the diff in `i-gamification-repository.ts` +
`d1-gamification-repository.ts`.

## Approach

1. **Port** — add to `IGamificationRepository`
   (`packages/shared/ports/i-gamification-repository.ts`):
   `replaceAllLevelDefinitions(rows: LevelDefinitionRecord[]): Promise<LevelDefinitionRecord[]>`.
2. **D1 adapter** — implement on `D1GamificationRepository` using `db.batch()`:
   one `DELETE FROM level_definitions` statement followed by the parameterized
   inserts, executed atomically in a single `batch` call; then return
   `listLevelDefinitions()`. (Validation happens in the controller before this is
   called, so the adapter stays persistence-only.)
3. **Controller** — new `AdminLevelsController`
   (`apps/api/src/controllers/admin-levels.controller.ts`) with:
   - `list(): ControllerResult<LevelDefinition[]>` → `gamificationRepo.listLevelDefinitions()`.
   - `replaceAll(body): ControllerResult<LevelDefinition[]>`. Zod: array of
     `{ level: int, rankTitle: string min 1, minXp: int ≥ 0, maxXp: int|null }`,
     min length 1. Then curve validation (return `400 ValidationError` with a
     clear message on any failure):
     - rows sorted by `level` are contiguous starting at the lowest;
     - `minXp` strictly increasing across the ordered rows;
     - no gaps/overlaps: each non-final row's `maxXp` equals the next row's
       `minXp` (contiguity), and `maxXp > minXp`;
     - exactly one row has `maxXp === null`, and it is the highest-`level` row.
   - On valid input call `replaceAllLevelDefinitions` and return the persisted rows.
4. **Router** — new `apps/api/src/routes/admin/levels.ts`
   (`buildAdminLevelsRouter(container)`) with `createRoute` defs for `GET /` and
   `PUT /` (a `LevelDefinitionSchema` wire shape + the PUT body array schema),
   OpenAPIHono with the badges-style `defaultHook` 400 envelope. Apply
   `router.use('*', requireRole(ROLES.ADMIN))` so the whole surface is ADMIN-only.
5. **Mount** — `app.route('/levels', buildAdminLevelsRouter(container));` in
   `apps/api/src/routes/admin/index.ts`.
6. **Tests** — `apps/api/test/routes/admin-levels.router.spec.ts` (Workers pool):
   - `GET /admin/levels` returns rows ordered by `level` (seeded curve).
   - `PUT` a valid small curve persists and a follow-up `GET` reflects it.
   - `PUT` returns `400` for (a) non-monotonic `minXp`, (b) a gap/overlap,
     (c) a curve with zero or two `maxXp = NULL` rows.
   - A rejected `PUT` leaves the prior curve intact (assert via follow-up `GET`).
   - `CONTENT_CREATOR` token → `403` on both `GET` and `PUT`; `ADMIN` → allowed.

## Files in scope

- `packages/shared/ports/i-gamification-repository.ts` — the write method.
- `apps/api/src/adapters/db/d1-gamification-repository.ts` — `batch()` impl.
- `apps/api/src/controllers/admin-levels.controller.ts` — new controller + validation.
- `apps/api/src/routes/admin/levels.ts` — new ADMIN-only router.
- `apps/api/src/routes/admin/index.ts` — mount.
- `apps/api/test/**` — new router spec.

## Out of scope

- Quest endpoints (task 02), any `apps/web` change, per-row level PATCH (deferred
  fallback), per-user `user_xp` (RFC 0010), curve-math changes.

## Verification

- `make lint`; `make test-api` — new levels spec + existing specs green.
- `git diff --stat` — only scope-guardrail files changed.
