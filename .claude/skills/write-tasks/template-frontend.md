## Summary

One dense paragraph describing the user-facing surface this task delivers and the
backend contract it consumes. Describe **what the user can do** and which existing
client / component it extends — no code (no JSX, no hooks). The backend endpoint
this depends on must already exist (see Depends On); this task only consumes it.

## Dependencies

- The backend task whose endpoint this consumes, linked as `./NN-<slug>.task.md`.
  A Frontend task should not ship ahead of the contract it calls.
- Existing client / component / hook this extends (`apps/web/src/lib/*-api.ts`,
  `apps/web/src/components/**`, `apps/web/src/hooks/**`).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected|auth)/**` — the page / route surface this task
    touches. Name the exact directory.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — new or extended UI
    pieces.
  - `apps/web/src/lib/*-api.ts` — the existing client call, extended (no new
    endpoint — the backend task owns that).
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are
    typed) — the new dictionary keys.
- **App Router conventions.** Server Component by default; add `'use client'`
  only where interactive state requires it. Do not convert a Server Component to
  Client unless necessary.
- **i18n.** No hardcoded user-facing strings under
  `apps/web/src/{app,components,hooks}/**`. Every label / message reads from the
  dictionary; `dict-en.ts` and `dict-pt.ts` keep identical keys;
  `check-i18n-coverage.js` must pass.
- **Cloud-agnostic.** No provider SDK; the UI calls the existing client which
  targets `NEXT_PUBLIC_API_URL`.
- **Responsive & accessible.** Follows the existing Tailwind v4 layout, usable at
  mobile / tablet / desktop; semantic markup and keyboard navigation where the
  control warrants it.

## Scope

In:
- The concrete UI deliverables — the page / control, its wiring to the existing
  client, the success / error feedback, the i18n keys, and a component test
  covering render and the call payload. One bullet per deliverable, no code.

Out:
- Any backend change — the linked Backend task owns the endpoint.
- Sibling frontend surfaces owned by other tasks.

## Acceptance Criteria

- [ ] <Observable UI assertion naming the exact signal — the control renders with
      the right default, the action issues the expected request, the state
      updates.>
- [ ] No hardcoded user-facing string; the new keys exist in both `dict-en.ts`
      and `dict-pt.ts`; `check-i18n-coverage.js` passes.
- [ ] The surface is responsive and keyboard-usable where interactive.
- [ ] Changed files lint clean; `make test-web` green for the affected component
      tests.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` (+ `make dev-api` if the live endpoint is needed) and open the
   surface; confirm the default state and the happy-path action.
2. Exercise the error path and confirm the feedback is clear.
3. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; confirm labels translate.
4. `make test-web` — component test green; run `check-i18n-coverage.js`.
5. Resize to mobile and confirm the control stays usable.
6. `git diff --stat` confirms only scope-guardrail files changed.
