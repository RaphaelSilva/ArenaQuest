# Task 01 — Backend: make the catalog enforce enrollment (Phase 0)

**Status:** ✅ Done
**Milestone:** [12 — Enrollment enforcement and node visibility](./milestone.md)
**RFC:** [0005 — Enrollment enforcement and node visibility, Phase 0](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Team:** Backend API

## Summary

Fix the latent catalog-gating defect: the public catalog router builds `TopicsController` with **no enrollment adapter** (`enrollment = undefined`), so `GET /topics` and `GET /topics/{id}` return **every** published topic to **every** authenticated user, regardless of grants. Inject the existing `D1EnrollmentRepository` into the catalog controller so the cascade resolver already wired elsewhere (comments, video-watched) finally gates the catalog reads. This is the prerequisite that makes any per-node visibility policy meaningful, and it ships and verifies on its own.

## Dependencies

- None. This is the first task of the milestone and lands on `develop` independently of all later work.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/routes/public/catalog.topics.ts` — instantiate the enrollment adapter (per-request, inside the handler / `buildApp` flow) and pass it into `TopicsController` instead of `undefined`.
  - `apps/api/test/**` — new regression test(s) pinning the fix.
  - No change to `TopicsController` logic is expected: the `userId && this.enrollment` guard already exists; this task supplies the missing adapter.
- **Adapter pattern (Ports & Adapters).** The enrollment adapter is constructed **per request** (Workers have no shared memory between requests; never hold an adapter in module scope). The controller depends on the `IEnrollmentRepository` port, not the concrete D1 class.
- **Cloud-agnostic.** No Cloudflare-specific symbol leaks into the controller; the catalog route wires the concrete `D1EnrollmentRepository` exactly as the comments and video-watched paths already do.
- **Admin / content-creator bypass preserved.** Admins and content creators continue to call with `userId: undefined` so the resolver is skipped and they see all published content. Only non-admins are filtered by `getEffectiveAccessTopicIds(user.sub)`.
- **No behaviour change beyond enforcement.** The `status === PUBLISHED && !archived` filter the controller already applies stays in place and runs **before** the access check, independent of `userId`. Draft and archived topics remain catalog-invisible to everyone.
- **No new route, no schema change, no migration** in this task.

## Scope

In:
- Wire a per-request `D1EnrollmentRepository` into the catalog controller in `catalog.topics.ts` and remove the `undefined` argument.
- Confirm `GET /topics` and `GET /topics/{id}` filter non-admin responses by the effective-access set and keep the admin / content-creator bypass.
- Add a Vitest regression test: a participant granted 1 of N topics sees exactly that subtree (cascade), not all N. **This test must fail against the current `develop` behaviour and pass after the fix.**
- Add a test asserting an admin / content creator still sees all published topics.

Out:
- The `visibility` column, enum, or resolver changes (Tasks 02–04).
- Any frontend change — the participant catalog already calls these endpoints with the user's JWT (Phase 0 is server-side only).
- Comment-path or video-watched changes — those are already correctly gated.

## Acceptance Criteria

- [x] `catalog.topics.ts` builds `TopicsController` with a real enrollment adapter; the `undefined` argument is gone.
- [x] `GET /topics` returns only the granted subtree (cascade) for a non-admin participant, not every published topic.
- [x] `GET /topics/{id}` returns `404` for a non-accessible topic to a non-admin, and the topic to an admin / content creator.
- [x] Admin and content-creator requests continue to see all published, non-archived topics.
- [x] Draft and archived topics never appear in either endpoint for any caller.
- [x] A regression test reproduces the original defect (would fail pre-fix) and passes post-fix.
- [x] No D1-specific import leaks into `TopicsController`.
- [x] Changed files lint clean and the full catalog-read surface (58 tests across `topics.router`, `admin-topics.router`, `topics.controller`, `comments`, `docs` specs) passes. _Caveat: repo-wide `make lint` is red on a pre-existing, out-of-scope file (`apps/api/scripts/generate-bruno.ts`); the full `make test-api` run is unstable on this WSL2 host (workers-pool RPC timeout) — verified via targeted specs instead._
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Check out `develop`, run the new regression test, and confirm it **fails** (pins the defect). Apply the fix and confirm it passes.
2. `make test-api` — full API suite green.
3. `make dev-api`: grant a participant 1 of 3 topics; authenticate as that user and `curl GET /topics` — confirm only the granted subtree returns.
4. `curl GET /topics/{id}` for a non-granted topic as the participant — confirm `404`; repeat as an admin — confirm `200`.
5. Confirm draft / archived topics are absent for all callers.
6. `git diff --stat` confirms only the scope-guardrail files changed.
