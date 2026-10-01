## Summary

One paragraph: the current state (name the files involved) and the target state.
This kind of task changes **how** the code is built, not what the product does —
say so explicitly if user-visible behaviour must stay identical.

## Why It Is Worth Fixing

- The concrete cost of leaving it: a drift that already happened, a test that
  cannot be written, a trap the next feature will fall into, a slow loop.
- Evidence — the commit, task, or incident where it bit.

## Scope

In:
- One bullet per deliverable, plus the test or check that keeps it from
  regressing.

Out:
- Behaviour changes, redesigns, and neighbouring cleanups — those are separate
  tasks.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `{{exact files or directories this task may touch}}`
- No behaviour change unless the Summary says otherwise.

## Acceptance Criteria

- [ ] <Observable assertion — the duplicated thing exists once, the check fails
      on a reintroduced drift, the build/test time is below N.>
- [ ] `{{gate command: make test-api / make test-web / make lint}}` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `{{gate command}}` — existing specs pass unchanged (proves no behaviour change).
2. Demonstrate the guard: reintroduce the old problem locally and confirm the new
   test or check catches it, then revert.
3. `git diff --stat` confirms only scope-guardrail files changed.
