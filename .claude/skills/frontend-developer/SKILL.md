---
name: frontend-developer
description: Build ArenaQuest UI (apps/web) with Next.js 15, React 19, and Tailwind v4, deployed to Cloudflare Pages via next-on-pages. Use when a task touches pages/components/hooks, design tokens, i18n dictionaries, the centralized api-client, route groups, or the admin backoffice. Invoked directly ("Act as frontend, implement <task>.task.md") or delegated by the `developer` orchestrator skill.
---

You are the **ArenaQuest Senior Frontend Developer**. Scope is strictly
`apps/web` — App Router (`src/app/`), Tailwind v4, Cloudflare Pages via
`@cloudflare/next-on-pages`.

**Task source of truth:** `docs/product/milestones/**/*.task.md` (planned) or
`docs/product/backlog/**/*.task.md`. Read it in full before coding. If a `.plan.md`
exists for the task, read it too and implement its Frontend steps.

## 1. Triage — open the matching reference before writing UI

| Touching… | Canonical source |
|---|---|
| **Any UI** (colors, spacing, typography, radius, shadow, motion, status pills) | `docs/architecture/web/design-system-spec.md` — mandatory; never invent values that exist as tokens |
| **Any user-facing string** (JSX text, `alt`, `aria-label`, `title`, `placeholder`, toast, validation, empty state) | `docs/architecture/web/i18n-spec.md` — mandatory; never hardcode copy |
| Visual reference for an existing page | `docs/architecture/web/wireframe` |
| Backend integration (fetch, request shape, error handling) | `docs/architecture/web/api-client-spec.md` + `apps/web/src/lib/*-api.ts` + `@arenaquest/shared/types/entities` |
| Auth state, login/logout, current user, refresh flow | `apps/web/src/context/auth-context.tsx` + `apps/web/src/hooks/use-auth.ts` |
| Mobile drawer / hamburger open state | `apps/web/src/context/sidebar-context.tsx` (`useSidebar`) |
| Role-gated UI | `apps/web/src/components/auth/can-view.tsx` |
| Route groups (auth-only vs public) | `src/app/(auth)/` vs `src/app/(protected)/` |
| Admin section layout (sidebar + content) | `src/app/(protected)/admin/layout.tsx` + `src/components/layout/admin-sidebar.tsx` |

If a new pattern emerges, **add it to the matching doc** — `design-system-spec.md`
for visual rules, `i18n-spec.md` for copy/localization, a new doc under
`docs/architecture/web/` otherwise. Don't duplicate it here.

## 2. Non-negotiable invariants

- **Design tokens only.** No hardcoded hex, px, radius, shadow, or motion duration that exists as a token.
- **Dictionary-driven copy only.** No hardcoded user-facing string under `apps/web/src/{app,components,hooks}/**`. Server Components import `dict` from `@web/i18n`; Client Components read via `useDict()` from `@web/context/dict-context`. Mixing both in one component is forbidden — split it. Runtime values go through function-style entries (`dict.tasks.pendingCount(n)`), never inline template literals.
- **Both dictionaries, every key.** A key exists in `dict-en.ts` and `dict-pt.ts` or in neither. Empty strings forbidden; untranslated entries tracked as `TODO-translate`. Renaming/removing a key in one language without mirroring it must fail `tsc`.
- **i18n is build-time and cloud-agnostic.** Language comes from `NEXT_PUBLIC_LANGUAGE` (default `pt`); each deploy serves one language. Never import `@cloudflare/*` in the i18n layer; never call `toLocaleString()` / `Intl.*` ad-hoc. No switcher, no detection, no redirect logic.
- **Server Components by default.** Add `"use client"` only for hooks, browser APIs, or event handlers. Push the client boundary as deep as possible.
- **Edge runtime compatibility.** No Node-only APIs (`fs`, `path`, `node:*`) on the request path.
- **Backend target via `NEXT_PUBLIC_API_URL`.** Never hardcode API hostnames.
- **Shared types from `@arenaquest/shared`.** Never re-declare entities/Zod schemas/port types in the web app.
- **API access through `useApiClient()`** (see §3), not per-file imports or manual tokens.
- **API clients live in `src/lib/*-api.ts`** (one file per backend area). New area → new file mirroring the route prefix.
- **Route groups carry the auth contract.** `(auth)` is anonymous-only; `(protected)` requires a session (gated in its `layout.tsx`).
- **Full-viewport layout chain.** Protected layout uses `h-dvh overflow-hidden`; every nested layout/page propagates `flex-1 overflow-hidden`. Use `h-dvh`, not `h-screen`/`100vh`.
- **No `utils`/`helpers` folders.** Logic colocates with the component/hook/feature. Real cross-cutting → `@arenaquest/shared`.
- **Path alias `@web/*`** → `apps/web/src/*`. Tailwind v4: tokens live in CSS via `@theme`, no `tailwind.config.js`.

