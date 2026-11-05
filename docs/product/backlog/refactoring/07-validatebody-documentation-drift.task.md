# Task: `@ValidateBody` Documentation Drift — Nine Documents Describe a File Deleted in May

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Priority:** Medium
- **Category:** Refactoring / Documentation Integrity
- **Dependencies:** None
- **Origin:** Found during the Milestone 19 documentation round while reading
  [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md) §5.
  The RFC's own occurrence is corrected in that round; this task covers the nine
  documents that produced it.

---

## Summary

`apps/api/src/core/decorators.ts` was deleted on 2026-05-26. Ten current
documents — including `CLAUDE.md`, which enters every agent session's context,
the root `README.md`, two architecture references, `FEATURES.md`, and five skill
or template files — still instruct the reader to validate request bodies with
the `@ValidateBody(schema)` method decorator and the `@Body()` parameter
decorator from that file. The open Milestone 19 contract repeats the same stale
instruction in two places.

The code is correct; only the documentation is wrong. Validation moved to the
router via `@hono/zod-openapi` and has worked that way for three and a half
months. Nothing fails: no test, no lint rule, no type error, and none of the
repository's four document validators looks at whether a path a document names
actually exists.

The cost is not cosmetic. Because the stale instruction sits in the templates
that generate milestones and tasks, every new backend document inherits it. RFC
0013 and Milestone 19 each repeat it, and an implementer who follows it goes
looking for a file that is not there.

---

## Problem Statement

**The deletion.** Commit `ee97f4f` (2026-05-26 11:11), `feat(api): remove
redundant ValidateBody decorators from HTTP controllers`, executed
[Milestone 9 Task 10](../../milestones/9-api-routes-openapi/10-remove-redundant-validatebody.task.md)
(RFC 0003 §4.2/§5, F10). Its audit found no non-HTTP caller, so it pruned every
usage and deleted `apps/api/src/core/decorators.ts` in full — 55 lines.

**What the pattern is today.** Request shapes are declared on the route with
`@hono/zod-openapi`'s `createRoute`, read in the handler through
`c.req.valid('json' | 'param' | 'query')`, and a router-level `defaultHook`
turns a parse failure into the `400` envelope. Controllers still return
`ControllerResult<T>` from `apps/api/src/core/result.ts`, and routers still
shape it — that half of every affected document is accurate. Only the
validation mechanism changed.

**The live documents that contradict the tree.**

| # | File | Lines | What it asserts |
|---|---|---|---|
| 1 | `CLAUDE.md` | 267 | "Use the `@ValidateBody(schema)` method decorator together with the `@Body()` parameter decorator (`src/core/decorators.ts`)" — **loaded into every session's context** |
| 2 | `docs/architecture/api/controller-pattern.md` | 18 occurrences: 21, 52, **65–113**, 138–139, 165–166, 201, 213 | An entire `## Decorators: @ValidateBody + @Body` section — ~50 of the file's 218 lines — with a runnable code example importing the deleted module |
| 3 | `docs/architecture/api/error-handling.md` | 24, 161, 329 | Names `apps/api/src/core/decorators.ts` as the site that emits `400 BadRequest` |
| 4 | `docs/product/FEATURES.md` | 225 | Describes the decorators as the current controller pattern |
| 5 | `.claude/skills/backend-developer/SKILL.md` | 44 | "**Validation via `@ValidateBody(Schema)` + `@Body()` decorators**, not inline `safeParse`" — the persona that writes API code |
| 6 | `.agents/skills/backend-developer/SKILL.md` | 39 | The same line, in a **separate file** (see *Root Cause*) |
| 7 | `.claude/skills/write-tasks/template-backend.md` | 30 | Every backend task is scaffolded from this template |
| 8 | `.claude/skills/write-feature/template.md` | 59 | Every milestone's §4 Specific Stack is scaffolded from this template |
| 9 | `.agents/skills/task-writer/SKILL.md` | 106 | A ready-made acceptance criterion: "All validation uses Zod schemas via `@ValidateBody(schema)` decorator" |
| 10 | `README.md` | 14 | Describes the current backend as using Zod-driven `@ValidateBody` / `@Body` decorators |

