# Milestone 10 — Frontend Internationalization (i18n)

**Status:** ✅ Implemented
**Scope:** `apps/web` (Next.js 15 frontend) and `CLAUDE.md`. Derived from [RFC 0002](../../RFCs/0002-frontend-internationalization-i18n.md).

> **Hard scope guardrail — read before opening any task.** This milestone introduces a build-time i18n layer to `apps/web` so that a single deploy serves exactly one language, selected at build time via `NEXT_PUBLIC_LANGUAGE`. It may touch: a new `apps/web/src/i18n/**` tree, a new `apps/web/src/context/dict-context.tsx`, every component or page that currently renders a hardcoded user-facing string under `apps/web/src/**`, `apps/web/next.config.ts`, and `CLAUDE.md`. It is **not** an opportunity to redesign components, swap CSS, refactor API clients, change visible behaviour beyond text substitution, build a language switcher, add routing/redirect logic, or stand up parallel per-language deployments. Domain entities under `packages/shared/**`, anything under `apps/api/**`, database migrations, adapter implementations, and the existing deploy pipeline (`make deploy-web`, `make deploy-web-staging`, Cloudflare Pages project configuration) are **out of scope**. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **Centralize every user-facing string in `apps/web`** into typed dictionaries (`dict-en`, `dict-pt`) with a single shared `Dictionary` type that both dictionaries satisfy.
- **Select the active language at build time** via `NEXT_PUBLIC_LANGUAGE`. Each build contains exactly one dictionary; the other is tree-shaken out. Missing or unrecognized values fall back to PT silently with a single CI-visible warning.
- **Expose dictionaries uniformly to Server and Client Components** through a server-only `get-dict` helper and a React context (`useDict`) wired in the root layout.
- **Gate "missing translation" and "hardcoded copy" regressions** with a typecheck-driven shape check (both dictionaries `satisfies Dictionary`) and a CI coverage scan over `apps/web/src/{app,components,hooks}/**`.

Out of scope (explicit):
- **No user-facing language switcher.** Users cannot change language inside the app.
- **No routing or redirect logic.** No `navigator.language` detection, no override persistence, no `localStorage` flag, no `apps/web/src/i18n/routing/**` module.
- **No per-language deployment topology.** No new Cloudflare Pages projects, no `build-web-en` / `deploy-web-en` Make targets, no CI matrix. The existing `make deploy-web` / `make deploy-web-staging` recipes are unchanged. To switch the deployed language, an operator sets `NEXT_PUBLIC_LANGUAGE` inline (e.g. `NEXT_PUBLIC_LANGUAGE=en make deploy-web`) and re-deploys — nothing else changes.
- All of RFC 0002 Phase 4: per-user DB preference, runtime switching, content localization of topics/tasks/media, additional languages beyond EN/PT, locale-aware `Intl` formatting.
- Any change to `apps/api`, `packages/shared`, D1 schema, or adapter implementations.
- Visual redesign or component refactors. String extraction must preserve markup, styling, and behaviour.
- Translation of dynamic backend content (topic titles, task descriptions, media metadata served by the API).

---

## 2. Functional Requirements

- A single `Dictionary` type defines the shape of every namespace; `dict-en` and `dict-pt` are both `Dictionary`-typed `as const` objects. A missing key in either dictionary fails `make test-web` (typecheck).
- The active dictionary is selected from `NEXT_PUBLIC_LANGUAGE` at build time. An unknown or absent value falls back to `pt` and emits a single build-time warning to stdout.
- Server Components read dictionary entries by importing the active `dict` from the server-only loader. Client Components read them through `useDict()` consumed from a provider mounted in the root layout.
- No user-facing string remains hardcoded under `apps/web/src/{app,components,hooks}/**`. A coverage scan (introduced in Task 08) reports zero misses.
- `make deploy-web` and `make deploy-web-staging` continue to work unchanged. Passing `NEXT_PUBLIC_LANGUAGE=en` inline produces an English build; omitting it produces a Portuguese build. Only one language is live at any moment per deploy.

---

## 3. Acceptance Criteria

