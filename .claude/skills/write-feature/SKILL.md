---
name: write-feature
description: Scaffold and validate an ArenaQuest feature (a milestone) from an input RFC, so every milestone.md in docs/product/milestones follows the same RFC-derived structure (numbered folder, status + "Derived from RFC", scope guardrail, the canonical sections, task-breakdown table).
Triggers: write feature, create feature, new feature, scaffold feature, feature from rfc, write milestone, create milestone, milestone from rfc, validate milestone, check milestone
---

In ArenaQuest a **feature** is a **milestone**: a folder
`docs/product/milestones/<N>-<kebab-title>/` whose central artifact is
`milestone.md`, **derived from an RFC** and broken into numbered `.task.md`
files. The RFC says *why* and *what* at proposal altitude; the milestone turns
it into a scoped, sequenced delivery plan; `task-writer` then writes the
individual tasks. This skill owns the **RFC → milestone.md** step with two
dependency-free Node scripts:

- **`new-feature.mjs`** — reads an RFC, computes the next milestone number, and
  scaffolds `<N>-<slug>/milestone.md` from `template.md` with the
  "Derived from [RFC NNNN]" link pre-wired.
- **`check-feature.mjs`** — validates one or all milestone docs against the
  standard; non-zero exit on a hard violation, so it drops into a pre-commit
  hook or CI.

Paths below are **relative to the repo root**. Run them from the repo root.

> **The `.claude/skills/` directory is a symlink to `.agents/skills/`.** It
> resolves fine for the Node runtime (Linux). The Windows `\\wsl.localhost`
> bridge can't traverse the symlink — if a tool errors with `ENOTDIR` /
> `Input/output error` on `.claude/skills/...`, use the real path
> `.agents/skills/write-feature/...` instead. Both point at the same files.

## The standard

The modern, RFC-derived milestone (milestones 8 onward) has, in this order:

1. **Folder** `<N>-<kebab-title>/` — `N` = highest existing milestone number + 1.
2. **Title** `# Milestone N — <Title>`.
3. **Metadata:** `**Status:**` (📝 Draft → Planning → In Progress →
   ✅ Implemented/Completed) and a `**Scope:**` line ending in
   `Derived from [RFC NNNN](../../RFCs/NNNN-...md)`.
4. **Hard scope guardrail** — a `>` blockquote that fences the milestone to
   specific files and names each RFC Non-Goal it must not touch.
5. **Sections** (`## N.`): Objectives (+ Out of scope), Functional Requirements,
   Acceptance Criteria, Specific Stack, Task Breakdown (table + dependency graph
   + recommended order), Decisions recorded, Definition of Done. See
   `template.md` for the per-section prose guidance.

Legacy milestones 1–7 predate this skeleton and are intentionally **not**
validated (the checker only inspects folders whose `milestone.md` carries a
`Derived from [RFC ...]` line).

## Create a feature from an RFC (agent path)

```bash
node .agents/skills/write-feature/new-feature.mjs --rfc docs/product/RFCs/0006-white-label-branding-and-build-tooling.md
```

Prints the created path (e.g.
`docs/product/milestones/13-white-label-branding-and-cloudflare-build-tooling/milestone.md`)
and recovers the RFC number + title from its `# RFC NNNN: …` heading. Options:
`--title` (override the milestone title), `--slug` (override the folder slug),
`--status` (default `📝 Draft`), `--dir` (default `docs/product/milestones`).

Then **fill every `## N.` section by reading the source RFC** — the template
body explains what belongs in each. The scaffolder produces structure, not
content: translate the RFC's Goals into §1 Objectives, its Non-Goals into the
guardrail + Out-of-scope, its Proposed Design into §2/§4, its Resolved Decisions
into §6. Leave §5's task table as the stub until you author the `.task.md` files
with **`task-writer`** (`.agents/skills/task-writer/`), then fill the table,
dependency graph, and recommended order.

## Validate (agent path)

Check every modern milestone:

```bash
node .agents/skills/write-feature/check-feature.mjs
```

Check the milestone you just wrote:

```bash
node .agents/skills/write-feature/check-feature.mjs docs/product/milestones/13-white-label-branding-and-cloudflare-build-tooling/milestone.md
```

Output: `✓` clean, `⚠` advisory (still has template stubs — exit 0), `✗` hard
violation (exit 1). **ERROR** = missing `# Milestone N —` title, missing
`**Status:**`, missing/broken `Derived from [RFC ...]` link, missing scope
guardrail, or a missing canonical `## N.` section. **warn** = leftover
`{{placeholders}}`, the stub task-table row, or template placeholder bullets
(`<Outcome>`, `<Decision>`, …) — these don't block, but a finished milestone
should have none.

## Gotchas

- **A freshly scaffolded doc passes with `⚠`, not `✗`.** It is structurally
  complete (all sections present) but its content is still template stubs.
  `⚠` exit 0 is the signal "structure OK, now write the prose." Don't treat the
  warnings as failures — treat them as a to-do list, and re-run until `✓`.
- **`.claude/skills` is a symlink** (→ `.agents/skills`). Native file tools
  reaching it over the Windows bridge throw `Input/output error`; run scripts
  through the WSL Node runtime, or edit files via `.agents/skills/write-feature/`.
- **In a git worktree, `.agents/` is its own checkout, not shared with the main
  repo.** Write the skill (and any milestone) into the worktree you're working
  in — a file created under the main repo's `.agents` is invisible to a
  worktree shell, and vice-versa.
- **Exit codes are swallowed by the `wsl.exe … bash -c '… ; echo $?'` bridge**
  — `$?` can read as 0 even when Node exited non-zero. To observe the real
  result use `&&`/`||` evaluated inside WSL:
  `node …/check-feature.mjs && echo PASS || echo FAIL`.
- **Numbering reads the directory, not any index.** The next number follows the
  highest leading integer across all milestone folders (`12-...`, `3-extends`,
  plain `7`), so a skipped or deleted folder doesn't shift it.
- **One milestone ≠ one RFC always.** A large RFC can spawn several milestones
  (re-run `new-feature.mjs` per slice with distinct `--slug`/`--title`); a small
  RFC maps 1:1. The `Derived from` link is many-milestones-to-one-RFC.

## Files

- `.agents/skills/write-feature/new-feature.mjs` — scaffolder (Node, stdlib only).
- `.agents/skills/write-feature/check-feature.mjs` — validator (Node, stdlib only).
- `.agents/skills/write-feature/template.md` — the canonical milestone skeleton
  with per-section prose guidance; `new-feature.mjs` fills its `{{...}}`
  placeholders.

## Related skills

- **`write-rfc`** — the upstream step. Produces the RFC this skill consumes.
- **`task-writer`** — the downstream step. Writes the `.task.md` files that §5's
  Task Breakdown indexes, keeping backend and frontend in separate files.
