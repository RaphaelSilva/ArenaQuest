---
name: write-rfc
description: Scaffold and validate ArenaQuest RFCs against the house standard so every proposal in docs/product/RFCs follows the same structure (numbered file, metadata header, canonical sections, README index row).
Triggers: write rfc, create rfc, new rfc, draft rfc, scaffold rfc, rfc template, rfc standard, validate rfc, check rfc
---

ArenaQuest keeps formal proposals in `docs/product/RFCs/` as
`NNNN-<kebab-title>.md`, indexed by `docs/product/RFCs/README.md`. This skill
enforces that standard with two dependency-free Node scripts:

- **`new-rfc.mjs`** — scaffolds the next-numbered RFC from `template.md` and
  appends its index row to the README.
- **`check-rfc.mjs`** — validates one or all RFCs against the standard;
  non-zero exit on a hard violation, so it drops into a pre-commit hook or CI.

Paths below are **relative to the repo root** (`docs/product/RFCs`, the
scripts under `.claude/skills/write-rfc/`). Run them from the root **of the
planning worktree** (see *Where to work*), never from the root checkout on `main`.

> **The `.claude/skills/` directory is a symlink to `.agents/skills/`.** It
> resolves fine for the Node runtime (Linux). The Windows `\\wsl.localhost`
> bridge can't traverse the symlink — if a tool errors with `ENOTDIR` /
> `Input/output error` on `.claude/skills/...`, use the real path
> `.agents/skills/write-rfc/...` instead. Both point at the same files.

## Where to work: the planning worktree

Planning is written in its **own git worktree and ships as its own PR**, separate
from any code. The root checkout stays on `main`; one planning worktree carries the
whole documentation chain — RFC (`write-rfc`) → milestone (`write-feature`), or the
backlog/epic structure → task files (`write-tasks`) — until it is ready for review.

| What is being planned | Branch | Worktree |
|---|---|---|
| A new RFC (and everything derived from it) | `docs/rfc-<NNNN>-<slug>` | `.worktrees/rfc-<NNNN>-<slug>` |
| Planning with no new RFC (backlog/epic item, milestone for an already-merged RFC) | `docs/<slug>` | `.worktrees/docs-<slug>` |

1. **Pick the number.** `new-rfc.mjs` numbers from the directory, so derive
   `<NNNN>` from the trunk *and* from RFC branches still in flight, or two open PRs
   collide on the same number:
   ```bash
   git fetch origin
   git ls-tree --name-only origin/main docs/product/RFCs/ | grep -E '/[0-9]{4}-'
   git branch -r --list 'origin/docs/rfc-*'
   ```
2. **Open the worktree from the root checkout** (on `main`, clean) and route the
   session into it. The helper bases the branch on `origin/main` and marks the
   worktree as managed:
   ```bash
   make worktree-open KIND=rfc NUMBER=<NNNN> SLUG=<slug>   # or KIND=docs SLUG=<slug>
   cd .worktrees/rfc-<NNNN>-<slug>
   ```
   Docs-only work needs no `make setup` — the skill scripts are stdlib Node.
3. **Iterate there** until the chain is ready: scaffold and fill the RFC, then the
   milestone / backlog / epic structure and its task files, validating each with its
   `check-*.mjs`. Commit as you go (`docs(rfc): …`, `docs(milestone): …`).
4. **Push and open the PR to `main`** (the PR only on explicit user confirmation):
   `git push -u origin docs/rfc-<NNNN>-<slug>`.
5. **Keep the worktree until the merge.** The worktree stays on disk while the PR is under review, so requested changes are
   made right there. Once the PR is **merged into `main`**, the sweep removes it: the
   Claude Code `SessionStart` hook (`.claude/settings.json`) runs the same sweep
   on every session start, and it can be run by hand (`make worktree-sweep`,
   `DRY_RUN=1` to preview). It only touches worktrees opened by `make worktree-open`
   (they carry a marker), and skips any that is dirty, has commits the PR does not, or
   holds the current session.
