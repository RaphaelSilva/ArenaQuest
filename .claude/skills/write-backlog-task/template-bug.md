## Summary

One paragraph: what breaks, for whom (role, device, environment), and how badly
(data loss, wrong data shown, blocked flow, cosmetic). State whether it is
reproducible locally or only on a deployed environment.

## Reproduction

1. Starting state — environment, account role, seed data.
2. The exact steps.
3. **Expected:** what should happen.
4. **Actual:** what happens instead — paste the error, status code, or log line
   verbatim when there is one.

## Root Cause

What is **established** (measured, read in the code — cite the file) and what is
**not established** yet. If the cause is unknown, say so and make finding it the
first acceptance criterion; do not write a fix on a guess.

## Scope

In:
- The fix, and a regression test that fails before it and passes after it.

Out:
- Adjacent problems noticed while investigating — file them as their own
  backlog task instead of widening this one.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `{{exact files or directories this task may touch}}`
- The fix must not change behaviour outside the reproduced path.

## Acceptance Criteria

- [ ] The reproduction above no longer reproduces.
- [ ] A regression test pins the fixed behaviour (it fails on the old code).
- [ ] `{{gate command: make test-api / make test-web / make lint}}` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Run the reproduction steps on the old code and confirm the failure.
2. Apply the fix; run the reproduction again and `{{gate command}}`.
3. `git diff --stat` confirms only scope-guardrail files changed.
