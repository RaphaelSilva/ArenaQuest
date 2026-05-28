# Task 12 — Visual QA, closeout, and RFC 0004 status update (Phase 3)

**Status:** ✅ Done
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 3](../../RFCs/0004-catalog-redesign.md)

## Summary

Final pass that confirms the redesign matches the wireframe across all three breakpoints in both languages, records the closeout note for the milestone, and promotes RFC 0004 to `Implemented`. No new feature code lands in this task — it is the verification and documentation gate that closes the milestone.

## Dependencies

- Tasks 01 – 11 all merged and green.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `docs/product/milestones/11-catalog-redesign/closeout-analysis.md` (new).
  - `docs/product/RFCs/README.md` — flip the status column for RFC 0004 to `Implemented`.
  - `docs/product/RFCs/0004-catalog-redesign.md` — flip the `Status:` header to `Implemented`.
  - `docs/product/milestones/11-catalog-redesign/milestone.md` — flip status to `Implemented`, mark every task and Definition-of-Done item as done.
  - Optionally fixes to copy or token usage uncovered by the QA pass — but only if the fix is visibly required by the wireframe. Any non-cosmetic fix that grows in scope must be filed as a separate task instead.
- **No new feature code.** This task is documentation + QA. Any defect that surfaces must either land as a tiny in-scope fix in this PR (with the fix called out in the closeout) or be filed as a follow-up task.
- **Lighthouse comparison.** Capture a Lighthouse run for `/catalog/<id>` against the pre-merge baseline on the same machine. Performance must stay within 5 points (per RFC §"Success Criteria"). Record both scores in the closeout.
- **Visual review.** Capture screenshots of `/catalog/<id>` at `< md` (375 px), `md` (768 px), and `lg` (1280 px) in both PT and EN. Compare side-by-side with the wireframe rendered locally.
- **i18n.** Confirm `check-i18n-coverage.js` reports zero misses across the catalog surface.

## Scope

In:
- Author `closeout-analysis.md` covering:
  - Number of new dictionary keys per namespace.
  - The decisions recorded in milestone §6 (re-stated for posterity).
  - Screenshots at three viewports × two languages.
  - Lighthouse before / after.
  - Any defects deferred (with links to follow-up tasks if filed).
  - Explicit list of items deferred to future work (likes, replies, accessibility, telemetry, enrollment gating, per-kind media progress).
- Promote RFC 0004 to `Implemented` in both the RFC header and the RFCs README.
- Mark every task in this milestone as `✅ Done` (after their respective PRs land).

Out:
- Any new feature code.
- Backlog grooming or filing the follow-up RFCs (likes / replies, accessibility, etc.).

## Acceptance Criteria

- [x] `docs/product/milestones/11-catalog-redesign/closeout-analysis.md` exists and covers every bullet listed under "Scope".
- [x] RFC 0004 header is `Implemented` and the RFCs README table reflects the new status.
- [x] Every task in this milestone's table reads `✅ Done`.
- [x] Every Definition-of-Done checkbox in §7 of `milestone.md` is checked.
- [x] Lighthouse performance on `/catalog/<id>` is within 5 points of the pre-merge baseline (numbers captured in the closeout).
- [x] Screenshots for `< md`, `md`, and `lg` in both PT and EN are attached to the closeout (or linked from it if the repo prefers external storage).
- [x] `check-i18n-coverage.js`, `make lint`, `make test-web`, and `make test-api` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Walk `/catalog` and `/catalog/<id>` at three viewports in both PT and EN; confirm every surface matches the wireframe and capture screenshots.
2. Run Lighthouse on `/catalog/<id>` against the pre-merge baseline; record the comparison in the closeout.
3. Run `check-i18n-coverage.js`, `make lint`, `make test-web`, and `make test-api`; confirm green.
4. Open `docs/product/RFCs/README.md` and confirm RFC 0004 reads `Implemented`.
5. Open `docs/product/milestones/11-catalog-redesign/milestone.md` and confirm every checkbox is ticked.
6. `git diff --stat` confirms only documentation files are touched.
