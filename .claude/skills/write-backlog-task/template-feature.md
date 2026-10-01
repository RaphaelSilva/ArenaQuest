## Summary

One dense paragraph: what the user (name the role — admin, content_creator,
student, anonymous visitor) can do after this task that they cannot do today,
and where in the product it surfaces. Describe the **contract**, not the
implementation — no code (no SQL, TypeScript, JSX, or pseudocode).

## Motivation

- Who asked for it or what observation triggered it (a support request, a
  milestone closeout, a measured number). Link the source when it exists.
- What happens today without it — the workaround, or the dead end.

## Scope

In:
- One bullet per deliverable: the endpoint / screen / script behaviour, the
  test that proves it. Name the observable behaviour, not the code shape.

Out:
- What a reader might reasonably expect here but is **not** part of this task —
  and where it lives instead (another backlog task, a future RFC, nowhere).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `{{exact files or directories this task may touch}}`
- Reuse the existing pattern this change extends — name it (the router,
  controller, repository, component, or script it mirrors).
- State any security-, tenant-, or data-sensitive default explicitly.

## Acceptance Criteria

- [ ] <Observable assertion naming the exact signal that proves it — an endpoint
      response, a rendered element for a given role, a passing test case.>
- [ ] Changed files lint clean; `{{gate command: make test-api / make test-web / make lint}}` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `{{gate command}}` — the new and affected specs pass.
2. Exercise the behaviour by hand (`make dev-api` / `make dev-web`), including the
   failure path (missing permission, invalid input, empty state).
3. `git diff --stat` confirms only scope-guardrail files changed.
