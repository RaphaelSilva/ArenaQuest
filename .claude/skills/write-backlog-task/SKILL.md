---
name: write-backlog-task
description: Write a standalone ArenaQuest backlog task — a technical task that does NOT need an RFC (small feature, bug, refactor, tech debt, chore) — into docs/product/backlog/<topic>/NN-<slug>.task.md. Use when the user wants to "add to the backlog", "file a bug", "write a task without an RFC", "register tech debt", or describes a change small enough to ship in one or two PRs. Picks a collision-free number, applies the right template per kind, splits backend/frontend into separate files, validates the result, and tells the user when the request is too big and should become an RFC instead.
Triggers: backlog task, add to backlog, new backlog item, file a bug, write a bug report, tech debt task, refactor task, chore task, task without rfc, small feature task, validate backlog
---

ArenaQuest has two planning routes:

- **The RFC route** — `write-rfc` → `write-feature` → `write-tasks`. Use it for
  product-level change: a proposal, a milestone, and a batch of tasks.
- **The backlog route (this skill)** — one or two `.task.md` files under
  `docs/product/backlog/<topic>/`, with no RFC and no milestone. The `developer`
  skill already executes these on `feature/backlog/<topic>/<NN-slug>.task`.

This skill owns the backlog route. Two dependency-free Node scripts back it:

- **`new-backlog-task.mjs`** — scaffolds the file with its metadata header and
  the template for its kind, and picks a number no other file or branch uses.
- **`check-backlog-task.mjs`** — validates the structure, and flags duplicate
  numbers inside a topic. It exits non-zero on a hard violation.

Paths are relative to the repo root. Run the scripts from there.

## Step 0 — Backlog task or RFC?

Decide **before** scaffolding, and say which route you chose and why. Use a backlog
task when **all** of these hold:

- It ships in **one PR per layer**: at most one backend and one frontend task.
- It introduces **no new domain entity**, no new table, and no new port.
- It does **not move a security boundary**: auth, roles, audience/visibility,
  tenant isolation, CORS, secrets, or anonymous access.
- There is **no open product decision** — what to build is already agreed, and
  only the how remains.

If any of these fails, stop and recommend `write-rfc`. Name the criterion that
failed. A bug fix that needs a migration is a judgment call: the validator warns
on it, and you should mention it to the user rather than decide silently.

## Kinds and their templates

| `--kind` | Template | Kind-specific sections |
|---|---|---|
| `feature` | `template-feature.md` | Motivation |
| `bug` | `template-bug.md` | Reproduction (steps, expected, actual), Root Cause (established vs not established) |
| `refactor` / `debt` / `chore` | `template-improvement.md` | Why It Is Worth Fixing |

Every kind also has Summary, Scope (In/Out), Technical Constraints (with the
**Scope guardrail**), Acceptance Criteria, and Verification Plan.

## Scaffold

1. **Gather the input.** Get the topic, kind, team, title, priority, and where the
   problem was found. If the user's description lacks something you need (for a
   bug: the reproduction), ask for it. Do not invent it.
2. **Pick the topic.** List `docs/product/backlog/` and reuse a topic folder when
   one fits (`security`, `refactoring`, `user-experience`, `deployment`,
   `test-debt`, `user-management`, …). A new topic requires `--new-topic`, so a
   typo cannot create a stray folder.
3. **Run `git fetch origin`**, then scaffold:

```bash
# Bug in one layer
node .claude/skills/write-backlog-task/new-backlog-task.mjs \
  --topic security --kind bug --team backend \
  --title "Refresh token survives logout" \
  --priority high --found-in "Milestone 24, Task 03"

# Feature spanning both layers → two files: NN backend + NN+1 frontend (depends on NN)
node .claude/skills/write-backlog-task/new-backlog-task.mjs \
  --topic user-management --kind feature --team both \
  --title "Export enrollments as CSV"
```

Options:

