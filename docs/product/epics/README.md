# Epics

Bodies of work too large for one task and too small, or too cross-cutting, for a
numbered milestone. An epic is identified by its **creation date + subject** —
`<YYYY-MM-DD>-<subject>/<YYYY-MM-DD>-<subject>.epic.md` — never by a sequence
number, so two planning branches opened on the same day cannot collide unless
they pick the same subject. Its tasks live in the same folder as
`NN-<slug>.task.md`. Scaffold and validate with the `write-epic` skill.

## Index

| Epic | Title | Status | Derived from | Date |
|------|-------|--------|--------------|------|
| [2026-09-29-e2e-test-phase](./2026-09-29-e2e-test-phase/2026-09-29-e2e-test-phase.epic.md) | End-to-end test phase — Playwright suite gating main | Draft | — | 2026-09-29 |

## Legacy

Folders that predate this standard. They carry no `*.epic.md`, so
`check-epic.mjs` does not inspect them.

- [`design-system/`](./design-system/design-system.plan.md) — Design System standardization plan.

## Status lifecycle

| Status | Meaning |
|---|---|
| Draft | Being written, not ready for review |
| Planned | Reviewed and merged; tasks written, not started |
| In Progress | Tasks are being executed |
| Done | Every acceptance criterion holds on `main` |
| Cancelled | Decided not to pursue |
| Superseded | Replaced by another epic, milestone or RFC — link it |

Keep the status in the epic's own header and this table in sync, stated against
the code in `main`, not against intent.
