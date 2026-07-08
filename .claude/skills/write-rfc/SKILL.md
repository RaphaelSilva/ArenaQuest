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
scripts under `.claude/skills/write-rfc/`). Run them from the repo root.

> **The `.claude/skills/` directory is a symlink to `.agents/skills/`.** It
> resolves fine for the Node runtime (Linux). The Windows `\\wsl.localhost`
> bridge can't traverse the symlink — if a tool errors with `ENOTDIR` /
> `Input/output error` on `.claude/skills/...`, use the real path
> `.agents/skills/write-rfc/...` instead. Both point at the same files.

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
