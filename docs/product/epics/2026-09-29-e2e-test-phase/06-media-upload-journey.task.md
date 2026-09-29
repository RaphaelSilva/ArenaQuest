# Task 06 — Frontend: Local-R2 upload interception and journey J6

**Status:** 📝 Open
**Epic:** [End-to-end test phase — Playwright suite gating main](./2026-09-29-e2e-test-phase.epic.md)
**Team:** Frontend Web
**Depends On:** [Task 02](./02-fixtures-and-page-objects.task.md)

## Summary

Cover the media lifecycle in the browser without R2 credentials. The backoffice
uploader asks the API to presign, sends the file with a PUT to the presigned R2 URL
and then asks the API to finalize; finalize checks the object through the Worker's R2
**binding**, which locally is the Miniflare store under `e2e/.state`. An R2 helper
intercepts the browser's PUT to the R2 host, writes the same bytes into that local
store under the key the presign issued, and answers the browser with success. **J6:**
the admin opens a topic in the backoffice, uploads a small image and a small PDF from
`e2e/assets/`, both reach the ready state, and the student opens the topic in the
catalog and sees both media in their viewers. Presign, the uploader code, finalize and
the viewers are all real; only the network hop to Cloudflare is replaced.

## Dependencies

- [Task 02](./02-fixtures-and-page-objects.task.md) — hard dependency: API client,
  page objects, role states.
- [Task 01](./01-e2e-workspace-and-stack-boot.task.md) — the shared `e2e/.state`
  persistence the helper writes into.
- Existing behaviour: `apps/web/src/components/admin/MediaUploader.tsx`,
  `/v1/admin/topics/{topicId}/media/presign` and `/…/finalize`,
  `apps/api/src/adapters/storage/r2-storage-adapter.ts` (`headObject` via binding),
  media limits in `packages/shared/domain/media/limits.ts`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/fixtures/r2.ts` (new) and its registration in the extended `test`.
  - `e2e/specs/catalog/**` — J6.
  - `e2e/pages/**` — admin topic / uploader and media viewer page objects.
  - `e2e/assets/**` — one small image and one small PDF, both well under the limits.
- **Only the R2 hop is replaced.** The interception matches the R2 host only; every
  call to the API goes through untouched.
- **Same store as the API.** The helper writes into the persistence the running API
  reads; it never starts a second Miniflare instance.
- **No credentials.** `.dev.vars.e2e` keeps placeholder R2 keys; nothing reaches
  Cloudflare.
- **No production code change** to the uploader or storage adapter.

## Scope

In:
- The R2 interception helper.
- J6 with an image and a PDF, asserting ready state in the backoffice and rendering
  in the catalog.
- Page objects for the uploader and the viewers.

Out:
- Video uploads (size and time budget) — possible follow-up.
- Event flyer upload — covered as a read path by J9.

## Acceptance Criteria

- [ ] J6 passes: both files reach the ready state and render for the student.
- [ ] Disabling the interception makes J6 fail at the upload step (proving the real
      uploader path is exercised), with a trace.
- [ ] No request leaves the machine for an R2 host during the run.
- [ ] `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make e2e` filtered to J6 — green.
2. Comment out the interception — J6 fails at upload; restore.
3. Inspect the trace's network tab — the PUT is fulfilled locally.
4. `make lint`.
5. `git diff --stat` confirms only scope-guardrail files changed.
