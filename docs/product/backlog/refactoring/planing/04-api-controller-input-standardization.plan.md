# Plan — 04-api-controller-input-standardization

**Task:** [04-api-controller-input-standardization.task.md](../04-api-controller-input-standardization.task.md)
**Source:** Backlog — refactoring
**Assigned personas:** backend-developer
**Branch:** feature/backlog/refactoring/04-api-controller-input-standardization.task

## Objective

Four Pattern A controllers (`register`, `password`, `activate`, `admin-badges`) accept `input: unknown`, run `safeParse` internally, and emit divergent 400 error envelopes (`ValidationFailed` / `BadRequest` / `InvalidToken` / `ValidationError`). Their corresponding routes already use `@hono/zod-openapi` with `request.body` schemas and `c.req.valid('json')`, meaning route-level validation already fires before the handler runs — making the controller-level `safeParse` a redundant second pass. This plan removes the controller-level duplication, promotes the full Zod constraints to the shared route schemas, wires a `defaultHook` on each affected router for a single standardized 400 body, and updates tests accordingly.

## Affected areas

**Files to modify:**
- `apps/api/src/openapi/components/entities.ts` — enrich the four auth request schemas and add badge create/update schemas
- `apps/api/src/controllers/register.controller.ts` — change signature, remove safeParse
- `apps/api/src/controllers/password.controller.ts` — change signatures, remove safeParse
- `apps/api/src/controllers/activate.controller.ts` — change signature, remove safeParse
- `apps/api/src/controllers/admin-badges.controller.ts` — change signatures, remove safeParse
- `apps/api/src/routes/auth/register.ts` — add `defaultHook`, update 400 response declaration, simplify handler
- `apps/api/src/routes/auth/password.ts` — add `defaultHook`, update 400 response declarations
- `apps/api/src/routes/auth/activate.ts` — add `defaultHook`, update 400 response declaration
- `apps/api/src/routes/admin/badges.ts` — add `defaultHook`, update 400 response declarations, import schemas from entities
- `apps/api/test/controllers/admin-badges.controller.spec.ts` — remove the `create` validation unit test (validation moves to route layer)
- `apps/api/test/routes/register.router.spec.ts` — add a test: invalid body → standardized 400
- `apps/api/test/routes/password.router.spec.ts` — add a test: invalid body → standardized 400
- `apps/api/test/routes/activate.router.spec.ts` — add a test: invalid body → standardized 400

**New files:**
- `apps/api/test/routes/admin-badges.router.spec.ts` — new route-level integration tests (valid, invalid body, domain errors)

**Out of scope:**
- Pattern D controllers (no body)
- Any controller already on Pattern B
- `@ValidateBody` / `@Body` decorators — must NOT be reintroduced
- Business logic changes

## Step-by-step

### Backend

#### Step 1 — Enrich auth request schemas in `openapi/components/entities.ts`

Update the four existing schemas to match the full constraints previously in controllers:

- **`RegisterRequestSchema`**: `name` → `z.string().trim().min(2).max(80)`, `email` → `z.string().trim().toLowerCase().email()`, `password` → `z.string().min(8).regex(/\d/)`. Keep `.openapi()` decorators.
- **`ForgotPasswordRequestSchema`**: `email` → `z.string().trim().toLowerCase().email()`. Keep `.openapi()`.
- **`ResetPasswordRequestSchema`**: `token` → `z.string().min(1)`, `newPassword` → `z.string().min(8).regex(/\d/)`. Keep `.openapi()`.
- **`ActivateRequestSchema`**: `token` → `z.string().min(1)`. Keep `.openapi()`.

Add badge schemas at the bottom of entities.ts (promoting from inline route definitions):

```typescript
export const BADGE_RULE_KINDS = [
  'streak_days', 'topic_completed', 'videos_watched_in_period', 'total_xp', 'mission_completed',
] as const;

export const CreateBadgeBodySchema = z.object({
  slug: z.string().min(1).openapi({ example: 'perfect-streak' }),
  name: z.string().min(1).openapi({ example: 'Perfect Streak' }),
  iconEmoji: z.string().min(1).openapi({ example: '🔥' }),
  description: z.string().optional().openapi({ example: 'Complete a streak.' }),
  xpReward: z.number().int().min(0).optional().openapi({ example: 100 }),
  ruleKind: z.enum(BADGE_RULE_KINDS).openapi({ example: 'streak_days' }),
  ruleParams: z.string().optional().openapi({ example: '7' }),
}).openapi('CreateBadgeBody');

export const UpdateBadgeBodySchema = z.object({
  name: z.string().min(1).optional().openapi({ example: 'New Name' }),
  iconEmoji: z.string().min(1).optional().openapi({ example: '🏆' }),
  description: z.string().optional().openapi({ example: 'New description.' }),
  xpReward: z.number().int().min(0).optional().openapi({ example: 200 }),
  ruleKind: z.enum(BADGE_RULE_KINDS).optional().openapi({ example: 'total_xp' }),
  ruleParams: z.string().optional().openapi({ example: '1000' }),
  active: z.boolean().optional().openapi({ example: true }),
}).openapi('UpdateBadgeBody');
```

