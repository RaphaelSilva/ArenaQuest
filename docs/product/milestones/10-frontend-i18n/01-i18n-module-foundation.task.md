# Task 01 — i18n module foundation and build-time language config (Phase 1)

**Status:** ✅ Done
**Milestone:** [10 — Frontend Internationalization (i18n)](./milestone.md)
**RFC:** [0002 — Frontend i18n, Phase 1](../../RFCs/0002-frontend-internationalization-i18n.md)

## Summary

Stand up the `apps/web/src/i18n/` directory and the typed contract that every subsequent task builds on: a `Language` enum, a `getLanguageFromEnv` helper that reads `NEXT_PUBLIC_LANGUAGE` with a documented fallback, the public `index.ts` surface, and the `next.config.ts` change that exposes `NEXT_PUBLIC_LANGUAGE` to the build. **No dictionaries and no migrations in this task** — the goal is purely to land the typed foundation.

## Dependencies

None. Blocks every other task in this milestone.

## Technical Constraints

- **Scope guardrail:** changes restricted to a new `apps/web/src/i18n/config.ts`, a new `apps/web/src/i18n/index.ts`, `apps/web/next.config.ts`, and `apps/web/package.json` (only if a script tweak is required). No other file is modified.
- The `Language` enum (or const-union — implementer's call) must enumerate exactly the two languages in scope (`en`, `pt`). Adding a third language later must be a one-line change here, not a refactor.
- `getLanguageFromEnv` must:
  - Return a typed `Language` value, never `string`.
  - Fall back to `pt` (the milestone default recorded in `milestone.md` §6) when the env var is absent or unrecognised.
  - Emit a single, clearly-prefixed warning on the build's stdout when it falls back, so missing/wrong env settings are visible in CI logs.
- `next.config.ts` must surface `NEXT_PUBLIC_LANGUAGE` so it is statically replaced in client bundles. The change must not alter any other Next.js configuration.
- The module must be **cloud-agnostic**: it must not import anything from `@cloudflare/*`, `next-on-pages`, or any provider-specific package. Reading `process.env` is the only environmental coupling allowed.

## Scope

In:
- Create `apps/web/src/i18n/config.ts` exporting the `Language` enum/union, the milestone-default constant, and `getLanguageFromEnv`.
- Create `apps/web/src/i18n/index.ts` as the public barrel for the module (re-exports only).
- Update `apps/web/next.config.ts` to expose `NEXT_PUBLIC_LANGUAGE` to the build pipeline if Next.js's default `NEXT_PUBLIC_*` handling is not sufficient for the chosen access pattern.
- Add a `// TODO: dictionaries land in Task 02` placeholder comment in `index.ts` so the next task has an obvious anchor.

Out:
- Authoring `dict-en.ts` or `dict-pt.ts` (Task 02).
- Implementing `get-dict.ts` or `dict-context.tsx` (Task 03).
- Migrating any component (Tasks 04–07).
- Touching `Makefile` or `turbo.json` (Task 08).

## Acceptance Criteria

- [x] `apps/web/src/i18n/config.ts` exports `Language`, the default-language constant, and `getLanguageFromEnv`.
- [x] `apps/web/src/i18n/index.ts` re-exports the public surface of `config.ts`.
- [x] `getLanguageFromEnv` returns the milestone-default when `NEXT_PUBLIC_LANGUAGE` is absent and when it is set to a value outside the `Language` set; in both fallback cases a warning is emitted exactly once per build.
- [x] `apps/web/next.config.ts` exposes `NEXT_PUBLIC_LANGUAGE` for build-time inlining without altering any other configuration.
- [x] `make lint` and `make test-web` pass green (no new tests required in this task, but no regression is allowed).
- [x] No diff outside the files listed in the scope guardrail.

## Verification Plan

1. Run `make lint` and `make test-web` from a clean checkout; confirm green.
2. Run `make build-web` once with `NEXT_PUBLIC_LANGUAGE=en`, once with `=pt`, once with `=xx`, and once unset. Confirm the build succeeds in all four cases, the fallback warning appears only in the last two, and the resolved language matches the env value in the first two (verified by a temporary `console.log` in a server component, removed before commit, **or** by reading the dumped Next.js build manifest).
3. Open `apps/web/next.config.ts` in a diff viewer and confirm only the env-exposure line changes.
4. Confirm no production code outside `apps/web/src/i18n/**` imports from the new module yet — this task is foundation only.
