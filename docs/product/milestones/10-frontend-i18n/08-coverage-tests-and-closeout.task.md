# Task 08 — Coverage gate, tests, documentation, and milestone closeout

**Status:** 📝 Draft
**Milestone:** [10 — Frontend Internationalization (i18n)](./milestone.md)
**RFC:** [0002 — Frontend i18n](../../RFCs/0002-frontend-internationalization-i18n.md)

## Summary

Land the safety net that prevents i18n regressions and close the milestone: an automated coverage check that fails CI when a hardcoded user-facing string sneaks back into `apps/web/src/{app,components,hooks}/**`, unit tests for the dictionary plumbing, documentation updates in `CLAUDE.md` and the RFC, and a brief closeout analysis. **No language switcher tests, no routing tests** — both are out of milestone scope per `milestone.md` §6 decision #2.

## Dependencies

- Tasks 01–07 merged.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - A new coverage-check script under `apps/web/scripts/**` (or `scripts/**` at repo root, whichever matches existing conventions) and its wiring into `make test-web` (and, via the existing test workflow, CI).
  - New unit tests under `apps/web/src/**/__tests__/**` covering the i18n plumbing.
  - `CLAUDE.md` (project-level) documenting the i18n architecture and the "no hardcoded user-facing strings" rule.
  - `docs/product/RFCs/0002-frontend-internationalization-i18n.md` header status update.
  - `docs/product/RFCs/README.md` index update.
  - A new `docs/product/milestones/10-frontend-i18n/closeout-analysis.md` capturing decisions, key counts, sentinel-string check results, and follow-up backlog.
- No application code changes are needed beyond test-only files. If the coverage check uncovers a missed string, file a hotfix task — do not bundle it into this PR.
- The coverage check is a static scan (grep-based or AST-based) over `apps/web/src/{app,components,hooks}/**`. It tolerates strings inside imports, `data-*` props with sentinel values, and class names; it flags JSX text children, `alt`, `aria-label`, `title`, and `placeholder` literals. An allowlist is acceptable but must be small, justified inline, and reviewed in the PR.
- Tests use Vitest (the existing test framework in `apps/web`). No new test framework is introduced.
- The closeout note is concrete: it includes key counts per namespace, the sentinel-string verification results for both EN and PT builds, and a named list of Phase-4 follow-ups parked in the backlog.

## Scope

In:
- Coverage-check script and `make test-web` wiring.
- Unit tests for: `getLanguageFromEnv` (valid, invalid, missing — fallback to PT, warning emitted), `get-dict` selection (EN and PT paths), and `DictProvider`/`useDict` (happy path, throws outside provider).
- `CLAUDE.md` update: i18n architecture section, the build-time env-var workflow (`NEXT_PUBLIC_LANGUAGE=en make build-web` to produce an English build), and the "no hardcoded user-facing strings" rule.
- RFC 0002 status flip to `Accepted` (or `Implemented`) plus README index update.
- `closeout-analysis.md` with key counts, sentinel-check results, decisions log, and backlog.

Out:
- Migrating any further strings (Phase 2 is closed).
- Tests for a language switcher, router, or detector (none exists — out of milestone scope).
- Implementing a server-side redirect Worker (RFC 0002 Phase 4 backlog).
- Adding a third language (out of milestone).
- Locale-aware `Intl` formatting (Phase 4 backlog).

## Acceptance Criteria

- [ ] The coverage-check script runs as part of `make test-web` and fails on a deliberately-introduced hardcoded string (verified during the PR by a throwaway commit, reverted before merge).
- [ ] Unit tests for `getLanguageFromEnv`, `get-dict`, and `DictProvider`/`useDict` pass and cover the cases enumerated in §"Scope".
- [ ] `CLAUDE.md` documents the i18n architecture, the build-time env-var workflow, and the "no hardcoded user-facing strings" rule. A new contributor reading only `CLAUDE.md` could add a localized string without consulting the RFC.
- [ ] RFC 0002 header status is `Accepted` (or `Implemented`); the RFCs index reflects the same.
- [ ] `docs/product/milestones/10-frontend-i18n/closeout-analysis.md` exists and records: count of strings migrated per namespace, the milestone decisions from `milestone.md` §6, the sentinel-string verification for both EN and PT builds (run locally), screenshots of one representative screen in each language, and a bullet list of Phase 4 follow-ups parked in the backlog.
- [ ] `make lint`, `make test-web`, and `make test-api` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Add a deliberate hardcoded JSX string in a throwaway branch built off this PR and confirm `make test-web` fails with a clear coverage-check error pointing at the offending file and line. Revert.
2. Run the new unit tests in isolation (`pnpm --filter @arenaquest/web test apps/web/src/i18n` etc.) and confirm all pass.
3. Build locally with `make build-web` (PT) and `NEXT_PUBLIC_LANGUAGE=en make build-web` (EN). Grep each built JS output for a sentinel string unique to the opposite dictionary and confirm zero matches. Paste the results into `closeout-analysis.md`.
4. Read `CLAUDE.md` from a fresh checkout and confirm the i18n section answers: where do dictionaries live, how do I add a string, how do I produce an English build, and what is the rule the CI gate enforces.
5. Confirm the RFC header and the RFC index both reflect the new status.
6. Open `closeout-analysis.md` and walk every required field — counts, sentinel results, screenshots, decisions, follow-ups — and confirm none are placeholders.
7. Run the full CI pipeline locally (or via a draft PR push) and confirm green across `lint`, `test-web`, and `test-api`.
