# Task 04 — Backend: Admin events API and flyer lifecycle (Phase 3)

**Status:** 📝 Open
**Milestone:** [20 — Events board — public listing, access-scoped audiences and per-event WhatsApp contact](./milestone.md)
**RFC:** [RFC 0014](../../RFCs/0014-events-board-and-whatsapp-contact.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-anonymous-read-api.task.md)

## Summary

Makes an event authorable, gateable and publishable entirely over the API, before any
screen exists. `admin-events.controller.ts` and `routes/admin/events.ts` mount under the
`/v1/admin` umbrella — which already carries `authGuard` and
`requireRole(ADMIN, CONTENT_CREATOR)` — and add **one gate of their own**: a content creator
may create and edit a draft, but the transition to `status='published'`, the act that puts a
page and a person's phone number on the open internet, carries its own `requireRole(ADMIN)`,
mirroring `admin/billing`. Removal is `PATCH {status:'archived'}` and nothing else: **there
is no `DELETE /v1/admin/events/{id}`**, so an event row and its flyer object can never be
separated, and an archive is reversible and keeps its audit trail. The slug is generated at
creation and never re-derived on rename — an automatic re-slug would silently 404 every link
already circulating in WhatsApp — while an explicit manual slug edit stays possible for a
typo. `PUT /{id}/audience` replaces the whole grant set at once, so a removed group is
removed rather than merged. The flyer reuses the `presign → PUT → finalize` lifecycle the
topic uploader proved, with one deliberate strictness the topic path lacks: finalize
`HEAD`s the stored object and compares its **real** size against the shared 5 MB image
ceiling from Task 01, then deletes the object and rejects `422 FileTooLarge` leaving
`flyer_status` at `'pending'`. Today's topic path signs the presign with the size the client
*declared* and finalize only asserts the key exists, which makes the ceiling a client-side
suggestion; this task makes it real for events without touching the topic upload path the
bulk importer depends on. Task 06 wraps all of this in a form.

## Dependencies

- [Task 03](./03-anonymous-read-api.task.md) — ordering dependency and shared wiring. This
  task extends the `events` container group that task introduces and must not conflict with
  it; the public reads it authored are what publishing here makes visible.
- [Task 02](./02-schema-and-repository.task.md) — hard code dependency, transitively: every
  write is a call into `IEventRepository`.