**The propagation it caused.** Entries 7 and 8 are generators, so the drift
reproduces itself downstream. Documents 1–4 and 10 seeded RFC 0013 §5; the
milestone inherited it from the RFC and from template 8; tasks 03 and 05
inherited it from template 7. Milestone 19 alone repeats the claim eight times
across five files, and twenty files under `docs/product/milestones/` mention it
in total.

**Why no check caught it.** `check-rfc.mjs`, `check-feature.mjs` and
`check-task.mjs` validate *structure* — filenames, required `##` sections,
metadata lines, the §5 table's sync. `verify-doc-status/driver.mjs` audits
Status strings and their cross-references. None of the four evaluates a
document's factual claims against the working tree, so a document naming a
deleted file is indistinguishable from a correct one.

---

## Root Cause

**A removal task with no documentation criterion.** Milestone 9 Task 10
explicitly anticipated the deletion — "If the audit confirms that **no**
non-HTTP caller depends on `@ValidateBody`, delete the decorator implementation
as well" — and its eight acceptance criteria cover the audit table, the pruned
usages, the retained-usage comments, the state of `decorators.ts`, the specs,
`oasdiff`, `make test-api`/`test-web`/`lint`, and the Worker bundle budget.
**None of them mentions a document.**

The commit bears this out: 12 files changed, 11 of them code and specs, and the
twelfth was the task's own file, edited only to set `Status: ✅ Completed`. Zero
descriptive documents were touched. `controller-pattern.md`'s last commit is
`befcfdd`, 2026-05-26 **01:34** — ten hours *before* the deletion — so it has
never been revised against it.

Removing the abstraction was in scope. Describing its removal was not in
anyone's.

**Two amplifiers.**

1. **The skill tree is duplicated, not linked.** `.claude/skills/` is a real
   directory in this checkout, not a symlink to `.agents/skills/`, and
   `backend-developer/SKILL.md` exists as two files with different inodes.
   They have already diverged in prose — the `.claude/` copy carries a
   rewritten description and a restructured triage section — yet **both retain
   the identical stale decorator line**. The line survived a deliberate
   modernisation of the file around it, which is the clearest evidence that
   nobody was checking these assertions against the code.
2. **`task-writer` is superseded but still readable.** `write-tasks/SKILL.md`
   records that it "supersedes the older `task-writer` persona, whose
   frontmatter-`status` template predates the current task structure." The
   superseded file was left in place with its stale criterion intact.

---

## Architectural Context

