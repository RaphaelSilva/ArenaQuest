# Task 05 — Frontend: Orphan and missing-file scan panel (Phase 1)

**Status:** ✅ Done
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-admin-storage-api-browse-object-audit.task.md), [Task 04](./04-admin-storage-browser-page.task.md)

## Summary

Adds the **scan panel** to the Storage page, so an admin can audit the whole bucket in one
sitting without leaving the backoffice. "Scan for orphans" drives `GET /v1/admin/storage/audit`
page after page, passing each returned `nextCursor` until it is absent, accumulating the
non-`linked` objects and showing live progress (keys scanned so far); "Check for missing files"
does the same over `GET /audit/missing`. Either run can be stopped at any time and nothing is
left behind, because the audit is stateless server-side. Results are grouped by status
(`orphan`, `deleted-row`, stale `pending`, `displaced`, and `missing-object` rows) with a count
and the total bytes per group, so "how much could we reclaim" is answered at a glance; each
result opens the same detail drawer Task 04 built, and each missing-object row links to its
topic or event. It consumes Task 03's audit routes and reuses Task 04's page, client and drawer.

## Dependencies

- [Task 03](./03-admin-storage-api-browse-object-audit.task.md) — the `/audit` and
  `/audit/missing` contracts.
- [Task 04](./04-admin-storage-browser-page.task.md) — the page, the API client and the detail
  drawer this panel extends.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/storage/**` — placing the panel on the page.
  - `apps/web/src/components/admin/storage/**` — the scan panel, its hook (or co-located state)
    and `__tests__`.
  - `apps/web/src/lib/admin-storage-api.ts` — `audit` and `auditMissing` calls.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` — new keys under `adminStorage`.
- **Sequential, cancellable loop.** One request in flight at a time; stopping aborts the current
  request and issues no further page; unmounting the page stops the run.
- **No persistence.** Results live in component state only — no browser storage, no server
  state.
- **i18n.** Every label, status group, progress and error message comes from `adminStorage`;
  identical keys in both dictionaries; `check-i18n-coverage.js` passes.
- **Failure is visible, not fatal.** A failed page shows an error with "Retry" that resumes from
  the last good cursor; accumulated results are kept.
- **Responsive & accessible.** Progress is announced (`aria-live`); the stop button is reachable
  by keyboard while a run is active.

## Scope

In:
- `audit` / `auditMissing` client calls.
- The panel: two start buttons, progress, stop, retry-from-cursor, grouped results with counts
  and byte totals, links into the drawer and to owners.
- Dictionary keys in both languages.
- Component tests with a mocked client: pages accumulate until `nextCursor` is absent, stop
  prevents further requests, retry resumes from the last cursor, totals per group are correct.

Out:
- Deleting anything — Task 07.
- Scheduling or persisting scans — out of the milestone.
- Any backend change.

## Acceptance Criteria

- [x] Starting "Scan for orphans" calls `/audit` without a cursor, then with each returned
      cursor, and stops calling when `nextCursor` is absent; the scanned counter equals the sum
      of `scanned` across pages.
- [x] Pressing stop mid-run aborts the in-flight request and issues no further request.
- [x] A failed page shows an error; "Retry" re-requests with the last good cursor and keeps
      earlier results.
- [x] Results are grouped by status with the correct count and total bytes per group;
      "Check for missing files" lists missing-object rows with owner links.
- [x] Selecting a result opens the Task 04 detail drawer for that key.
- [x] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and `dict-pt.ts`;
      `check-i18n-coverage.js` passes.
- [x] The surface is responsive and keyboard-usable while a run is active.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-api` + `make dev-web`; seed a few stray objects locally and delete one media object
   by hand so a `ready` row has no object.
2. Run both scans; confirm the stray objects and the missing row appear in the right groups.
3. Start a scan and stop it; confirm in the network panel that no request follows.
4. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`.
5. `make test-web` and `check-i18n-coverage.js`.
6. Resize to mobile.
7. `git diff --stat` confirms only scope-guardrail files changed.