Export inferred types: `CreateBadgeInput`, `UpdateBadgeInput`.

#### Step 2 — Refactor `register.controller.ts`

- Import `RegisterRequestSchema` from `@api/openapi/components/entities` and derive `type RegisterInput = z.infer<typeof RegisterRequestSchema>`.
- Change `register(input: unknown)` → `register(input: RegisterInput)`.
- Remove the `RegisterSchema.safeParse(input)` block (both the constant `RegisterSchema` and its usage).
- Replace `const { name, email, password } = parsed.data;` → `const { name, email, password } = input;`.
- Remove the `ValidationFieldError` interface and the `fields` construction (no longer needed).
- Remove the early `return { ok: false, status: 400, ... }` branch.

#### Step 3 — Refactor `password.controller.ts`

- Import `ForgotPasswordRequestSchema`, `ResetPasswordRequestSchema` from entities; derive types.
- Change `forgotPassword(input: unknown)` → `forgotPassword(input: ForgotPasswordInput)`.
- Change `resetPassword(input: unknown)` → `resetPassword(input: ResetPasswordInput)`.
- Remove both `safeParse` blocks and their 400 return branches.
- Replace `parsed.data` destructuring with `input` directly.
- Remove the local `ForgotPasswordSchema` and `ResetPasswordSchema` constants.

#### Step 4 — Refactor `activate.controller.ts`

- Import `ActivateRequestSchema` from entities; derive `type ActivateInput`.
- Change `activate(input: unknown)` → `activate(input: ActivateInput)`.
- Remove `ActivateSchema.safeParse(input)` block and the early 400 branch.
- Replace `parsed.data.token` → `input.token`.
- Remove the local `ActivateSchema` constant.

#### Step 5 — Refactor `admin-badges.controller.ts`

- Import `CreateBadgeBodySchema`, `UpdateBadgeBodySchema` from entities; derive `CreateBadgeInput`, `UpdateBadgeInput`.
- Change `create(body: unknown)` → `create(body: CreateBadgeInput)`.
- Change `update(id: string, body: unknown)` → `update(id: string, body: UpdateBadgeInput)`.
- Remove both `safeParse` blocks and their 400 return branches.
- Replace `parsed.data` → `body` directly.
- Remove the local `createSchema`, `updateSchema`, and `VALID_RULE_KINDS` constants.

#### Step 6 — Wire `defaultHook` and update 400 responses in `routes/auth/register.ts`

- Import `ValidationErrorBody` from `@api/openapi/components/errors`.
- Change `new OpenAPIHono()` → `new OpenAPIHono({ defaultHook: (result, c) => { if (!result.success) return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400); } })`.
- Update the `registerRoute` 400 response to: `content: { 'application/json': { schema: ValidationErrorBody } }`.
- Simplify the handler: remove the special `ValidationFailed` branch in the error payload formatting (the controller no longer returns 400). Use `respondWith` (or inline equivalent) for domain errors.
- The rate-limiter logic: since invalid-body requests are short-circuited by `defaultHook` before the handler runs, `limiter.hit()` is never called for them — this is the correct behavior (only valid-shape requests consume tokens).

#### Step 7 — Wire `defaultHook` and update 400 responses in `routes/auth/password.ts`

- Same `defaultHook` pattern as Step 6.
- Update both `forgotPasswordRoute` and `resetPasswordRoute` 400 responses to use `ValidationErrorBody`.

#### Step 8 — Wire `defaultHook` and update 400 responses in `routes/auth/activate.ts`

- Same `defaultHook` pattern.
- Update `activateRoute` 400 response to use `ValidationErrorBody`.

#### Step 9 — Update `routes/admin/badges.ts`

- Import `CreateBadgeBodySchema`, `UpdateBadgeBodySchema` from `@api/openapi/components/entities`.
- Replace the inline body schema objects in `createBadgeRoute` and `updateBadgeRoute` with imports.
- Add `defaultHook` to `new OpenAPIHono()`.
- Update 400 response on `createBadgeRoute` and `updateBadgeRoute` to use `ValidationErrorBody`.

