# Task 08 — Frontend: Two-rail roster, reports and statement panel (Phase 4)

**Status:** ✅ Done
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Frontend Web
**Depends On:** [Task 04](./04-two-rail-standing-and-roster.task.md), [Task 05](./05-per-rail-reports-statement-and-me-billing.task.md)

## Summary

Shows the administrator both rails side by side, never one merged figure (RFC 0015 §8,
Resolved #5). The **roster** renders, per student, a *Monthly fee* badge (contract standing, or
"no contract") and an *Extras* badge (extras standing, or a dash), each with its own outstanding
amount and overdue count, above two independent filters. "Monthly fee: delinquent" is the view
used before a manual access decision; "Extras: delinquent" answers which event payments slipped
through. The **reports tab** gets a rail switch on aging (defaulting to the contract rail, so
the current view is unchanged) and shows, on movement, the contract block, the extras block
and the till total as three separate groups. The **admin statement panel** keeps its contract
section as is and adds a separate Extras section — each charge with event title, event date,
due date, balance and its own standing badge. This task consumes the reshaped roster from
Task 04, which is a breaking contract change: the two must reach `main` in the same merge.

## Dependencies

- [Task 04](./04-two-rail-standing-and-roster.task.md) — the reshaped roster entry and its
  two filters. **Release coupling:** ships in the same candidate merge.
- [Task 05](./05-per-rail-reports-statement-and-me-billing.task.md) — movement `extras` block,
  aging `rail` parameter, statement `extras` object.
- Existing pieces extended: `apps/web/src/app/(protected)/admin/billing/{students-tab.tsx,reports-tab.tsx,student-statement-panel.tsx,standing-badge.tsx}`
  and the billing API client under `apps/web/src/lib/`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/{students-tab.tsx,reports-tab.tsx,student-statement-panel.tsx,standing-badge.tsx}`
    and their tests under `apps/web/src/app/(protected)/admin/billing/__tests__/`.
  - `apps/web/src/lib/` — the billing API client's types and roster/report calls.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
  - `apps/web/src/app/(protected)/layout.tsx` — **only** if the existing billing nav badge
    reads the roster's old top-level standing; it must then read the contract rail.
- **No merged figure** anywhere on these screens; the till total is labelled as cash received.
- **i18n.** No hardcoded user-facing strings; identical keys; `check-i18n-coverage.js` passes.
- **Accessible.** Badges carry text, not colour only.

## Scope

In:
- Roster: two badges, two amounts, overdue count, two filters, "no contract" state for
  extras-only buyers.
- Reports: aging rail switch; movement rendered as contract / extras / cash-received groups.
- Statement panel: separate Extras section with its own standing badge.
- Updated client types for the reshaped roster, movement and statement.
- Component tests for each surface, including the extras-only buyer row.

Out:
- The Extras tab — Task 07. Student `/settings/billing`, plans link, events panel — Task 09.
- Any backend change.

## Acceptance Criteria

- [x] A roster row for contract paid-up + overdue charge shows *Monthly fee: good* and
      *Extras: delinquent*.
- [x] An extras-only buyer's row shows "no contract" for the monthly fee and a resolved extras badge.
- [x] Filtering by monthly fee and by extras are independent; each issues the matching query
      parameter.
- [x] The aging view opens on the contract rail; switching to extras refetches with
      `rail=extras`.
- [x] Movement shows the three groups and no single combined "received" other than the
      cash-received line.
- [x] The statement panel shows contract and extras sections separately, each with its own badge.
- [x] The existing billing nav badge (if any) keeps reflecting the contract rail only.
- [x] No hardcoded user-facing string; keys exist in both dictionaries;
      `check-i18n-coverage.js` passes.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-api` + `make dev-web` on the seeded local D1; open Admin → Billing → Students.
2. Confirm the two isolation scenarios and the extras-only buyer; apply each filter.
3. Open Reports; switch the aging rail; read the movement groups for the seed month.
4. Open the extras-only buyer's statement panel.
5. Toggle `NEXT_PUBLIC_LANGUAGE`; resize to mobile.
6. `make test-web`; run `check-i18n-coverage.js`.
7. `git diff --stat` confirms only scope-guardrail files changed.
