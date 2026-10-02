# Task 10 — Frontend: Show student submissions as storage owners (Phase 2)

**Status:** ✅ Done
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Frontend Web
**Depends On:** [Task 09](./09-submission-storage-owner-api.task.md)

## Summary

Renders Task 09's new `submission` reference on the Storage page. In the folder listing, the
scan results and the detail drawer, a submission object shows its owner as "Submission
*<title>* · `<original name>` · by <author>", linked to the topic it belongs to, alongside the
existing media and flyer owners. The `submissions/` root folder is labelled. The API types are
regenerated from the updated `openapi.json`. No new action is added: a submission is never
deletable from this page, because the server never classifies a referenced submission as
`orphan` or `deleted-row`.

## Dependencies

- [Task 09](./09-submission-storage-owner-api.task.md) — the `submission` reference contract.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/admin/storage/**` (owner cell, drawer reference list, their `__tests__`)
  - `apps/web/src/lib/admin-storage-api.ts` (types only, if needed)
  - `apps/web/src/lib/api-types.gen.ts` (regenerated with `pnpm gen:api-types`)
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (new keys under `adminStorage`)
- **i18n.** No hardcoded string; identical keys in both dictionaries; `check-i18n-coverage.js` passes.

## Scope

In:
- Rendering the submission owner (cell and drawer) and the regenerated types.
- RTL tests for a `submission` reference in the listing and the drawer.

Out:
- Any backend change; any new destructive action.

## Acceptance Criteria

- [x] A `linked` submission object shows its title, original name and author, and links to its topic.
- [x] The drawer lists a `submission` reference with its status, author and topic.
- [x] No Delete action is offered for a `linked` or `pending` submission object.
- [x] No hardcoded user-facing string; the new keys exist in both dictionaries; `check-i18n-coverage.js` passes.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` and `check-i18n-coverage.js`.
2. `make lint`.
3. `git diff --stat` confirms only scope-guardrail files changed.