- `--team`: `backend` | `frontend` | `tooling` (scripts, Makefile, CI) | `both`.
- `--priority`: `low` | `medium` (default) | `high` | `critical`.
- `--depends 03,04`: sibling task numbers in the same topic.
- `--order NN`: claim a specific number. It is refused if already taken.
- `--slug`, `--status`, `--no-git`, `--dir`.

**How numbering works.** The next `NN` is the highest number found across:

- the topic folder on disk;
- the topic on `origin/main` and on every `docs/*` branch;
- every `feature/backlog/<topic>/*` branch.

Two planning PRs in flight therefore do not collide. The topic folders already
contain past duplicates (two `01`s in `security/` and `deployment/`). Leave them
alone unless the user asks to renumber them.

## Fill

The scaffolder produces structure only. Fill every section in English:

- **No implementation code.** Describe the contract and the observable behaviour.
  Measured output (a log line, a status code, a probe result) is evidence and is
  welcome.
- **Scope guardrail:** list the *exact* files or directories the task may touch,
  after reading the code. A backend guardrail stays in `apps/api/**` and
  `packages/shared/**`; a frontend guardrail stays in `apps/web/**`.
- **Acceptance Criteria:** every criterion must be observable. End with the gate
  command (`make test-api` / `make test-web` / `make lint`) and with
  "No diff outside the scope guardrail".
- **Bugs:** separate what is *established* from what is *not established*. If the
  root cause is unknown, make finding it the first criterion. Always require a
  regression test.

## Validate

```bash
node .claude/skills/write-backlog-task/check-backlog-task.mjs --topic security
node .claude/skills/write-backlog-task/check-backlog-task.mjs docs/product/backlog/security/04-*.task.md
node .claude/skills/write-backlog-task/check-backlog-task.mjs            # every topic
```

The output marks each file `✓` (clean), `⚠` (advisory, exit 0), or `✗` (exit 1).

**ERROR** for any of:

- a bad filename;
- a missing or mismatched `# Task NN — <Backend|Frontend|Tooling>: …` heading;
- a missing Status, Kind, or Team, or an unknown Kind or Team value;
- a heading team that differs from the Team line;
- a missing required section;
- no Scope guardrail.

**warn** for any of:

- no Priority or Found in;
- no gate command, no "No diff outside" line, or no `git diff` in Verification;
- a cross-layer guardrail;
- a guardrail that adds a migration (an RFC signal);
- a Bug without a regression criterion;
- a dangling Depends On link;
- leftover `{{placeholders}}`;
- a duplicate number in the topic.

Older backlog files have no `**Kind:**` line. They are skipped and only counted.

## Where to work and what comes next

A backlog task is planning, so it follows the planning-worktree rule in
`write-rfc` (*Where to work*):

```bash
make worktree-open KIND=docs SLUG=backlog-<topic>-<slug>
```

Commit there with `docs(backlog): …` and open the PR to `main` only after the user
confirms. Several related backlog tasks can share one planning PR.

After the planning PR merges, execution goes through the `developer` skill. It
runs `make worktree-open KIND=backlog TOPIC=<topic> SLUG=<NN-slug>`, and its branch
is `feature/backlog/<topic>/<NN-slug>.task`.

## Gotchas

- **A fresh scaffold is `⚠`, not `✓`.** The templates contain `{{placeholders}}`
  on purpose, so a file nobody filled in cannot look finished.
- **`--team both` suffixes the slugs** with `--backend` / `--frontend`. The two
  files then share a readable stem and stay distinct.
- **Do not use this skill to sneak an RFC through as a series of backlog tasks.**
  Three or more backlog tasks on the same subject is the signal to escalate.

## Files

- `new-backlog-task.mjs` — the scaffolder (Node, stdlib only).
- `check-backlog-task.mjs` — the validator plus the duplicate-number check.
- `template-feature.md`, `template-bug.md`, `template-improvement.md` — the body
  skeletons, one per kind.

## Related skills

- **`write-rfc`** — the heavier route, and where escalated requests go.
- **`write-tasks`** — the milestone-scoped equivalent of this skill.
- **`developer`** — executes a backlog task once its planning PR has merged.