#### Step 10 — Update `test/controllers/admin-badges.controller.spec.ts`

- Remove the `describe('create') > it('returns 400 for unknown ruleKind')` test — the controller no longer validates input shape; that responsibility moved to the route layer.
- Keep all other tests (list, valid create, awardBadge).

#### Step 11 — Update `test/routes/register.router.spec.ts`

Add a new test case:
```
it('returns standardized 400 for missing required field', async () => {
  const res = await request('/auth/register', { body: { email: 'x@y.com', password: 'Pass1234' }, ip: '203.0.113.99' });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('ValidationError');
  expect(Array.isArray(body.issues)).toBe(true);
});
```

#### Step 12 — Update `test/routes/password.router.spec.ts`

Add a test for invalid body → standardized 400 on `reset-password`:
```
it('returns standardized 400 with issues for invalid body', async () => {
  const res = await post('/auth/reset-password', { newPassword: 'weak' });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('ValidationError');
  expect(Array.isArray(body.issues)).toBe(true);
});
```

#### Step 13 — Update `test/routes/activate.router.spec.ts`

Add a test for missing token → standardized 400:
```
it('returns standardized 400 for empty body', async () => {
  const res = await request('/auth/activate', { body: {}, ip: '203.0.113.79' });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('ValidationError');
  expect(Array.isArray(body.issues)).toBe(true);
});
```

#### Step 14 — Create `test/routes/admin-badges.router.spec.ts`

New integration test file covering:
- `GET /admin/badges` → 200 (happy path, list)
- `POST /admin/badges` with invalid body → 400 with `{ error: 'ValidationError', issues: [...] }`
- `POST /admin/badges` with valid body → 201
- `PATCH /admin/badges/:id` with invalid body → 400 with `ValidationErrorBody`
- `PATCH /admin/badges/:id` with non-existent id → 404

#### Step 15 — Regenerate `openapi.json`

Run `pnpm dump-openapi` (or `pnpm --filter api generate-openapi`) from `apps/api/` to regenerate the committed `openapi.json` with updated request schemas and `ValidationErrorBody` on 400 responses.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| No `safeParse(unknown)` in 4 controllers | Steps 2–5 | backend | `grep -rn "safeParse" apps/api/src/controllers/` shows no matches in the 4 files |
| Routes declare `request.body` + use `c.req.valid('json')` | Steps 6–9 | backend | Source inspection + `make build` |
| Single standardized 400 body across all migrated routes | Steps 6–9 (defaultHook) | backend | `make test-api` + manual POST with invalid body |
| Domain-error paths unchanged | Steps 2–5 (only 400 branches removed) | backend | `make test-api` domain tests still green |
| No `@ValidateBody`/`@Body` decorators | Steps 2–9 | backend | `grep -rn "@ValidateBody\|@Body" apps/api/src/` → no matches |
| `openapi.json` regenerated | Step 15 | backend | `git diff apps/api/openapi.json` shows updated schemas |
| `make lint`, `make test-api`, `make build` pass | All | backend | CI gates |

## Risks & open questions

- **Transform side effects**: `RegisterRequestSchema` will add `trim()` and `toLowerCase()` transforms. `c.req.valid('json')` returns the transformed output; the controller will receive already-normalized data. Verify this is intentional (it preserves the original behavior — controllers were normalizing themselves anyway).
- **Rate-limit behavior on invalid body**: After the change, the `defaultHook` fires BEFORE the handler, so `limiter.hit()` is never called for invalid-body requests. This is **safer** than before (invalid requests don't consume tokens). Verify the rate-limit tests still pass.
- **`respondWith` usage in register route**: The current register handler builds the error payload manually (special-casing `ValidationFailed`). After the controller no longer emits 400, this can be replaced with plain `respondWith(c, result)`.

## Verification

- Backend: `make lint && make test-api && make build`
- `grep -rn "safeParse" apps/api/src/controllers/register.controller.ts apps/api/src/controllers/password.controller.ts apps/api/src/controllers/activate.controller.ts apps/api/src/controllers/admin-badges.controller.ts` — zero matches.
- `pnpm dump-openapi` — four routes now show request schemas + `ValidationErrorBody` on 400.

## Out of scope

- Pattern D controllers and any controller already on Pattern B.
- Business-rule changes (domain checks are untouched).
- Comments router (Task 03) and frontend/test alignment (Tasks 05/06).
- `@ValidateBody` / `@Body` decorator pattern — must NOT be introduced.
