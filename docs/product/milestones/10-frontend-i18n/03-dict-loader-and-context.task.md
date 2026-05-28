# Task 03 — Server dict loader and client `DictProvider` / `useDict` (Phase 1)

**Status:** ✅ Done
**Milestone:** [10 — Frontend Internationalization (i18n)](./milestone.md)
**RFC:** [0002 — Frontend i18n, Phase 1](../../RFCs/0002-frontend-internationalization-i18n.md)

## Summary

Wire the dictionaries produced in Task 02 into the two consumption paths the App Router needs: a server-only `get-dict` helper for Server Components, and a React context (`DictProvider` + `useDict`) for Client Components. Mount the provider exactly once in the root layout so every client subtree has access. **No component is migrated to use these APIs in this task** — that work is split across Tasks 04–07 to keep PRs reviewable.

## Dependencies

- Task 02 (dictionaries authored and exported).

## Technical Constraints

- **Scope guardrail:** changes restricted to new files `apps/web/src/i18n/get-dict.ts` and `apps/web/src/context/dict-context.tsx`, an update to `apps/web/src/i18n/index.ts` to re-export the loader, and a minimal change to `apps/web/src/app/layout.tsx` to mount the provider. No other file is touched.
- `get-dict.ts` must be **server-only** — annotate with `import 'server-only'` (or equivalent) so accidental client imports fail at build time. It selects the dictionary based on `getLanguageFromEnv()` from Task 01 and re-exports a stable `dict` reference.
- `dict-context.tsx` must use the `'use client'` directive. The provider accepts the active dictionary as a prop (passed down from the root layout, which is a Server Component) so the language decision still happens at build time, not at runtime. `useDict()` throws a developer-friendly error when called outside the provider.
- The provider must be **a single instance at the root**. Nested providers are forbidden — adding one is a code smell that future PRs must reject.
- No state, no effect, no memoization beyond what is structurally required. The dictionary reference is stable for the lifetime of the bundle, so the provider's `value` prop is a direct pass-through.
- The loader and the context must remain provider-agnostic: no `@cloudflare/*` imports, no `next-on-pages`, no `headers()` calls. The only environmental coupling is `process.env.NEXT_PUBLIC_LANGUAGE` via Task 01's helper.

## Scope

In:
- Implement `apps/web/src/i18n/get-dict.ts` selecting between `dict-en` and `dict-pt` via `getLanguageFromEnv()`, exporting the active `dict` and the active `Language` value.
- Implement `apps/web/src/context/dict-context.tsx` with `DictProvider` (`'use client'`) and `useDict` (typed against the `Dictionary` type from Task 02).
- Update `apps/web/src/i18n/index.ts` to re-export the loader output.
- Update `apps/web/src/app/layout.tsx` to import `dict` from the server loader and wrap the rendered children in `<DictProvider value={dict}>`.

Out:
- Migrating any component to consume `dict` or `useDict` (Tasks 04–07).
- Adding tests for the loader/context (deferred to Task 10's coverage-and-tests pass).
- Implementing the language switcher (Task 09).

## Acceptance Criteria

- [x] `apps/web/src/i18n/get-dict.ts` is server-only (verified by attempting to import it from a client component during development — the build fails with the expected `server-only` error).
- [x] `apps/web/src/context/dict-context.tsx` exposes `DictProvider` and `useDict`; `useDict` is typed as the `Dictionary` shape from Task 02 and throws when used outside the provider.
- [x] `apps/web/src/app/layout.tsx` mounts `DictProvider` exactly once around the rendered children.
- [x] A minimal smoke test in `make dev-web`: a temporary server component renders `dict.common.loading`, and a temporary client component renders `useDict().common.loading`. Both display the value from the active dictionary. The smoke harness is removed before commit.
- [x] `make lint` and `make test-web` pass green.
- [x] No diff outside the files listed in the scope guardrail.

## Verification Plan

1. Run `make dev-web` with `NEXT_PUBLIC_LANGUAGE` unset, then with `=en`, then with `=pt`. Hit a temporary route that renders both a server and a client `common.loading` and confirm the displayed text changes accordingly.
2. Attempt to import `get-dict` from a client component (e.g. a temporary `'use client'` file) and confirm Next.js refuses to build with the `server-only` error. Revert the attempt.
3. Call `useDict()` from a component outside the provider tree in a temporary harness and confirm the documented error is thrown. Revert.
4. Run `make lint` and `make test-web` and confirm green.
