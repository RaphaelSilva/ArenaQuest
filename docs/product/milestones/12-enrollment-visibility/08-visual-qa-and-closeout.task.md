# Task 08 — Visual QA, closeout, and RFC 0005 status update

**Status:** Open
**Milestone:** [12 — Enrollment enforcement and node visibility](./milestone.md)
**RFC:** [0005 — Enrollment enforcement and node visibility](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Team:** Backend API + Frontend Web (QA)

## Summary

Close out the milestone: run the end-to-end visibility + enrollment QA flow on staging, confirm every Success Criterion from RFC 0005, write a closeout note, and flip the RFC status to `Implemented`. No feature code — verification, documentation, and status bookkeeping only.

## Dependencies

- Tasks 01–07 all `Done`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `docs/product/milestones/12-enrollment-visibility/closeout-analysis.md` — new closeout note.
  - `docs/product/RFCs/0005-enrollment-exclusions-and-visibility.md` — status header `Draft` → `Implemented`.
  - `docs/product/RFCs/README.md` — RFC 0005 status update.
- **No source code change.** This task is QA + docs. Any defect found is filed as a follow-up task, not patched here.
- **Staging QA uses test credentials only.** Source credentials and test data exclusively from `.envs.test`; never from `.env` / `.dev.vars` / production stores.
- **Deferred items stay deferred.** The closeout must list denies / "Excluded topics", time-bounded access, per-media exclusions, per-creator scoping, and `PUBLIC` comment abuse as explicitly out of scope, not as gaps.

## Scope

In:
- Execute the full QA matrix on staging and record results:
  - a participant granted 1 of N topics sees exactly that subtree in `GET /topics` (Phase 0 fix, the original bug no longer reproduces);
  - an admin marks a topic `PRIVATE` and confirms it disappears from every non-admin response while remaining reachable in `/admin/topics/*`;
  - a `PUBLIC` topic appears for a freshly-registered, zero-grant user and is commentable by them;
  - `DRAFT` and `archived` topics never appear in `GET /topics` / `GET /topics/:id` for anyone, including admins/creators;
  - existing grants behave identically to before (cascade preserved);
  - the unified Access page manages grants and the detail-page deep-links work.
- Capture the resolver p95 on the 1,000-topic benchmark fixture (`< 50 ms`).
- Record new dictionary key counts and confirm `check-i18n-coverage.js` passes in both PT and EN.
- Write `closeout-analysis.md` summarizing results, decisions, screenshots (admin selector, Access page, participant catalog before/after a `PRIVATE` flip), and the benchmark figure.
- Flip RFC 0005 status to `Implemented` in the header and `README.md`; keep deferred items listed as backlog.

Out:
- Any feature or bug-fix code (file follow-up tasks instead).
- Implementing any Deferred item.

## Acceptance Criteria

- [ ] Every RFC 0005 Success Criterion is verified on staging and recorded in the closeout note.
- [ ] The Phase 0 bug (participant seeing ungranted topics) is confirmed no longer reproducible.
- [ ] A `PRIVATE` topic is confirmed admin-only; a `PUBLIC` topic is confirmed visible + commentable to a zero-grant user; `DRAFT` / `archived` confirmed invisible to all.
- [ ] Resolver p95 `< 50 ms` recorded on the 1,000-topic fixture.
- [ ] `check-i18n-coverage.js` passes; new key counts per dictionary recorded.
- [ ] `closeout-analysis.md` exists with results, decisions, screenshots, and benchmark.
- [ ] RFC 0005 status is `Implemented` in both the header and `README.md`; deferred items remain listed as backlog.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green on the merge.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Deploy the merged milestone to staging (`make deploy-staging`).
2. Using `.envs.test` credentials, walk the full QA matrix above and record pass/fail per item.
3. Run the resolver benchmark and capture the p95.
4. Run `check-i18n-coverage.js`; record key counts.
5. Capture the required screenshots at desktop and mobile widths, in both PT and EN.
6. Write `closeout-analysis.md`; update the RFC header and `README.md` status.
7. `git diff --stat` confirms only the three doc files changed.
