# ArenaQuest Documentation Map

**Start here:** [`product/FEATURES.md`](./product/FEATURES.md) — what the platform
does today, grouped by product area, with a link from each feature to the
milestone that built it and the RFC that specified it.

## Layout

```markdown
ArenaQuest/
├── docs/
│   ├── onboarding.md               # New-machine runbook: make setup, make doctor, troubleshooting
│   ├── ReleaseNotes.md             # Chronological, user-facing release history
│   │
│   ├── architecture/               # Technical architecture blueprints and guidelines
│   │   ├── api/                    # Backend (Worker) patterns: controllers, guards, adapters, tests
│   │   └── web/                    # Frontend (Next.js) specs: api-client, design system, i18n
│   │
│   ├── product/
│   │   ├── FEATURES.md             # ► Feature catalog by product area — the reading surface
│   │   ├── mission.md              # Mission, pillars and core design mandates
│   │   ├── vision.md               # Vision, target audience and strategic milestones
│   │   ├── specification.md        # Original phased product specification
│   │   │
│   │   ├── RFCs/                   # Proposals: why, alternatives, tradeoffs (indexed in RFCs/README.md)
│   │   │
│   │   ├── milestones/             # Delivery contracts, one folder per milestone
│   │   │   └── <N>-<slug>/
│   │   │       ├── milestone.md    # Objectives, requirements, acceptance criteria, task table
│   │   │       ├── NN-<slug>.task.md   # One unit of execution
│   │   │       └── ReleaseNotes.md     # (some milestones) what shipped
│   │   │
│   │   ├── backlog/                # Not-yet-scheduled work, by category
│   │   └── epics/                  # Cross-milestone initiatives
│   │
│   ├── scripts/                    # Scripts for document generation
│   ├── templates/                  # Templates for documentation files
│   └── imges/                      # Image assets for documentation
```

## The document chain

```
RFC  →  milestone  →  task
why     contract      execution
```

An RFC argues for a change; a milestone turns the accepted proposal into
objectives and acceptance criteria; a task is one unit of work against that
contract. Milestones 1–7 predate the RFC process and derive directly from
[`product/specification.md`](./product/specification.md).

## What is *not* kept here

Per-task execution plans (`planing/`), executor logs (`.executor-logs/`) and
per-milestone closeout notes (`closeout-analysis.md`) are **working artefacts of
a single implementation run**, not the record of a feature. They are
`.gitignore`d; historical copies remain in git history.

The record of a feature is `milestone.md` + its `.task.md` files, summarised in
[`product/FEATURES.md`](./product/FEATURES.md).

## Maintaining these docs

* **Evergreen guidance** — `product/mission.md` and `product/vision.md`.
* **Technical blueprints** — active patterns under `architecture/`.
* **New systems** — write an RFC under `product/RFCs/`, then a milestone.
* **After shipping a milestone** — add or update its entry in `product/FEATURES.md`
  and set the milestone's `**Status:**` field to match the code.