- [Task 01](./01-shared-foundations.task.md) — hard code dependency for the shared media
  limits table the flyer ceiling is enforced from, and for the WhatsApp normalisation used
  to validate a number at write time.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/admin-events.controller.ts` (new).
  - `apps/api/src/routes/admin/events.ts` (new) and its mount line in
    `apps/api/src/routes/admin/index.ts`.
  - `apps/api/src/container.ts` — extending the `events` group from Task 03 with the admin
    dependencies only; no existing group changes shape.
  - `apps/api/test/**` — controller, route and role-matrix specs.
- **`apps/api/src/routes/index.ts` is not modified.** Admin events mount inside the admin
  sub-router, not at the top level. This file appearing in the diff is a review failure.
- **The publish gate is its own guard.** The blanket `/v1/admin/*` guard admits
  `content_creator`; the `status → published` transition carries an additional
  `requireRole(ADMIN)` on its path, following the precedent `routes/admin/billing.ts` sets.
  Draft creation and draft field edits remain open to both roles.
- **Validation is `@hono/zod-openapi`.** Bodies and params are declared with `createRoute`
  and Zod schemas at the route layer. **`@ValidateBody` / `@Body()` decorators do not exist
  in this codebase** — see
  `docs/product/backlog/refactoring/07-validatebody-documentation-drift.task.md`.
  Reintroducing them is a review failure.
- **Routes vs controllers.** All business logic lives in the controller and returns
  `ControllerResult<T>` with explicit validation, auth, not-found and conflict branches; the
  router parses, guards and shapes only.
- **Per-request adapters.** Everything is instantiated inside `buildApp(env)`; no adapter
  reaches module scope.
- **There is no hard delete.** No `DELETE /v1/admin/events/{id}` route may exist. The only
  `DELETE` in this task is `.../flyer`, which removes its own object. An archived event
  leaves both `?scope` lists while its row and flyer object stay together.
- **The slug is immutable on rename.** A title change never re-derives the slug. An explicit
  slug field in the payload is honoured and validated for uniqueness; the warning that it
  breaks shared links is the form's job (Task 06), and the API simply does what it is told.
- **The ceiling is enforced against stored bytes.** Presign validates the declared type and
  size against the shared limits, and finalize re-checks the object's **real** size via
  `headObject` before flipping `flyer_status` to `'ready'`. An oversize or lying upload is
  rejected `422 FileTooLarge`, the object is deleted, and `flyer_status` stays `'pending'`.
- **The topic upload path is not touched.** The identical declared-size hole in topic media
  is a separate backlog item; `admin-media.controller.ts` gains no behaviour change here and
  `scripts/content/import-media.mjs` is absent from the diff.
- **Flyers are images only** — the shared image types and the single 5 MB ceiling, reused
  rather than re-declared. No second limit table.
- **`sanitizeMarkdown` on write.** The `content` field is sanitised before persisting, not
  on read alone.
- **A WhatsApp number is validated at write time** with the shared normalisation, so the API
  refuses exactly what the web would refuse to render.
- **No money, no access effect.** No price, amount, currency or `subscriptions` foreign key;
  nothing reads or writes an enrollment grant; `getEffectiveAccessTopicIds`,
  `d1-enrollment-repository.ts` and `src/core/billing/**` are untouched.

## Scope

In:
- `AdminEventsController`: list including drafts and archived; create a draft; patch fields;
  the guarded publish and the archive transition; audience grant-set replacement; the flyer
  presign, finalize and delete.
- The `/v1/admin/events` router covering `GET`, `POST`, `PATCH /{id}`,
  `PUT /{id}/audience`, `POST /{id}/flyer/presign`, `POST /{id}/flyer/finalize` and
  `DELETE /{id}/flyer`, with the publish path carrying its own admin guard.
- Explicit error branches: a slug collision on an explicit slug, an unknown group or user in
  a grant set, a WhatsApp number that fails normalisation, a flyer type or declared size
  outside the shared limits, a finalize whose stored object exceeds the ceiling, a finalize
  against an event with no pending flyer, and a publish attempt from a `content_creator`.
- Replacement handling: a second successful flyer finalize deletes the previously-ready
  object rather than orphaning it.
- The container wiring extending the Task 03 `events` group.
- Tests for each rule and each error branch, plus the role matrix asserted **per route**,
  including the `content_creator` publish `403` and the absence of a delete route.

Out:
- Every anonymous read surface — Task 03.
- Any frontend change — Task 06 builds the backoffice over these endpoints.
- The seeded example event and the documentation closeout — Task 08.
- Fixing the declared-size hole in topic media — out of scope for this milestone.

## Acceptance Criteria

- [ ] An admin can create an event, upload a flyer through `presign → PUT → finalize`, set
      `audience='restricted'` with one group and publish — using only the API, with no
      screen in existence; a member of that group then sees it on `GET /v1/events` and a
      non-member receives `404`.
- [ ] A `content_creator` token can `POST` a draft and `PATCH` its draft fields, but
      `PATCH {status:'published'}` returns `403`; the identical call from an `admin` token
      publishes.
- [ ] No `DELETE /v1/admin/events/{id}` route exists — asserted against the route table, not
      only by a request returning 404.
- [ ] `PATCH {status:'archived'}` removes the event from both `?scope` lists while its row
      and its flyer object remain; re-patching to `published` restores it.
- [ ] Renaming a published event via `PATCH` leaves its `slug` unchanged and a previously
      shared URL still resolves; supplying an explicit slug changes it and a collision is
      refused.
- [ ] `PUT /{id}/audience` replaces the whole grant set: groups and users absent from the
      new payload no longer have a grant.
- [ ] A 6 MB JPEG is rejected `422 FileTooLarge` at presign, in the same error shape the
      topic uploader returns, from the shared limits module.
- [ ] A client that presigns declaring `sizeBytes: 1024`, `PUT`s a 50 MB object and then
      calls finalize is rejected `422 FileTooLarge`, the object is removed, and
      `flyer_status` is left `'pending'`.
- [ ] A second successful flyer finalize deletes the previously-ready object; no key is
      orphaned in R2.
- [ ] A WhatsApp number failing the shared 10–15-digit normalisation is rejected at write
      time.
- [ ] `content` is persisted sanitised.
- [ ] A student and a `tutor` token receive `403` from every route in this router —
      asserted per route, not once.
- [ ] No `@ValidateBody` or `@Body()` decorator appears in the diff.
- [ ] No provider-specific (D1/R2) import leaks into the controller;
      `apps/api/src/routes/index.ts`, `admin-media.controller.ts`,
      `d1-enrollment-repository.ts` and `src/core/billing/**` are unchanged.
- [ ] Validation, auth, not-found and conflict branches each return the correct
      `ControllerResult` status and are covered by a test.
- [ ] Changed files lint clean; `make test-api` green, and the pre-existing suite passes
      unchanged.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` then `make dev-api`, and run the whole lifecycle with curl or
   Bruno as an **admin**: create, patch, presign, `PUT`, finalize, set a restricted audience
   with one group, publish. Then read `GET /v1/events` as a member of that group and as a
   non-member, and confirm the event and the `404`.
2. Repeat the create-and-edit portion with a `content_creator` token, then attempt the
   publish and confirm `403`.
3. Exercise the ceiling twice: presign a 6 MB JPEG and confirm the `422`; then presign
   declaring 1 KB, `PUT` a 50 MB object, call finalize, and confirm the `422`, that the
   object is gone from R2, and that `flyer_status` is still `'pending'`.
4. Rename a published event and confirm the previously copied public URL still resolves.
5. Archive it and confirm it leaves both `?scope` lists while the flyer object remains in
   the bucket; un-archive and confirm it returns.
6. Call every route with a student and a `tutor` token and confirm `403` on each.
7. `make test-api` — controller, route and role-matrix specs pass; the pre-existing suite is
   unchanged.
8. `make lint`.
9. `git diff --stat` confirms only the guardrail files changed and that
   `apps/api/src/routes/index.ts`, `admin-media.controller.ts` and `apps/web/` are absent
   from the list; `git grep -n "getEffectiveAccessTopicIds" apps/api/src` returns the same
   four call sites as before.
