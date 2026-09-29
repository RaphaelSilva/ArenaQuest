---
name: write-epic
description: Scaffold and validate ArenaQuest epics against the house standard so every epic in docs/product/epics follows the same structure — date-keyed (`<YYYY-MM-DD>-<subject>/<YYYY-MM-DD>-<subject>.epic.md`, no sequence number), metadata header, optional "Derived from" RFC link, scope guardrail, canonical sections, task-breakdown table and README index row.
Triggers: write epic, create epic, new epic, scaffold epic, epic from rfc, validate epic, check epic
---

ArenaQuest keeps epics in `docs/product/epics/`, one folder per epic, indexed by
`docs/product/epics/README.md`. An epic is a body of work too large for one task
and too small — or too cross-cutting — for a numbered milestone. It may derive
from an RFC or stand on its own. This skill mirrors `write-rfc` with two
dependency-free Node scripts:

- **`new-epic.mjs`** — scaffolds the epic folder and file from `template.md` and
  inserts its index row, in date order, into the README.
- **`check-epic.mjs`** — validates one or all epics; non-zero exit on a hard
  violation, so it drops into a pre-commit hook or CI.

Paths below are **relative to the repo root**. Run the scripts from the root of
the planning worktree (see *Where to work*), never from the root checkout on `main`.

## Identity: a date, not a number

Unlike RFCs and milestones, an epic is **not numbered**. Its identity is the date
it was created plus a kebab-case subject:

```
docs/product/epics/2026-09-29-e2e-test-phase/
  2026-09-29-e2e-test-phase.epic.md   # the epic
  01-e2e-workspace-scaffold.task.md   # its tasks, NN-<slug>.task.md
  02-...
```

- **Why a date.** A sequence number must be derived from `main` *and* every open
  planning branch, or two PRs collide on the same number (see `write-rfc` §*Pick
  the number*). A date + subject needs no coordination: two epics only collide if
  opened on the same day with the same subject, and the scaffolder refuses that.
  It also makes the folder listing chronological.
- **The date never changes.** `**Date:**` must equal the filename's date. Later
  edits go in an optional `**Revised:**` line — renaming the folder would break
  every link and the `feature/epic/<epic_name>/…` branches built from it.
- **The folder name is `<epic_name>`.** The `developer` skill uses it verbatim for
  `feature/epic/<epic_name>/candidate` and `.worktrees/epic-<epic_name>-candidate`.
- **The default date is local, not UTC** — an epic opened at 22:00 in Brazil is
  dated that day. Pass `--date` to override.

## Where to work: the planning worktree

Planning ships as its own PR, separate from code (full rules in `write-rfc`
§*Where to work*):

| What is being planned | Branch | Worktree |
|---|---|---|
| An epic derived from a new RFC | `docs/rfc-<NNNN>-<slug>` (same PR as the RFC) | `.worktrees/rfc-<NNNN>-<slug>` |
| A standalone epic, or one for an already-merged RFC | `docs/epic-<subject>` | `.worktrees/docs-epic-<subject>` |

```bash
make worktree-open KIND=docs SLUG=epic-<subject>
cd .worktrees/docs-epic-<subject>
```

After the planning PR merges, execution starts in the epic's feature worktree,
opened by the `developer` skill.

## The standard

Every epic has, in this order:

1. **Location** `docs/product/epics/<YYYY-MM-DD>-<subject>/<YYYY-MM-DD>-<subject>.epic.md`
   — a real calendar date, a kebab subject, folder name = file stem.
2. **Title** `# Epic: <Title>`.
3. **Metadata block** (bold fields): `**Date:**` (= filename date), `**Status:**`,
   `**Author:**`, `**Derived from:**` (`[RFC NNNN](../../RFCs/…)` links, or `—`),
   optional `**Revised:**`, and an `**Affected:**` list.
4. **Scope guardrail** — a `>` blockquote fencing the epic to specific areas and
   naming each Non-Goal.
