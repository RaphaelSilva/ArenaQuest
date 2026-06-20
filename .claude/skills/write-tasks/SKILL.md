---
name: write-tasks
description: Break an ArenaQuest milestone.md into its numbered .task.md files — the RFC→milestone→tasks step downstream of write-feature. Use whenever the user wants to generate, scaffold, or break a milestone into tasks, split a feature into backend/frontend tasks, write the task breakdown, fill a milestone's §5 task table, or validate task files. Keeps backend and frontend in separate files, names them NN-<slug>.task.md, and keeps the milestone's §5 table in sync.
---

In ArenaQuest, a **milestone** (`docs/product/milestones/<N>-<slug>/milestone.md`,
derived from an RFC by `write-feature`) is delivered as a set of numbered
`.task.md` files in the same folder. The milestone says *what* the slice must do;
each task is one independent, 1–2-session PR. This skill owns the
**milestone → tasks** step: it scaffolds task files in the house structure,
**splits backend and frontend into separate files**, and keeps the milestone's §5
Task Breakdown table in sync. Two dependency-free Node scripts back it:

- **`new-task.mjs`** — reads a milestone.md, computes the next `NN`, and scaffolds
  `NN-<slug>.task.md` from the matching template (backend or frontend) with the
  Status / Milestone / RFC / Team / Depends-On header pre-wired.
- **`check-task.mjs`** — validates task files against the standard and checks that
  every task file appears in the milestone's §5 table. Non-zero exit on a hard
  violation, so it drops into a pre-commit hook or CI.

Paths below are **relative to the repo root**. Run the scripts from the repo root
with Node (stdlib only — no install).

## Where this sits

`write-rfc` → **`write-feature`** (RFC → milestone.md) → **`write-tasks`** (this
skill: milestone.md → the `.task.md` files + filled §5 table). `write-feature`
deliberately leaves §5 as a stub "until you author the task files" — that is the
gap this skill fills. It supersedes the older `task-writer` persona, whose
frontmatter-`status` template predates the current task structure; follow the
templates here, not that one.

## The task standard (milestones 8 onward)

A modern task file has, in this order:

1. **Filename** `NN-<kebab-slug>.task.md` — `NN` is the zero-padded execution
   order (`01`, `02`, …); the slug is a kebab summary of the title.
2. **Title** `# Task NN — <Backend|Frontend>: <Title> (Phase P)` — the `(Phase P)`
   suffix is optional.
3. **Metadata** lines: `**Status:**` (📝 Open → 🚧 In Progress → ✅ Done),
   `**Milestone:**` link, `**RFC:**` link (carried over from the milestone's
   "Derived from" line), `**Team:**` (`Backend API` or `Frontend Web`), and
   `**Depends On:**` for dependent tasks (a Frontend task names its Backend task).
4. **Sections** (`## `): Summary, Dependencies, Technical Constraints, Scope,
   Acceptance Criteria, Verification Plan.
5. **Scope guardrail** — a `**Scope guardrail:**` bullet inside Technical
   Constraints listing the *exact* files/directories the task may touch. This is
   what lets a reviewer reject an out-of-scope diff by quoting it; the
   Acceptance Criteria end with a matching "No diff outside the scope guardrail"
   line and Verification ends by confirming `git diff --stat`.

Legacy tasks (milestones 1–7, a `## Metadata` block, no `**Team:**` line) predate
this and are intentionally **not** validated.

## Backend vs frontend — always separate files

A feature that spans both layers becomes **two tasks**, never one mixed file:

- The **Backend** task (`--team backend`) owns the migration, shared
  types/ports, adapter, controller (`ControllerResult<T>`), route, and API tests.
  Its guardrail fences to `apps/api/**` and `packages/shared/**`; it must not
  touch `apps/web/`.
- The **Frontend** task (`--team frontend`) owns the page/component/hook, the
  existing API client call, the i18n keys, and component tests. Its guardrail
  fences to `apps/web/**`; it must not touch `apps/api/src/`. It carries a
  `**Depends On:**` line pointing at the backend task — frontend never ships
  ahead of the contract it calls.

This separation keeps each task one owner, one PR, and one review surface. The
split is encoded by the **Team** line + the chosen template; marking the slug
(`frontend-…` / `backend-…`) is optional and only for at-a-glance scanning —
modern milestones use plain descriptive slugs and rely on the Team line.

## Scaffold the tasks for a milestone

