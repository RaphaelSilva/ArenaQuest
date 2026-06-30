# Spec Conversion & Doc-Pruning Plan

> **Status:** Proposal (not yet executed)
> **Author:** generated 2026-06-29
> **Purpose:** Reduce noise in `docs/product/` by (a) distilling the durable design
> knowledge of *completed* work into evergreen `docs/architecture/` specs, and
> (b) archiving/pruning the process residue that no longer adds value once work has shipped.
> **Scope:** documentation lifecycle only. No code or behavior changes.

---

## 1. The problem

`docs/product/` is 2.5 MB across **19 milestones, 11 RFCs, 162 task files, 69 plans,
47 executor-logs, 12 `planing/` dirs**. Most of that volume is *process exhaust* for
work that is already implemented and merged. It was useful while the work was in
flight; now it buries the small amount of durable knowledge a future developer
actually needs.

The fix is **not** to delete history wholesale, and **not** to copy milestones into
`docs/architecture/`. It is to separate two things that have different lifecycles.

## 2. The model: two lifecycles, one decision rule

| | Temporal (process) | Evergreen (as-built) |
|---|---|---|
| **Answers** | *what* to build, *when*, *is it done* | *how it works*, *what rules to follow* |
| **Lives in** | `docs/product/` | `docs/architecture/` |
| **Goes stale** | Yes — by design (status flips to Done) | No — kept in sync with code |
| **Examples** | RFC, milestone, `*.task.md`, `*.plan.md`, `.executor-logs/`, §5 task tables, §7 DoD | `controller-pattern.md`, `i18n-spec.md`, `auth-and-guards.md` |

**Decision rule for every artifact tied to *completed* work:**

1. Does it state a **durable rule, contract, or invariant** a future dev must follow?
   → **Distill** into an architecture spec (don't move — rewrite in spec form, verified against code).
2. Is it a **record of how/when the work happened** (plan, log, task checklist, status)?
   → **Archive or prune** (§5). It is not architecture.
3. Is the work **still Draft / Planning**?
   → **Leave it alone.** There is no "as-built" to describe yet.

> Distillation ≠ migration. The milestone stays as the historical ledger; the spec
> is a *new, smaller* document holding only the evergreen subset, in the house format
> modeled by `web/i18n-spec.md`.

## 3. Conversion mapping (product → architecture spec)

Cross-referencing the 6 Implemented/Completed milestones against existing specs:

| Milestone (status) | Source RFC | Already specced? | Action |
|---|---|---|---|
| M8 — API test optimization ✅ | RFC 0001 | ✅ `api/test-conventions.md`, `api/testing-workers.md` | none |
| M10 — Frontend i18n ✅ | RFC 0002 | ✅ `web/i18n-spec.md` | none |
| **M12 — Enrollment & node visibility ✅** | RFC 0005 | ❌ | **New: `api/enrollment-and-visibility.md`** (priority 1 — access-control rules) |
| **M15 — Gamification catalog admin ✅** | RFC 0009 | ❌ | **New: `api/gamification-catalog.md`** |
| **M16 — Player progression admin ✅** | RFC 0010 | ❌ | **New: `api/player-progression.md`** |
| M11 — Catalog redesign ✅ | RFC 0004 | partial (`web/design-system-spec.md`) | Optional: fold into design-system, or small `web/catalog-ux-spec.md` |
| M9 — OpenAPI routes 📝 Draft | RFC 0003 | — | leave (not built) |
| M13 — White-label branding 📝 Draft | RFC 0006 | — | leave (not built) |
| M14 — Deployment preflight 📝 Draft | RFC 0007 | — | leave (not built) |
| M6, M7 — Planning | — | — | leave (not built) |

**Foundational gap (separate track):** M3/M4/M5 (TopicNode hierarchy, Task engine,
Progress model) are implemented but have no domain spec — only `repository-conventions.md`
and `media-upload-lifecycle.md` touch the edges. Candidate future specs:
`api/topic-node-hierarchy.md`, `api/task-engine.md`, `api/progress-model.md`.

### Distillation recipe (per spec)

Pull from the milestone's **§2 Functional Requirements** + **§6 Decisions Recorded**
(the evergreen parts), drop §1/§3/§5/§7 (objectives/acceptance/task-table/DoD — process),
reshape into the house format:

```
# <Subsystem> — Spec
> Source: RFC 000X + Milestone NN (links)
## Overview
## Quick Reference (table)
## Rules / Contracts / Invariants
## Edge cases
```

Then **verify each statement against the actual code** so the result is "as-built,"
not "as-proposed."

## 4. Noise-reduction inventory (the bigger win for you)

This is the decluttering you asked about. Residue tied to **shipped** milestones:

| Residue type | Count | Recommendation |
|---|---|---|
| `.executor-logs/**` | 47 files (12 dirs) | **Prune** — pure run logs, zero reference value. Git retains history. |
| `*.plan.md` under `planing/` | 69 files | **Archive** for shipped work; keep for in-flight. |
| `*.task.md` | 162 files | **Archive** for shipped milestones; milestone §5 table is the surviving index. |
| `*.story.md`, `*.prompt.md` | 3 files | Review individually; mostly archivable. |

Heaviest offenders: `12-enrollment-visibility/.executor-logs` (24), `7/planing` (13),
`10-frontend-i18n/.executor-logs` (10).

### Proposed convention

- **Prune outright:** `.executor-logs/` everywhere. (Add `**/.executor-logs/` to `.gitignore` going forward.)
- **Archive (don't delete):** move shipped-milestone `planing/` + `*.task.md` to a
  parallel tree, e.g. `docs/product/_archive/milestones/NN/…`, OR rely on a git tag
  (`docs-prune-2026-06-29`) + outright removal since history is recoverable.
- **Keep lean & live in `docs/product/`:** RFCs (proposals), `milestone.md` files
  (as the ledger, with status + §5 table), and anything Draft/Planning.

Net effect: a future reader sees RFC → milestone ledger → **spec** for done work, and
RFC → milestone → tasks only for *active* work.

## 5. Suggested phased rollout

1. **Phase 0 — this doc.** Agree on the model and conventions. *(you are here)*
2. **Phase 1 — pilot spec.** Write `api/enrollment-and-visibility.md`; review the format.
3. **Phase 2 — finish batch.** `api/gamification-catalog.md`, `api/player-progression.md`.
4. **Phase 3 — prune logs.** Remove all `.executor-logs/`, gitignore the pattern.
5. **Phase 4 — archive plans/tasks** for shipped milestones (M8, M10, M11, M12, M15, M16).
6. **Phase 5 — backfill (optional)** foundational specs for M3/M4/M5.

Each phase is an independent, reversible commit.

## 6. Open decisions

- **Archive vs. delete** for plans/tasks: keep a `_archive/` tree (visible, browsable)
  or trust git history (cleaner working tree)?
- **Catalog spec (M11):** fold into `design-system-spec.md` or stand up its own file?
- **Foundational specs (M3/M4/M5):** in scope now, or a later pass?