- The correct pattern is already documented accurately elsewhere and needs no
  invention: RFC 0003 argued for it, and
  [backlog Task 04](./04-api-controller-input-standardization.task.md) ("Pattern
  B", ✅ Done) describes the converged end state — the controller receives an
  already-validated typed value and HTTP-shape validation lives at the route.
  This task transcribes that reality into the nine documents; it decides nothing
  new.
- `docs/architecture/api/controller-pattern.md` is listed in
  `backend-developer/SKILL.md`'s triage table as the **mandatory** reading for
  controller work. Correcting it is therefore the highest-leverage single edit
  after `CLAUDE.md`.
- The repository's validator convention is a dependency-free Node script named
  `check-*.mjs`/`.ts` — `.claude/skills/*/check-*.mjs`,
  `apps/web/scripts/check-i18n-coverage.js`,
  `apps/api/scripts/check-no-dev-seed.ts`. The new check in Scope 3 should
  follow it rather than introduce a framework.

---

## Scope

### 1. Correct the ten current documents

Replace the decorator instruction with the actual pattern — `createRoute`
request schemas, `c.req.valid(...)` in the handler, the router-level
`defaultHook` for the `400` envelope — keeping every statement about
`ControllerResult<T>`, the routes-vs-controllers split and the error-string
conventions, which remain true.

Two edits are larger than a line swap:

- **`controller-pattern.md`** — the `## Decorators` section (lines 65–113, with
  its three subsections, including "When `@Body()` is needed vs. optional")
  documents a module that no longer exists. Replace it with the equivalent
  section for route-level validation, then update the remaining 8 occurrences
  outside it so the file is internally consistent: the Quick Reference row (21),
  the `400` row (52), the code example under "### 3. Add the schema and
  controller method" (138–139), the parameter-ordering guidance (165–166), the
  Anti-Patterns row (201) and the Related Files row (213).
- **`error-handling.md`** — lines 24, 161 and 329 attribute the `400` to the
  deleted module; re-attribute them to the router's `defaultHook` and its real
  envelope.

For the duplicated skill file, correct **both** copies (entries 5 and 6) —
editing one leaves the other authoritative for whichever runtime reads it.
Correct `task-writer/SKILL.md` (entry 9) in place. Deleting or deduplicating the
superseded persona is separate cleanup and must not be bundled into this repair.
Correct the root `README.md` (entry 10) because it describes the current shipped
architecture rather than historical behavior.

### 2. Correct the live Milestone 19 references

`docs/product/milestones/19-student-billing-and-receivables/milestone.md` states
the decorator pattern twice, in §2 (the **API** requirements bullet) and §4
(Specific Stack). M19 is still open with tasks 09–13 pending, so this is a
governing document, not a record. RFC 0013 §5 is **already corrected** in the
M19 documentation round — do not re-edit it.

### 3. Add the check that would have caught this

A dependency-free Node script that, for a fixed list of documents, extracts
every backtick-quoted repository path and asserts it exists in the working tree.
Non-zero exit with the file, line and missing path on failure.

- Add it at `scripts/check-doc-paths.mjs`, export its pure extraction and
  resolution functions, and guard CLI execution with `import.meta.url` so a
  `node:test` suite at `scripts/check-doc-paths.test.mjs` can import it.

- Cover at least `CLAUDE.md`, `docs/architecture/**`, `docs/product/FEATURES.md`
  and the skill templates under `.claude/skills/**` and `.agents/skills/**`.
- Ignore what is not a repository path: URLs, npm package names, `Entities.*`
  and other code identifiers, shell fragments, and paths inside fenced blocks
  that are illustrative rather than real. Prefer skipping an ambiguous token to
  emitting a false positive — a noisy check gets switched off.
- Deliberately **exclude** the historical documents named under *Out of scope*;
  they are supposed to describe files that no longer exist.
- Expose it through a local `lint-docs` Make target. Make `lint` depend on
  `lint-docs` only once the check runs clean, and add its test file to
  `test-scripts`, so both paths land green.

Run against `main` before the fix, the check should report
`apps/api/src/core/decorators.ts` from entries 1, 2 and 3. Include that output
in the PR description — it is the regression test for the check itself.

### 4. Add the missing criterion to the removal checklist

Amend `.claude/skills/write-tasks/template-backend.md` so a task that deletes or
renames a documented module carries an acceptance criterion for grepping the
documentation set for the symbol being removed. This is the process half of the
fix; Scope 3 is the mechanical half, and neither substitutes for the other.

### Out of scope

- **Any change under `apps/api/src/`.** The code is already correct. This task
  edits documents and adds one check script.
- **Rewriting historical records.** `docs/ReleaseNotes.md:69` announces the
  decorators as a feature of the release that introduced them; that entry was
  true when written and editing it would falsify a changelog. Adding a *later*
  entry recording the 2026-05-26 removal is acceptable. Equally frozen: RFC 0001
  and RFC 0003 (the document that *ordered* the removal), every `✅ Done` task
  file under `docs/product/milestones/` — M6, M7, M9, M12, M15, M16 and M19's
  tasks 03 and 05 — and the `planing/*.plan.md` files. They record what was
  specified at the time.
- **Auditing the rest of the documentation for other drift.** One symbol, nine
  documents. A general sweep is what Scope 3's check is for, and it should be
  run as its own task once the check exists and is quiet.
- **Reworking `ControllerResult<T>`, the error envelope, or the routers'
  `defaultHook`.**
- **Deduplicating `.claude/skills/` and `.agents/skills/` into one tree.** A
  real fix for amplifier 1, a much larger change, and its own task.

---

## Technical Constraints

- **No new dependencies.** Node built-ins only for the check script, matching
  the existing `check-*.mjs` validators.
- **The check must exit non-zero on a real miss and zero on a clean tree**, and
  must not depend on network access or a build step.
- **No false positives at merge time.** If a document legitimately names a path
  that does not exist, fix the document or add it to an explicit, commented
  ignore list — never loosen the matcher to hide it. The
  `write-rfc/SKILL.md` gotcha about not "fixing" a validator to conceal a real
  gap in an existing doc applies here verbatim.
- **Statements must be verified against the tree before being written.** Every
  replacement sentence names a file, a function or a hook; open it first. The
  defect being fixed is precisely a document that was never checked against the
  code.
- **`CLAUDE.md` is context for every session** — keep the corrected bullet the
  same length and register as its neighbours, and do not restructure the
  surrounding Architecture section.

---

## Execution Plan

### Dependencies and priority

- **Code dependency:** none. The route-level implementation is already shipped;
  [Task 04](./04-api-controller-input-standardization.task.md) records the
  current boundary and [Milestone 9 Task 10](../../milestones/9-api-routes-openapi/10-remove-redundant-validatebody.task.md)
  records the historical decorator removal.
- **Implementation references:** verify every replacement claim against
  `apps/api/src/routes/auth/register.ts` and
  `apps/api/src/routes/admin/billing.ts`. Both demonstrate `createRoute`,
  `c.req.valid(...)`, `OpenAPIHono({ defaultHook })`, and typed controller input.
- **Priority:** execute before other unplanned refactoring work. Tasks 01–06 in
  this backlog category are Done, while this Pending task affects instructions
  and generators used by every later backend task.

### Required order

1. **Baseline and classify.** Inventory `ValidateBody`, `@Body()` and
   `core/decorators.ts` occurrences. Classify each as current guidance, the open
   Milestone 19 contract, or frozen history. Confirm the deleted file is absent
   and capture pre-fix checker evidence from `HEAD` or a temporary fixture; do
   not stash/reset a shared worktree.
2. **Correct canonical architecture first.** Rewrite
   `controller-pattern.md` around route-level request schemas,
   `c.req.valid(...)`, the `defaultHook` 400 envelope, and controllers limited to
   business/domain outcomes. Realign `error-handling.md` to the same ownership
   and repair stale Related Files paths encountered in those two current guides.
3. **Correct current summaries and contracts.** Update `CLAUDE.md`, root
   `README.md`, `FEATURES.md`, and the two Milestone 19 references. Preserve
   accepted RFCs, release notes, Done task files, and old execution plans.
4. **Correct every propagation source.** Update both backend-developer skill
   copies, both `.claude` templates, and `task-writer/SKILL.md`. Add the
   delete/rename documentation-search criterion to `template-backend.md`, then
   scaffold throwaway backend-task and milestone outputs and confirm neither
   reproduces the stale pattern.
5. **Implement the path check.** Build `scripts/check-doc-paths.mjs` with Node
   built-ins only. Scan `CLAUDE.md`, `README.md`, `docs/architecture/**/*.md`,
   `docs/product/FEATURES.md`, `.claude/skills/**/*.md`, and
   `.agents/skills/**/*.md`; explicitly exclude historical milestone, RFC, plan,
   and release-note trees.
6. **Make extraction deterministic.** Ignore fenced code blocks; accept only
   root-relative repository prefixes and named root files; resolve API-scoped
   `src/...` shorthand under `apps/api/`; strip trailing line annotations; skip
   URLs, aliases, commands, globs, braces and placeholders. Report
   `document:line: missing <resolved-path>` and exit `1` for misses, `0` when
   clean, and `2` for scan/read configuration failures. Any exception must be an
   exact, commented document/token pair — never a broad pattern.
7. **Test before wiring.** Cover valid files/directories, missing paths,
   API-relative paths, line suffixes, all skip classes, and unreadable/missing
   scan targets in `scripts/check-doc-paths.test.mjs`. Run the test and checker;
   correct any additional genuine current-doc miss rather than weakening the
   matcher.
8. **Integrate and close.** Add `lint-docs`, make `lint` depend on it without a
   dependency cycle, add the new test to `test-scripts`, and run the gates below.
   Only then reconcile this inventory, mark verified checkboxes, and set Status
   to Done.

### Verification order

1. `node --test scripts/check-doc-paths.test.mjs`
2. `make lint-docs`
3. `node .claude/skills/write-rfc/check-rfc.mjs`
4. `node .claude/skills/write-feature/check-feature.mjs`
5. `node .claude/skills/write-tasks/check-task.mjs --milestone 19`
6. `make test-scripts`
7. `make -n lint` — confirm `lint-docs` runs once before Turborepo lint
8. `make lint`
9. Focused current-document occurrence search, historical-match classification,
   `git diff --check`, and full diff-scope review

### Completion evidence

The executor handoff must state the changed files, zero-match result for current
guidance, the classified historical occurrences that remain, pre-fix and
post-fix checker results, throwaway scaffold result, all command exit results,
and confirmation that no application/shared source changed. Missing evidence
leaves the corresponding criterion unchecked.

---

## Acceptance Criteria

- [ ] `grep -rn "ValidateBody\|@Body()" CLAUDE.md README.md docs/architecture/ docs/product/FEATURES.md .claude/skills/ .agents/skills/`
      returns nothing.
- [ ] `grep -rn "ValidateBody" docs/product/milestones/19-student-billing-and-receivables/milestone.md`
      returns nothing.
- [ ] No occurrence remains in any document that a reader would take as current
      instruction; every remaining occurrence in the repository is in a file
      listed under *Out of scope*, and the PR description enumerates them.
- [ ] `docs/architecture/api/controller-pattern.md` documents route-level
      validation end to end, its code example compiles against the real
      `@hono/zod-openapi` API, and its Quick Reference, `400`, Anti-Patterns and
      Related Files rows agree with the body.
- [ ] `docs/architecture/api/error-handling.md` attributes the `400` envelope to
      the router's `defaultHook` and names no deleted file.
- [ ] Both copies of `backend-developer/SKILL.md`, the root `README.md`, and
      `task-writer/SKILL.md` are corrected in place.
- [ ] A task scaffolded fresh with `new-task.mjs --team backend` contains no
      decorator instruction, and a milestone scaffolded with `new-feature.mjs`
      contains none in §4.
- [ ] `template-backend.md` carries the grep-the-docs criterion from Scope 4.
- [ ] The new check exits non-zero on `main` naming
      `apps/api/src/core/decorators.ts`, exits zero after the fix, and that
      before/after output is in the PR description.
- [ ] `scripts/check-doc-paths.test.mjs`, `make lint-docs`, `make test-scripts`,
      and `make lint` are green; `make -n lint` shows the document check runs
      before Turborepo lint.
- [ ] `node .claude/skills/write-rfc/check-rfc.mjs`,
      `check-feature.mjs` and `check-task.mjs --milestone 19` stay green.
- [ ] No diff under `apps/api/src/`, `apps/web/src/` or `packages/`.

---

## Verification Plan

1. Read `docs/architecture/api/controller-pattern.md` top to bottom against
   `apps/api/src/routes/admin/billing.ts` and one of its controllers — the
   newest module in the codebase, and a faithful example of the current pattern.
   Every claim in the document must be visible in those two files.
2. Confirm the corrected `400` description against a router's actual
   `defaultHook` (e.g. `apps/api/src/routes/auth/register.ts:59`) rather than
   from the document being replaced.
3. `git stash` the documentation fix, run the new check, and confirm it reports
   the three files that name `apps/api/src/core/decorators.ts`; restore and
   confirm it is quiet.
4. Scaffold a throwaway backend task and a throwaway milestone, grep both for
   `ValidateBody`, and delete them.
5. Re-run all four document validators plus `make lint`.
6. `git diff --stat` confirms only documents, skill files and the new check
   script changed.