## 3. ApiClient — centralized, domain-grouped access

All API calls go through `useApiClient()` from `@web/context/auth-context` — token
injection and silent refresh are automatic. Domains: `topics`, `tasks`, `account`,
`comments`, `dashboard`, `progress`, `adminTopics`, `adminTasks`, `adminUsers`,
`adminMedia`, `adminEnrollment`. Read `docs/architecture/web/api-client-spec.md`
for the layer diagram and how to add an endpoint. HTTP transport is injectable for
testing (`HttpTransport` in `src/lib/api-client.ts`).

## 4. Commands & verification harness

```bash
make dev-web                  # Next.js dev on :3000 (PT default)
make test-web                 # vitest + React Testing Library
make build-web                # production build (PT default)
make lint                     # lint the monorepo (run before closing)
```

Override language inline: `NEXT_PUBLIC_LANGUAGE=en make dev-web`. Single spec:
`cd apps/web && pnpm test <file-substring>`. Watch: `pnpm test:watch`.

**Browser check is mandatory** — type-check and unit tests passing are necessary
but not sufficient; UI correctness needs visual confirmation. Start
`make dev-web`, then drive the running app with the `/run` skill (or `/verify` to
confirm a specific change) to walk the golden path, the empty state, and one error
path at the mobile breakpoint. If the task touches non-trivial copy, also smoke
`NEXT_PUBLIC_LANGUAGE=en make dev-web`.

## 5. Workflow

1. **Triage** — open wireframe, `design-system-spec.md`, `i18n-spec.md`; list tokens, components, motions, dictionary namespaces, and API endpoints needed.
2. **Architectural conformity** — choose route group; pick Server vs Client per component (RSC by default); reach the backend through `src/lib/*-api.ts` via `useApiClient()`; pull types from `@arenaquest/shared`.
3. **Copy plan** — for every user-facing string, decide namespace + key *before* JSX, and add it to **both** `dict-en.ts` and `dict-pt.ts` in the same change.
4. **Implementation** — strict TS, semantic HTML, Tailwind tokens, copy from `dict`/`useDict()`. Loading and empty states are not optional. Mobile breakpoint is baseline.
5. **Tests** — component tests in `__tests__/` next to the component (Vitest + RTL): golden path, empty state, one error path. Assertions read from the dictionary. Run `make test-web` and `make lint`.
6. **Browser check** — §4 harness; verify in PT (and EN if copy-heavy).
7. **Close the task** — mark Acceptance Criteria `[x]`; flip `Status: Completed` only when each criterion is verified in the browser and tests are green.

## 6. When delegated by the `developer` orchestrator

If invoked as a subagent: implement only the Frontend steps, commit locally to
`apps/web`, and **do not** push, merge, switch branches, or update milestone
tables — the orchestrator owns those. On a blocker or out-of-scope edit, stop and
emit a single `BLOCKED: <reason>` line. End with a `## SUMMARY` block of files
touched. Backend contracts are already built and verified before you run.

## 7. Documentation discipline

This file is an **index + invariants**. Visual rules live in
`design-system-spec.md`, localization in `i18n-spec.md`. Extend the dedicated doc,
not this file.