- [x] `apps/web/src/i18n/` contains `config.ts`, `dict-en.ts`, `dict-pt.ts`, `get-dict.ts`, and `index.ts`; `apps/web/src/context/dict-context.tsx` exposes a provider and a `useDict` hook.
- [x] `dict-en` and `dict-pt` both satisfy a single shared `Dictionary` type. Removing or renaming any key in one dictionary without mirroring it in the other fails typecheck.
- [x] The Task-02 string inventory matches the post-migration codebase: a grep for the listed pre-migration strings returns zero hits under `apps/web/src/{app,components,hooks}/**` after Task 07.
- [x] `make build-web` succeeds with `NEXT_PUBLIC_LANGUAGE` set to `en`, set to `pt`, set to an unknown value, and unset. The last two cases fall back to PT and emit the documented warning.
- [x] The EN build does not contain Portuguese sentinel strings from `dict-pt`, and the PT build does not contain English sentinel strings from `dict-en` (verified by grepping built JS for a unique sentinel from each dictionary; result is recorded in the Task 08 closeout).
- [x] No code under `apps/web/src/**` implements language detection, redirect logic, override persistence, or a language switcher.
- [x] `make lint`, `make test-web`, and `make test-api` pass green in CI (single language, default PT).
- [x] `CLAUDE.md` documents the i18n architecture, the build-time env-var workflow, and the rule that no hardcoded user-facing string may be added to `apps/web/src/**`.
- [x] No diff outside the scope declared in §"Hard scope guardrail".

---

## 4. Specific Stack

- **No new runtime libraries.** RFC 0002 explicitly rejects `i18next` / `next-intl`. The implementation relies on native TypeScript types, plain `as const` objects, `process.env.NEXT_PUBLIC_LANGUAGE`, and React context.
- **Next.js 15 App Router** server/client component split — the server loader is server-only; the client provider is mounted once in the root layout.
- **Vitest** for unit tests covering the dictionary plumbing.
- **No deployment infrastructure changes.** The existing `make deploy-web` / `make deploy-web-staging` recipes and the single Cloudflare Pages project remain as-is. Language selection is an env-var change at build invocation time.

---

## 5. Task Breakdown

| # | Task File | Status |
|---|-----------|--------|
| 01 | [i18n module foundation and build-time language config](./01-i18n-module-foundation.task.md) | ✅ Done |
| 02 | [Author EN and PT dictionaries with a shared `Dictionary` type](./02-dictionaries-en-pt.task.md) | ✅ Done |
| 03 | [Server dict loader and client `DictProvider` / `useDict`](./03-dict-loader-and-context.task.md) | ✅ Done |
| 04 | [Migrate `(auth)` route group strings to the dictionary](./04-migrate-auth-group.task.md) | ✅ Done |
| 05 | [Migrate `(protected)/admin/**` strings to the dictionary](./05-migrate-admin-backoffice.task.md) | ✅ Done |
| 06 | [Migrate participant routes — catalog, dashboard, tasks, enrollment, settings](./06-migrate-participant-routes.task.md) | ✅ Done |
| 07 | [Migrate shared layout, navigation, and design-system strings](./07-migrate-shared-layout.task.md) | ✅ Done |
| 08 | [Coverage gate, tests, documentation, and milestone closeout](./08-coverage-tests-and-closeout.task.md) | ✅ Done |

Dependency graph:

```
01 ──► 02 ──► 03 ──► 04, 05, 06, 07  (parallel after 03)
                              │
                              ▼
                             08
```

**Recommended execution order:** `01` → `02` → `03` → `04, 05, 06, 07` (parallel where reviewer bandwidth allows) → `08`.

Each task is intended to land as an independent PR with `make lint`, `make test-web`, and `make test-api` passing.

---

## 6. Decisions recorded

The following questions from RFC 0002 §"Questions & Future Decisions" are resolved for this milestone:

1. **Default language fallback** when `NEXT_PUBLIC_LANGUAGE` is missing or unknown: **`pt`**, with a single CI-visible warning.
2. **Language switching & routing topology:** **none in this milestone.** A single language ships per deploy; switching means re-deploying with a different env var. No switcher UI, no routing module, no per-language Cloudflare Pages projects.
3. **CI matrix:** **single language (PT default).** TypeScript still enforces that both dictionaries satisfy the same shape, so a broken-key regression is caught at typecheck. Adding an EN-language CI job is a Phase-4 decision.
4. **Per-user preference, runtime switching, content localization, additional languages, `Intl` formatting:** deferred to RFC 0002 Phase 4 (backlog).

---

## 7. Definition of Done (milestone level)

- [x] All 8 tasks marked `✅ Done` with every acceptance box checked.
- [x] All milestone-level acceptance criteria in §3 pass.
- [x] `make lint`, `make test-api`, and `make test-web` all green in CI.
- [x] Closeout note at `docs/product/milestones/10-frontend-i18n/closeout-analysis.md` records: number of strings migrated per namespace, the decisions recorded in §6, and a screenshot of one representative screen in each language built locally.
- [x] RFC 0002 status updated to `Accepted` (or `Implemented`) in `docs/product/RFCs/README.md` and in the RFC header. Phase 4 items remain explicitly listed as backlog.
- [x] No diff outside the scope declared in §"Hard scope guardrail".