6. **After the PR merges into `main`,** execution starts in a *new* feature worktree
   opened by the `developer` skill (`.worktrees/m<N>-candidate`, from `origin/main`).

Never touch a worktree you did not open — `git worktree list` may show worktrees
owned by another process — and never use bare `git stash` (the stash is shared by
every worktree).

## The standard

Every RFC has, in this order:

1. **Filename** `NNNN-<kebab-title>.md` — 4-digit zero-padded, sequential.
2. **Title** `# RFC NNNN: <Title>` — number matches the filename.
3. **Metadata block** (bold fields): `**Status:**`, `**Author:**`, `**Date:**`
   (PT `Autor:` / `Data:` accepted), plus optional `**Revised:**` and an
   `**Affected:**` file list. Then a `---` divider.
4. **Sections** (`##`): Summary, Motivation, Goals & Non-Goals, Current State
   *(omit if greenfield)*, Proposed Design, Alternatives Considered,
   Implementation Plan, Tradeoffs & Risks, Success Criteria, Open/Resolved
   Decisions, References. See `template.md` for the prose guidance per section.
5. **README index row** in `docs/product/RFCs/README.md`.

**Status lifecycle:** Draft → Proposed → Approved → In Progress →
Implemented/Done/Completed; or Rejected / Superseded.

## Create a new RFC (agent path)

```bash
node .claude/skills/write-rfc/new-rfc.mjs "Title of the proposal" --author raphaelsilva
```

Prints the created path (e.g. `docs/product/RFCs/0007-title-of-the-proposal.md`)
and adds the README index row. Options: `--status` (default `Draft`),
`--date YYYY-MM-DD` (default today), `--author` (default `git config user.name`),
`--dir` (default `docs/product/RFCs`). Then fill in each `##` section — the
template body explains what belongs in each.

## Validate (agent path)

Check every RFC in the directory:

```bash
node .claude/skills/write-rfc/check-rfc.mjs
```

Check a single file (use this on the RFC you just wrote):

```bash
node .claude/skills/write-rfc/check-rfc.mjs docs/product/RFCs/0005-enrollment-exclusions-and-visibility.md
```

Output: `✓` clean, `⚠` recommended section missing (advisory — exit 0),
`✗` hard violation (exit 1). **ERROR** = wrong filename, missing/mismatched
`# RFC NNNN` title, missing Status/Author/Date metadata, or not linked from the
README index. **warn** = a recommended `##` section is absent (older RFCs
predate the full skeleton, so these don't block).

## Gotchas

- **`.claude/skills` is a symlink** (→ `.agents/skills`). Native file tools
  reaching it over the Windows bridge throw `Input/output error`; run scripts
  through the WSL Node runtime, or edit files via `.agents/skills/write-rfc/`.
- **Exit codes are swallowed by the `wsl.exe … bash -c '… ; echo $?'` bridge**
  — `$?` reads as 0 even when Node exited non-zero. To observe the real result
  use `&&`/`||` evaluated inside WSL:
  `node …/check-rfc.mjs && echo PASS || echo FAIL`.
- **The standard is advisory for legacy RFCs.** 0001 is Portuguese (`Autor:`/
  `Data:` — accepted) and 0003 embeds its date inside the Status line, so
  `check-rfc.mjs` flags 0003 as `✗ missing Date`. That is a real, known gap in
  an existing doc, not a script bug — don't "fix" the validator to hide it.
- **Numbering reads the directory**, not the README. If a number was skipped or
  a draft file deleted, the next number follows the highest existing
  `NNNN-*.md`, not the index.

## Files

- `.claude/skills/write-rfc/new-rfc.mjs` — scaffolder (Node, stdlib only).
- `.claude/skills/write-rfc/check-rfc.mjs` — validator (Node, stdlib only).
- `.claude/skills/write-rfc/template.md` — the canonical section skeleton with
  per-section prose guidance; `new-rfc.mjs` fills its `{{...}}` placeholders.