Plan the breakdown first by **reading the milestone**: its §2 Functional
Requirements and §4 Specific Stack tell you how many tasks there are, where the
backend/frontend seams fall, and the dependency order. Then scaffold each:

```bash
# Backend task (auto-numbered 01, reuses the milestone's RFC link)
node .claude/skills/write-tasks/new-task.mjs \
  --milestone 13 --team backend \
  --title "Brand config port and adapter" --phase 1

# Frontend task that depends on the backend one
node .claude/skills/write-tasks/new-task.mjs \
  --milestone 13 --team frontend \
  --title "Logo and footer brand surfaces" --phase 2 --depends 01
```

`--milestone` accepts a number (`13`), a slug fragment (`white-label`), or a
path. Options: `--slug` (override the slug), `--order NN` (override the number),
`--rfc <path>` (override the inherited RFC link), `--status`, `--depends NN,NN`
(comma-separated sibling orders → resolved to `Depends On` links), `--dir`
(default `docs/product/milestones`).

Each run prints the created path on stdout and, on stderr, the **ready-to-paste
§5 table row**. After scaffolding all tasks:

1. **Fill every section by reading the milestone and the source RFC** — the
   scaffolder produces structure, not content. Translate the milestone's
   Functional Requirements into Summary + Scope, name the exact files in the
   Scope guardrail, and write Acceptance Criteria whose signals are observable.
   **No implementation code** in a task file (no SQL, TypeScript, JSX, or
   pseudocode) — describe the contract, not the how.
2. **Update the milestone's §5 Task Breakdown** — paste each printed row into the
   `| # | Task File | Phase | Team | Status |` table, then update the dependency
   graph and the recommended execution order to match.

## Validate

Check one milestone's tasks **and** that its §5 table is in sync:

```bash
node .claude/skills/write-tasks/check-task.mjs --milestone 13
```

Check specific task files, or every modern milestone:

```bash
node .claude/skills/write-tasks/check-task.mjs docs/product/milestones/13-white-label-branding/01-*.task.md
node .claude/skills/write-tasks/check-task.mjs
```

Output: `✓` clean, `⚠` advisory (exit 0), `✗` hard violation (exit 1).
**ERROR** = bad filename, missing/mismatched `# Task NN —` heading, missing
`**Status:**`/`**Milestone:**`/`**Team:**`, a wrong Team value, a missing `## `
section, no Scope guardrail, or a task file absent from the §5 table.
**warn** = missing RFC link, no gate command (`make test-api`/`test-web`) in
Acceptance Criteria, no "No diff outside" line, no `git diff` in Verification, a
cross-layer path in the guardrail (backend touching `apps/web/`, or frontend
touching `apps/api/src/`), leftover `{{placeholders}}`, or a §5 row pointing at a
missing file.

## Gotchas

- **A scaffolded task is structurally `✓` but content-empty.** The templates
  carry guidance prose, not real scope — `check-task.mjs` validates *structure*,
  so a stub can pass. Treat a green check as "skeleton OK," then write the prose
  and re-run.
- **The §5 sync error fires until you paste the rows.** `new-task.mjs` does not
  edit `milestone.md` (auto-mutating a markdown table is fragile) — it prints the
  row for you to paste. `check-task.mjs --milestone N` then enforces that no task
  file is orphaned from the table.
- **`new-task.mjs` refuses to overwrite.** Re-running with the same title is safe;
  it errors rather than clobbering. Use `--order`/`--slug` to place a task
  deliberately (e.g. inserting between existing ones).
- **Numbering reads the folder, not the table.** The next `NN` is the highest
  leading integer across `NN-*.task.md` files + 1, so a deleted file leaves a gap
  unless you pass `--order`.
- **Exit codes via the WSL bridge.** `wsl.exe … bash -c '…; echo $?'` can swallow
  the real code — observe it with `&&`/`||`: `node …/check-task.mjs && echo PASS
  || echo FAIL`.

## Files

- `.claude/skills/write-tasks/new-task.mjs` — scaffolder (Node, stdlib only).
- `.claude/skills/write-tasks/check-task.mjs` — validator + §5 table-sync check.
- `.claude/skills/write-tasks/template-backend.md` — Backend task body skeleton.
- `.claude/skills/write-tasks/template-frontend.md` — Frontend task body skeleton.

## Related skills

- **`write-feature`** — the upstream step. Produces the `milestone.md` this skill
  breaks down, and leaves §5 stubbed for this skill to fill.
- **`write-rfc`** — two steps upstream. Produces the RFC the milestone derives
  from and that each task's `**RFC:**` line links back to.
