# ArenaQuest skills — how they fit together

Visual map of the project skills in this folder. Each skill's `SKILL.md` is the
source of truth; this page only summarises how they hand work to one another.
**When a `SKILL.md` changes a step, update the matching diagram in the same PR.**

| Skill | Role |
|---|---|
| [`write-rfc`](./write-rfc/SKILL.md) | Scaffold and validate an RFC (`new-rfc.mjs` → `check-rfc.mjs`) |
| [`write-feature`](./write-feature/SKILL.md) | Derive a milestone from an RFC (`new-feature.mjs` → `check-feature.mjs`) |
| [`write-backlog-task`](./write-backlog-task/SKILL.md) | Light route: Step 0 gate, then one or two backlog `.task.md` files with no RFC (`new-backlog-task.mjs` → `check-backlog-task.mjs`) |
| [`write-tasks`](./write-tasks/SKILL.md) | Break a milestone into `NN-<slug>.task.md` files (`new-task.mjs` → `check-task.mjs`) |
| [`developer`](./developer/SKILL.md) | Orchestrate task delivery: branches, plan, delegate, verify, commit, merge |
| [`backend-developer`](./backend-developer/SKILL.md) | Implement `apps/api` / `packages/shared` work (usually as a subagent) |
| [`frontend-developer`](./frontend-developer/SKILL.md) | Implement `apps/web` work (usually as a subagent) |
| [`verify-doc-status`](./verify-doc-status/SKILL.md) | Reconcile doc statuses with the implementation (`driver.mjs`); never edits code |

## 1. End to end: from a request to delivery

Every request first passes the **Step 0** gate of `write-backlog-task`. If it fails
any criterion it takes the **heavy route** (RFC → milestone → tasks); otherwise the
**light route** (one or two backlog task files). Both ship their planning in a
docs-only PR before `developer` executes it.

```mermaid
flowchart TD
    START([New request]) --> GATE{"Fits the backlog?<br/>(Step 0 of write-backlog-task)"}

    GATE -->|"Fails any criterion:<br/>• more than 1 PR per layer<br/>• new entity / table / port<br/>• moves a security boundary<br/>• open product decision"| WT_RFC
    GATE -->|"All hold"| WT_BL

    subgraph HEAVY["Heavy route — RFC · docs/rfc-NNNN-slug → .worktrees/rfc-NNNN-slug"]
        WT_RFC["make worktree-open KIND=rfc<br/>pick the number (scan local + remote branches)"] --> RFC_DOC
        RFC_DOC["write-rfc<br/>new-rfc.mjs → check-rfc.mjs<br/>RFC + README index row"] --> FEAT
        FEAT["write-feature<br/>new-feature.mjs → check-feature.mjs<br/>milestone.md + §5 table"] --> TASKS
        TASKS["write-tasks<br/>new-task.mjs → check-task.mjs<br/>NN-slug.task.md (backend / frontend apart)"]
    end

    subgraph LIGHT["Light route — write-backlog-task · docs/backlog-topic-slug"]
        WT_BL["make worktree-open KIND=docs<br/>SLUG=backlog-&lt;topic&gt;-&lt;slug&gt;"] --> FETCH["git fetch origin"]
        FETCH --> SCAF["new-backlog-task.mjs<br/>--topic --kind --team --title"]
        SCAF --> KIND{"--kind"}
        KIND -->|feature| T_FEAT["template-feature<br/>+ Motivation"]
        KIND -->|bug| T_BUG["template-bug<br/>+ Reproduction<br/>+ Root Cause"]
        KIND -->|"refactor / debt / chore"| T_IMP["template-improvement<br/>+ Why It Is Worth Fixing"]
        T_FEAT & T_BUG & T_IMP --> TEAM{"--team"}
        TEAM -->|"backend / frontend / tooling"| ONE["1 file<br/>NN-slug.task.md"]
        TEAM -->|both| TWO["2 files<br/>NN backend<br/>NN+1 frontend → depends on NN"]
        ONE & TWO --> FILL["Fill the sections<br/>(contract, Scope guardrail,<br/>observable criteria)"]
        FILL --> CHECK{"check-backlog-task.mjs"}
        CHECK -->|"✗ error"| FILL
        CHECK -->|"⚠ placeholders / RFC signal"| FILL
        CHECK -->|"✓"| BL_COMMIT["commit docs(backlog): …"]
    end

    TASKS --> PR_RFC["Planning PR → main"]
    BL_COMMIT --> PR_BL["Planning PR → main"]
    PR_RFC --> M_RFC[(merged into main)]
    PR_BL --> M_BL[(merged into main)]

    M_RFC --> WT_FEAT["make worktree-open KIND=milestone MILESTONE=N<br/>branch feature/mN/candidate"]
    M_BL --> WT_TASK["make worktree-open KIND=backlog<br/>branch feature/backlog/&lt;topic&gt;/&lt;NN-slug&gt;.task"]

    subgraph EXEC["Feature worktree · .worktrees/&lt;name&gt;"]
        WT_FEAT --> DEV["developer (orchestrator)<br/>per-task loop"]
        WT_TASK --> DEV
        DEV -- "apps/api, packages/shared" --> BE["backend-developer<br/>(subagent)"]
        DEV -- "apps/web" --> FE["frontend-developer<br/>(subagent)"]
        BE --> DEV
        FE --> DEV
    end

    DEV --> PR_CODE["Code PR → main<br/>(candidate or backlog task branch;<br/>only on explicit confirmation)"]
    PR_CODE --> MERGED([Merged into main])
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
- **Planning ships before code.** Both routes — the RFC → milestone → task chain and
  the backlog task files — merge through their own docs PR before the feature
  worktree is opened.
- **Step 0 decides the route.** A request that fails any backlog criterion becomes
  an RFC; the gate names the failed criterion instead of deciding silently.
- **`verify-doc-status` is report-only on code.** It points at what is missing;
  it never changes implementation to make a criterion pass.
