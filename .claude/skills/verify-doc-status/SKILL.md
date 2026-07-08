---
name: verify-doc-status
description: Audit and standardize the Status of ArenaQuest product docs (RFCs, milestones, tasks) under docs/product against the current implementation. Use to verify whether a doc is satisfied by the code and update its status, check/report status drift, standardize how statuses are written, or reconcile a milestone with its tasks and an RFC with its milestone. Report-only on code — it points at the file to edit, it never changes implementation to make a criterion pass.
---

# verify-doc-status

Audits the **Status** of every product doc under `docs/product/` — RFCs,
milestones, and `.task.md` files — against a single canonical vocabulary, and
cross-checks the status signals against each other and against the
implementation. The engine is
[`driver.mjs`](./driver.mjs) (Node stdlib only, like the sibling
`write-*/check-*.mjs` scripts).

**Two rules define this skill:**

1. **Report-only on code.** The driver never edits a file, and you must never
   change implementation code to make a doc's criterion pass. Your job is to
   judge whether the code *already* satisfies the doc, then **edit the Status in
   the named doc file** — nothing else. If a criterion is *not* met, you say so
   in the doc (leave the box unchecked, keep the lower status); you do **not**
   open the editor on `apps/`.
2. **One canonical vocabulary.** Every status string must be exactly one of the
   canonical values below. The driver flags any other spelling and tells you the
   replacement.

| Doc type | Field | Canonical values |
|---|---|---|
| RFC | `**Status:**` header + `RFCs/README.md` index row | `Draft` · `Accepted` · `Implemented` · `Superseded` · `Rejected` |
| Milestone | `**Status:**` header | `📝 Draft` · `🏗️ Planning` · `🚧 In Progress` · `✅ Implemented` |
| Task | `**Status:**` header | `📝 Open` · `🚧 In Progress` · `✅ Done` |
| Milestone §5 table | status column token | `☐ Open` · `🚧 In Progress` · `✅ Done` |

Paths below are relative to the **repo root**; run the driver from there.

## Run (agent path)

Audit everything:

```bash
node .claude/skills/verify-doc-status/driver.mjs
```

It prints a worklist grouped by file — each finding names the file, the line,
the problem, and the exact fix — and exits non-zero when anything is off:

```
▸ docs/product/milestones/16-player-progression-administration/milestone.md
    [STALE]:3 All 2 task(s) are "✅ Done" but the milestone is "📝 Draft".
        → If §3 acceptance + §7 DoD are met, set milestone Status to "✅ Implemented".
```

Finding types: `DRIFT` (non-canonical wording) · `MISMATCH` (two sources
disagree — e.g. RFC header vs README index, §5 token vs task header) · `STALE`
(status contradicts evidence — checkboxes or child statuses) · `MISSING` (no
status line).

Scope to one doc (use after editing it, to confirm it's clean):

```bash
node .claude/skills/verify-doc-status/driver.mjs docs/product/milestones/16-player-progression-administration/milestone.md
```

Scope to a doc type, or get machine-readable output:

```bash
node .claude/skills/verify-doc-status/driver.mjs --type=rfc
node .claude/skills/verify-doc-status/driver.mjs --type=task --json
```

## The verify-and-update workflow

The driver finds the *mechanical* problems (wording, cross-reference). **You**
own the *semantic* judgment — does the implementation actually satisfy the doc?
For each finding:

1. **Read the named doc** and its acceptance criteria / Success Criteria.
2. **Check the implementation** (read code and tests; run `make test-api` /
   `make test-web` if you need proof). **Do not modify code.**
3. **Edit only the Status** (and the matching checkbox / index row / §5 token):
   - **Met** → advance to the canonical status (`✅ Done` / `✅ Implemented`),
     check the criteria boxes that are genuinely satisfied, and update the
     milestone §5 token and/or the RFC README index row so the two sources agree.
   - **Not met** → leave the status as-is (or lower it), keep the box unchecked,
     and note what's missing in the doc. Stop. Do **not** try to implement it.
4. **Re-run the driver scoped to that file** until it prints
   `✓ All product-doc statuses are canonical and consistent.`

The cross-reference chain is intentional: marking a milestone `✅ Implemented`
makes the driver then flag its source RFC if that RFC is still `Draft` — so the
RFC, its README index row, the milestone, and the tasks all converge on the same
truth. Walk the chain task → milestone → RFC, verifying at each hop.

## Gotchas

- **Single-file scope only shows that file's findings.** A milestone→RFC `STALE`
  finding is filed against the **RFC** path, so it won't appear when you scope to
  the milestone file. After flipping a milestone to `✅ Implemented`, run the
  **full** audit (or `--type=rfc`) to see whether the RFC chain-check now fires.
- **Legacy milestones 1–7 surface as `MISSING`.** They predate the status
  convention (no `**Status:**` line on the milestone or its tasks). That's
  accurate, not a bug — but it's ~60 findings of noise. Use `--type` or a path
  arg to focus on the doc you're working on; only backfill legacy statuses if
  that's the explicit task.
- **`STALE` on checkboxes is a prompt to verify, not to tick.** "Task is ✅ Done
  but has N unchecked boxes" means *go confirm those N criteria against the
  code*. Tick them only if the code truly meets them; otherwise drop the status
  back to `🚧 In Progress`. Never tick a box you didn't verify.
- **The driver does not check milestone §7 "Definition of Done" prose** (e.g. a
  `closeout-analysis.md` existing). It judges status fields and checkboxes. A
  milestone can read `✓` here while its closeout note is still owed — that's a
  separate administrative step, not a status-drift finding.
- **`✅ Implemented (on candidate)` and similar annotations are DRIFT.** Keep the
  status value canonical; if you need to record "merged to candidate, not yet on
  main," put that in prose, not in the `**Status:**` value.

## Troubleshooting

- **`Path not found: …` (exit 2)** — the path arg is resolved from the repo
  root. Pass the `docs/product/...` path as printed in the report, not an
  absolute path.
- **A milestone's tasks look done but no `STALE` fires** — the driver matches
  task files by the `.task.md` glob in the milestone folder and by the §5 table
  link target. If a task lives elsewhere or the §5 link is wrong, you'll get a
  `MISMATCH` ("row points at … which has no task file") instead.

## Files

- [`driver.mjs`](./driver.mjs) — the audit engine (report-only, Node stdlib).
- This `SKILL.md` — its man page.

## Related skills

- **`write-rfc` / `write-feature` / `write-tasks`** — author and *structurally*
  validate the docs (sections, links, §5 sync). This skill is complementary:
  they check *shape*, this one checks *status truth* against the implementation.
- **`developer`** — implements tasks and flips their status as part of delivery;
  run `verify-doc-status` afterward to catch any status the loop left behind.
