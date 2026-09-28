# Task 06 — Backend: Daily run — extras reminders and per-rail crossings (Phase 3)

**Status:** 📝 Open
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-two-rail-standing-and-roster.task.md)

## Summary

Teaches the existing daily billing run about extras, **reading only** (RFC 0015 §5). The run
still issues contract invoices exactly as before and **issues no charge and writes no row in
any `event_charge*` table** — charges are always issued by a person. It now sends the student
the **same two reminders for an extra as for a monthly fee** (Resolved #8): one on the charge's
due date and one when its grace period lapses, each worded for the event ("your charge of
R$ 150 for *Seminário de Março* is due today") and never mentioning a membership. They carry
their own reminder kinds, `extras_due_date` and `extras_grace_lapsed`, so the audit log and the
digest never mix them with contract reminders, and a **contract hold does not suppress them**
(Resolved #9). Standing crossings are computed per rail, and the admin digest reports them in
two separate sections — crossed on the monthly fee, crossed on extras — so a student may appear
in one, the other or both. The run's four written rules (writes no money, idempotent by
construction, crossings not a list, assert rather than repair) now cover both ledgers, and the
manual `POST /v1/admin/billing/invoices/run` keeps calling the very same routine.

## Dependencies

- [Task 04](./04-two-rail-standing-and-roster.task.md) — hard code dependency: per-rail
  crossings resolve each rail's standing through the readers it introduces.
- [Task 03](./03-event-charge-service-and-admin-api.task.md) — ordering preference, so
  charges can be issued locally to exercise the run end to end.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/billing/billing-service.ts` — the run routine, its report types, the
    reminder kinds and the reminder message composition.
  - `apps/api/src/index.ts` — only if the run needs the charge adapter injected into its host.
  - `apps/api/test/**` — run tests.
- **One routine, two callers.** The scheduled handler and the manual run endpoint keep calling
  the same function; no second implementation.
- **Writes no money.** No code reachable from the run calls a charge write method.
- **Hold scope.** The hold suppresses contract reminders only.
- **Idempotency.** Reminders keep the existing disjoint one-day-window rule, so a re-run of
  the same day sends no duplicate extras reminder.

## Scope

In:
- Extras reminders (two kinds) with event-specific wording, through the existing mailer
  dependency.
- Per-rail crossings and a two-section admin digest.
- Run report fields that count extras reminders sent, suppressed and undeliverable,
  separately from contract ones.
- Tests: a charge crossing each trigger; a held student still receiving extras reminders; a
  same-day re-run sending nothing new; row counts of every `event_charge*` table unchanged
  after a run.

Out:
- Any change to invoice issuance or its idempotency key.
- Any UI — the digest is e-mail; the reports tab is Task 08.

## Acceptance Criteria

- [ ] Over a simulated span covering a charge's due date and grace lapse, the run sends
      exactly one `extras_due_date` and one `extras_grace_lapsed` e-mail to that student, each
      naming the event.
- [ ] A student with an active contract hold still receives the extras reminders.
- [ ] Re-running the same day sends no additional extras reminder.
- [ ] The row counts of `event_prices`, `event_charges`, `event_charge_adjustments` and
      `event_charge_payments` are identical before and after a run.
- [ ] The admin digest lists contract crossings and extras crossings in separate sections;
      a student who crossed only on extras does not appear in the contract section.
- [ ] Contract invoice issuance and contract reminders produce the same output as before this
      task on the existing run tests.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — the run specs pass, pre-existing ones unchanged in expectation.
2. `make dev-api` with the local seed — trigger the manual run for the overdue charge's due
   date and for its grace-lapse date; inspect the run report and the captured mail.
3. `git diff --stat` confirms only scope-guardrail files changed.
