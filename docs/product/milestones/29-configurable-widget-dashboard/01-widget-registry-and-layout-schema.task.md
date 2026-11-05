# Task 01 — Backend: Widget registry, layout schema and limits (Phase 1)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Backend API


## Summary

Creates the shared module `packages/shared/domain/dashboard/` that every other task reads: the
**widget registry**, the **layout document schema**, the **limits** and the **code default layout**.
The registry declares the ten widget types — `level`, `streak`, `ranking`, `daily_quests`,
`missions`, `weekly_challenges`, `badges`, `roadmap`, `continue`, `recommendations` — each with its
current `version`, a **strict** config schema (an unknown key is rejected), a pure `migrate` from
older versions, whether it may appear more than once (`multiple`), the scopes where it may be
configured (`label`, `group`, `student`; `recommendations` is `group` only) and the schema of the
data the dashboard returns for it. Configs: `{}` for the seven current non-roadmap types and for
`continue`; `{ startTopicId: string | null }` for `roadmap`; `{ title?, items: { topicId, reason }[] }`
for `recommendations`. A layout is an ordered list of instances `{ id, type, version, config,
locked? }`. Two readers are exported: a **strict** parser for writes (the whole document validates
or fails with the offending path) and a **tolerant** reader for reads (each instance is migrated
and validated on its own; an unknown type or an invalid config is dropped and reported, the rest
survives). `limits.ts` is the single source of truth for **12 instances per layout**, **10 items
per recommendations widget** and a **reason of 1–280 characters after trim**, with duplicate topic
ids inside one recommendations instance rejected. `default-layout.ts` reproduces today's dashboard
order exactly. `types/dashboard.ts` gains the `DashboardResponse` contract (`layout`,
`layoutSource`, `widgets` keyed by instance id). Task 02 persists layouts, Task 03 renders them,
Tasks 06–07 resolve defaults and Tasks 09–11 fill in the new widgets' data.

## Dependencies

None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/domain/dashboard/**` (new) — registry, layout schema, strict and tolerant
    readers, `limits.ts`, `default-layout.ts`, per-widget data schemas, and their specs.
  - `packages/shared/types/dashboard.ts` — add `DashboardResponse`, `WidgetInstance`,
    `LayoutSource`; the existing types stay exported for Task 03 to retire.
  - `packages/shared/index.ts` / the package's `exports` map, only to expose the new module.
- **Pure and provider-free.** Zod only; no D1, Hono, `env` or web symbol. `migrate` functions are
  pure and total (they never throw on a valid older shape).
- **One table.** The API, the web and the deploy preflight (Task 06) import this module; no layer
  re-declares a widget type, a limit or the default layout.
- **No behaviour change** anywhere outside the new module — nothing consumes it yet.

## Scope

In:
- The registry entries for all ten types, including the data schemas of the eight current widgets
  matching what the dashboard renders today (XP, streak, ranking rows, quests, missions as in
  M27, earned badges, roadmap stages).
- Strict parser, tolerant reader (returns the kept instances plus the dropped `{ instanceId, type,
  reason }` list), limits and the code default layout.
- Specs: each type round-trips its default config; strict parsing rejects 13 instances, an unknown
  type, an unknown config key, a duplicate instance id, a duplicate recommendation topic, an empty
  or 281-character reason, a `recommendations` instance outside `group` scope, and a repeated
  non-`multiple` type; the tolerant reader keeps valid instances next to an invalid one; a fixture
  "version 0" roadmap config migrates to the current version.

Out:
- Persistence and routes — Task 02. The aggregate — Task 03. Resolution of label/group defaults —
  Tasks 06 and 07. Any web change.

## Acceptance Criteria

- [ ] `packages/shared/domain/dashboard/` exports the registry, both readers, the limits and the
      default layout; the default layout lists today's eight blocks in today's order.
- [ ] Every rejection case listed in Scope is covered by a passing spec, each asserting the failing
      path.
- [ ] The tolerant reader drops exactly the invalid instance and reports it; the strict parser
      rejects the same document.
- [ ] Limits are read from `limits.ts` only (grep finds no other literal `12`, `10` or `280` tied
      to dashboards).
- [ ] Changed files lint clean; `pnpm --filter @arenaquest/shared test` and `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `pnpm --filter @arenaquest/shared test` — the new shared specs pass; `make test-api` still green.
2. `make lint` — clean.
3. Read the default layout next to `DashboardContent.tsx` and confirm the order matches.
4. `git diff --stat` confirms only scope-guardrail files changed.