5. **Sections** (`##`): Summary, Motivation, Goals & Non-Goals, Current State
   *(omit if greenfield)*, Proposed Approach, Task Breakdown (table), Acceptance
   Criteria, Tradeoffs & Risks, Open Questions, References. See `template.md`.
6. **README index row** in `docs/product/epics/README.md`, in date order.

**Status lifecycle:** Draft → Planned → In Progress → Done; or Cancelled /
Superseded (see the README's lifecycle table).

## Create a new epic (agent path)

```bash
node .claude/skills/write-epic/new-epic.mjs "E2E test phase" --author raphaelsilva \
     --rfc docs/product/RFCs/0017-end-to-end-test-phase-playwright-suite-gating-main.md
```

Prints the created path and inserts the README row. Options:

| Option | Default | Meaning |
|---|---|---|
| `--slug` | slug of the title | The `<subject>` part — pass it to keep the folder short when the title is long or not in English |
| `--date YYYY-MM-DD` | today, local time | Validated as a real calendar date |
| `--author` | `git config user.name` | |
| `--status` | `Draft` | |
| `--rfc path` | none (`—`) | Repeatable; each becomes a `Derived from` link read from the RFC's `# RFC NNNN` heading |
| `--dir` | `docs/product/epics` | |

Then fill every section. When the epic derives from an RFC, lift Goals /
Non-Goals from it and **link** its design rather than restating it — the RFC stays
the source of truth for the *why*.

## Validate (agent path)

```bash
node .claude/skills/write-epic/check-epic.mjs                    # every */*.epic.md
node .claude/skills/write-epic/check-epic.mjs docs/product/epics/<stem>/<stem>.epic.md
```

`✓` clean, `⚠` advisory (exit 0), `✗` hard violation (exit 1).
**ERROR** = bad filename or impossible date, folder ≠ stem, missing `# Epic:`
title, missing Date/Status/Author, `Date` ≠ filename date, a `Derived from` link
that does not resolve, or no README index link. **warn** = a recommended section
is absent, or a `NN-*.task.md` in the folder is missing from the Task Breakdown
table.

## Task files

Tasks sit next to the epic as `NN-<slug>.task.md` — backend and frontend in
separate files, the same content standard as milestone tasks (see `write-tasks`).
`write-tasks`' scripts currently resolve **milestone** folders only, so for an
epic copy `template-backend.md` / `template-frontend.md` from
`.claude/skills/write-tasks/`, set the header's parent link to the epic file, and
keep the epic's Task Breakdown table in sync (`check-epic.mjs` warns on drift).

## Gotchas

- **Legacy epic folders** (e.g. `design-system/`, a `*.plan.md` with no
  `*.epic.md`) predate this standard; the checker skips them and the README lists
  them under *Legacy*. Don't rename them to "fix" the check.
- **Same day, same subject** is a collision: the scaffolder refuses to overwrite.
  Pick a more specific subject (`--slug`), don't change the date.
- **Links in the README vs. the epic differ** — the README is one level up, so its
  `Derived from` link is `../RFCs/…` while the epic's is `../../RFCs/…`. The
  scaffolder writes both; keep that in mind when editing by hand.
- Exit codes through the Windows `wsl.exe … bash -c` bridge are swallowed — use
  `node …/check-epic.mjs && echo PASS || echo FAIL` inside WSL.

## Files

- `.claude/skills/write-epic/new-epic.mjs` — scaffolder (Node, stdlib only).
- `.claude/skills/write-epic/check-epic.mjs` — validator (Node, stdlib only).
- `.claude/skills/write-epic/template.md` — the canonical skeleton with
  per-section guidance; `new-epic.mjs` fills its `{{...}}` placeholders.

## Related skills

- **`write-rfc`** — upstream when the epic derives from a proposal.
- **`write-feature`** — the numbered-milestone alternative, for RFC-sized work.
- **`write-tasks`** — the task-file standard used inside the epic folder.
- **`developer`** — executes the epic; `<epic_name>` = the epic folder name.
