---
name: task-planner
description: Deprecated — use team-planner instead. This skill has been superseded by team-planner, which adds team-based parallelization for independent backend and frontend work.
---

## Deprecated

This skill has been superseded by **`team-planner`**.

**Use instead:**
```
Act as team-planner. Plan and execute <path-to-task.md>
```

The `team-planner` skill preserves all invariants from the original `task-planner` and adds:
- **Parallel execution** for tasks touching both `apps/api` and `apps/web` when no `packages/shared` changes are needed
- **Sequential execution** (backend first) when `packages/shared` types must be shared
- **Team-based routing** that delegates to `backend-developer` and `frontend-developer` personas appropriately

For full documentation, see `.agents/skills/team-planner/SKILL.md`.
