# ArenaQuest skills — how they fit together

Visual map of the project skills in this folder. Each skill's `SKILL.md` is the
source of truth; this page only summarises how they hand work to one another.
**When a `SKILL.md` changes a step, update the matching diagram in the same PR.**

| Skill | Role |
|---|---|
| [`write-rfc`](./write-rfc/SKILL.md) | Scaffold and validate an RFC (`new-rfc.mjs` → `check-rfc.mjs`) |
| [`write-feature`](./write-feature/SKILL.md) | Derive a milestone from an RFC (`new-feature.mjs` → `check-feature.mjs`) |
| [`write-tasks`](./write-tasks/SKILL.md) | Break a milestone into `NN-<slug>.task.md` files (`new-task.mjs` → `check-task.mjs`) |
| [`developer`](./developer/SKILL.md) | Orchestrate task delivery: branches, plan, delegate, verify, commit, merge |
| [`backend-developer`](./backend-developer/SKILL.md) | Implement `apps/api` / `packages/shared` work (usually as a subagent) |
| [`frontend-developer`](./frontend-developer/SKILL.md) | Implement `apps/web` work (usually as a subagent) |
| [`verify-doc-status`](./verify-doc-status/SKILL.md) | Reconcile doc statuses with the implementation (`driver.mjs`); never edits code |

## 1. End to end: from planning to delivery

```mermaid
flowchart TD
    START([Idea / requirement]) --> WT_PLAN

    subgraph PLAN["Planning worktree · docs/rfc-NNNN-slug → .worktrees/rfc-NNNN-slug"]
        WT_PLAN["Pick the number<br/>(scan local + remote branches)"] --> RFC
        RFC["write-rfc<br/>new-rfc.mjs → check-rfc.mjs<br/>RFC + README index row"] --> FEAT
        FEAT["write-feature<br/>new-feature.mjs → check-feature.mjs<br/>milestone.md + §5 table"] --> TASKS
        TASKS["write-tasks<br/>new-task.mjs → check-task.mjs<br/>NN-slug.task.md (backend / frontend apart)"]
    end

    TASKS --> PR_PLAN["Planning PR → main"]
    PR_PLAN --> WT_FEAT["make worktree-open KIND=milestone MILESTONE=N<br/>.worktrees/mN-candidate"]

    subgraph EXEC["Feature worktree · feature/mN/candidate"]
        WT_FEAT --> DEV["developer (orchestrator)<br/>per-task loop"]
        DEV -- "apps/api, packages/shared" --> BE["backend-developer<br/>(subagent)"]
        DEV -- "apps/web" --> FE["frontend-developer<br/>(subagent)"]
        BE --> DEV
        FE --> DEV
    end

    DEV --> PR_FEAT["Candidate PR → main<br/>(only on explicit confirmation)"]
    PR_FEAT --> MERGED([Merged into main])
    MERGED --> SWEEP["make worktree-sweep<br/>(SessionStart hook)"]
    MERGED --> VDS

    VDS["verify-doc-status<br/>driver.mjs: task → milestone → RFC<br/>updates the Status only, never the code"]
    VDS -. "Status drift" .-> TASKS
```

## 2. The `developer` per-task loop

```mermaid
flowchart TD
    A["Smart Check & Swap<br/>candidate → git checkout -b task branch"] --> B
    B["1 · Plan<br/>parse .task.md, pick persona<br/>commit planing/&lt;slug&gt;.plan.md"] --> C{Scope?}

    C -- "api / shared" --> BE["2 · Delegate<br/>backend-developer"]
    C -- "web" --> FE["2 · Delegate<br/>frontend-developer"]
    C -- "both" --> BE2["backend-developer"] --> V0["verify backend"] --> FE

    BE --> V
    FE --> V
    V{"3 · Verify (parent)<br/>make lint · test-api / test-web<br/>+ /run walkthrough on web"}

    V -- "fail" --> H{"Repairs < 2?"}
    H -- "yes" --> R["4 · Differential repair<br/>git diff + logs → same persona"] --> V
    H -- "no" --> STOP(["STOP · keep dirty tree<br/>report logs, mark dependents BLOCKED"])

    V -- "pass" --> D["5 · Close status<br/>criteria [x] · Status: ✅ Done · sync §5"]
    D --> P["6 · Single push of the task branch"]
    P --> M{Mode?}
    M -- "Milestone / Epic" --> MM["merge --no-ff into candidate<br/>push candidate"]
    M -- "Backlog" --> MB["Offer a PR → main"]
    M -- "Chained" --> MC["No per-task merge<br/>ff-only at the end"]

    MM --> NEXT([Next task])
    MC --> NEXT

    BE -. "BLOCKED:" .-> STOP
    FE -. "BLOCKED:" .-> STOP
```

## Rules the diagrams encode

- **The parent owns every observable step.** `developer` runs branches,
  verification, commits, pushes, merges and status edits; persona subagents only
  write code and commit locally.
- **`main` is PR-only.** Nothing is committed, merged or pushed to `main`
  directly; a PR is opened only on explicit confirmation.
- **Planning ships before code.** The RFC → milestone → task chain merges through
  its own PR before the feature worktree is opened.
- **`verify-doc-status` is report-only on code.** It points at what is missing;
  it never changes implementation to make a criterion pass.
