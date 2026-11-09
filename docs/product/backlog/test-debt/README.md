# Test Debt Backlog

Technical tasks that raise the automated coverage of ArenaQuest without changing
what the product does. They follow the backlog route (no RFC): see
`.claude/skills/write-backlog-task/SKILL.md` and `CONTRIBUTING.md` → *Planning
happens in its own worktree first*.

## The E2E track

Six tasks give the repository its first browser-driven suite — Playwright in a
root `e2e/` workspace, three viewport projects (`desktop`, `mobile`, `tablet`),
ephemeral state per run and a CI job. They ship together through **one backlog
candidate**, `feature/backlog/test-debt/e2e/candidate`.

| Order | Task | Team | What it delivers | Depends on |
|---|---|---|---|---|
| 1 | [12 — Ephemeral S3 store](./12-e2e-s3-store.task.md) | Tooling | SeaweedFS container (`docker`), stdlib Node server (`embedded`), or `skip`, behind `E2E_S3_MODE` | — |
| 2 | [13 — Binding-less S3 storage adapter](./13-s3-storage-adapter.task.md) | Backend | `S3StorageAdapter` behind `STORAGE_DRIVER=s3`, local only, guarded out of every deployed env | — |
| 3 | [11 — E2E scaffold](./11-e2e-playwright-scaffold.task.md) | Tooling | Workspace, fixtures, `make e2e*`, CI job, scenarios 1–8 | 12, 13 |
| 4 | [14 — Mobile and tablet coverage](./14-e2e-mobile-coverage.task.md) | Tooling | M1–M12 and the shared journeys green on `mobile` and `tablet` | 11 |
| 5 | [10 — Task flow](./10-e2e-task-flow.task.md) | Tooling | Scenario 17: task authoring → student view → catalog deep link | 11 |
| 6 | [11 — Progress flow](./11-e2e-progress-flow.task.md) | Tooling | Scenario 19: enroll → consume → check-in → dashboard | 11, 10 |

The full scenario inventory (1–26 shared, M1–M12 mobile-only) is the
*Scenario roadmap* section of Task 11. Scenarios marked *follow-up* there are
not planned yet; they become one or two further backlog tasks after the
candidate merges.

Two numbers are shared inside this folder (`11-e2e-playwright-scaffold` and
`11-e2e-progress-flow`). Both predate the numbering script and are kept so the
cross-references in Milestones 3, 4 and 5 stay valid.

> Note on size: the backlog skill treats three or more tasks on one subject as a
> signal to write an RFC. This track stays in the backlog on purpose — it adds
> no entity, no table, no port and moves no security boundary, and three of its
> files already lived here — but a reviewer who prefers an RFC can lift the
> *Design* sections of Tasks 11, 12 and 13 into one without rewriting them.

## How a backlog track is executed

The path when the origin is the backlog, not an RFC (the RFC route is
`write-rfc → write-feature → write-tasks`; both routes end in the same
per-task loop):

1. **Plan in a docs worktree.** From the root checkout, on `main`:
   `make worktree-open KIND=docs SLUG=backlog-test-debt-e2e` opens
   `docs/backlog-test-debt-e2e` under `.worktrees/`. Write or complete the
   `.task.md` files with the `write-backlog-task` skill (scaffolder picks a
   collision-free number across disk, `origin/main`, `docs/*` and
   `feature/backlog/*` branches), validate with
   `node .claude/skills/write-backlog-task/check-backlog-task.mjs --topic test-debt`,
   commit as `docs(backlog): …`, push, open the PR to `main`. Only
   documentation changes in this PR.
2. **Merge the planning PR.** The `SessionStart` hook's `make worktree-sweep`
   removes the docs worktree once the PR is merged.
3. **Open the execution worktree.** Tasks that ship together use a backlog
   candidate: `make worktree-open KIND=backlog TOPIC=test-debt FEATURE=e2e`
   creates `feature/backlog/test-debt/e2e/candidate` from `origin/main` in
   `.worktrees/backlog-test-debt-e2e-candidate`; `make setup` there (deps,
   env files and local D1 are per worktree).
4. **Run the per-task loop** with the `developer` skill, in the delivery order
   of the table: each task gets its branch
   `feature/backlog/test-debt/e2e/<NN-slug>.task`, cut from the candidate,
   implemented by the `backend-developer` or `frontend-developer` persona
   (tooling tasks stay with `developer`), verified against its *Acceptance
   Criteria* and *Scope guardrail*, committed with Conventional Commits, merged
   back into the candidate with `--no-ff`, and pushed. The task file's
   **Status** moves to done in the same branch.
5. **One PR from the candidate to `main`.** CI runs `verify`, `demo-seed` and
   — once Task 11 lands — `e2e`. Review happens on the candidate; the worktree
   stays on disk for requested changes.
6. **Merge and release.** The merge deploys staging, then production behind
   the environment approval. The sweep removes the candidate worktree and its
   local branches; the branches live on in GitHub.

A single standalone task (no shared delivery) skips the candidate:
`make worktree-open KIND=backlog TOPIC=<topic> SLUG=<NN-slug>` opens
`feature/backlog/<topic>/<NN-slug>.task` and that branch is the PR.
