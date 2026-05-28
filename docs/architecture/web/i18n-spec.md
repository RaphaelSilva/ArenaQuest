# ArenaQuest — Frontend i18n Spec

> **Source:** [RFC 0002 — Frontend Internationalization (i18n) Strategy](../../product/RFCs/0002-frontend-internationalization-i18n.md) and [Milestone 10 — Frontend Internationalization](../../product/milestones/10-frontend-i18n/milestone.md).
> **Purpose:** canonical reference for building, extending, and reviewing localized UI in `apps/web`. Every string that reaches a user must follow the rules below.
> **Scope:** strictly `apps/web`. Backend content (topic titles, task descriptions, Markdown bodies, media metadata served by the API) is **not** localized in this layer.

---

## 1. Core Principles

1. **Build-time, not runtime.** The active language is selected at build time via `NEXT_PUBLIC_LANGUAGE`. Each production bundle contains exactly one dictionary; the other language is tree-shaken out. No runtime locale state, no in-app language toggle, no detection, no redirect.
2. **One language per deploy.** A single deploy serves exactly one language — the one its build was created with. Switching language is an operator action: re-run the existing deploy command with the env var set differently. There is no parallel multi-language production, no user-facing switcher, no `navigator.language` detection.
3. **Typed contract, single source of truth.** A single `Dictionary` type, derived from one canonical dictionary, governs the shape. Every dictionary satisfies it via `satisfies`. A missing or misspelled key in either language fails `tsc`.
4. **Cloud-agnostic.** The i18n layer never imports from `@cloudflare/*` or any provider-specific module. The only environmental coupling is `process.env.NEXT_PUBLIC_LANGUAGE`.
5. **Stable identifiers, not human text, as keys.** `auth.login.submitButton` — never `auth.login.entrar` or `auth.login.signIn`. Both languages are equally first-class; neither key namespace is allowed to leak into the other.
6. **No hardcoded user-facing strings under `apps/web/src/{app,components,hooks}/**`.** JSX text, `alt`, `aria-label`, `title`, `placeholder`, toast messages, validation copy, empty states — all read from the dictionary. A CI coverage check enforces this.
7. **PT is the fallback default.** When `NEXT_PUBLIC_LANGUAGE` is missing or unrecognized, the build resolves to PT and emits a single CI-visible warning. EN is opt-in via the env var.
8. **EN and PT are peers, not translations.** The PT and EN entries are authored side by side. Neither is the "real" version — translation drift is a bug.
9. **Frontend-only.** Backend payloads (topic Markdown, task copy, API error messages) are not translated by this layer. If a backend message must be localized, surface it as a key the frontend looks up, not as raw localized text in the response.

---

## 2. Module Layout

```
apps/web/src/i18n/
├── config.ts            # Language enum/union, default, getLanguageFromEnv
├── types.ts             # Dictionary type (derived from one dict, asserted via satisfies)
├── dict-en.ts           # English dictionary, `as const`
├── dict-pt.ts           # Portuguese dictionary, `as const`
├── get-dict.ts          # server-only — picks the active dict from env
└── index.ts             # public barrel — re-exports the surface

apps/web/src/context/
└── dict-context.tsx     # 'use client' — DictProvider + useDict hook
```

No `routing/` module exists. Language detection, redirect, and switcher UI are explicitly out of scope.

Mount the `DictProvider` exactly once, in `apps/web/src/app/layout.tsx`, with the server-loaded `dict` as its value. Nested providers are forbidden.

---

## 3. Consumption Rules

### 3.1 Server Components

Import the active dictionary directly from the server-only loader:

```tsx
import { dict } from '@web/i18n';

export default function AdminPage() {
  return <h1>{dict.admin.dashboard}</h1>;
}
```

`get-dict.ts` is marked `server-only`. Importing it from a Client Component fails the build.

### 3.2 Client Components

Read through the React context:

```tsx
'use client';
import { useDict } from '@web/context/dict-context';

export function Header() {
  const dict = useDict();
  return <h1>{dict.admin.dashboard}</h1>;
}
```

`useDict()` throws when used outside the provider.

### 3.3 Mixing is forbidden

Never import the server `dict` and call `useDict()` in the same component. A component is either a Server Component or a Client Component — if you need both worlds, split the component.

### 3.4 Interpolation

Strings that need a runtime value are **functions** in the dictionary, not template literals at the call site:

- Dictionary: `tasks.pendingCount: (n: number) => '${n} pendentes'` (PT) / `(n) => '${n} pending'` (EN).
- Call site: `{dict.tasks.pendingCount(count)}`.

No third-party formatting library is introduced. Functions must be pure and synchronous.

### 3.5 Numbers, dates, currency

Locale-aware formatting via `Intl.NumberFormat` / `Intl.DateTimeFormat` is **deferred** to RFC 0002 Phase 4. Until then, formatting stays in the locale-agnostic shape already in use. Do not call `toLocaleString()` ad-hoc — it ties output to the runtime locale, not to the build language.

---

## 4. Dictionary Authoring

### 4.1 Namespaces

Group by feature area, not by route:

- `auth` — login, register, activate, forgot/reset password, OAuth callback.
- `admin` — backoffice (users, groups, topics, tasks).
- `catalog` — topic browser and detail.
- `dashboard` — participant dashboard, progress widgets.
- `tasks` — participant task list and detail.
- `enrollment` — enrollment flows.
- `settings` — account settings.
- `layout` — header, sidebar, footer, breadcrumbs, user menu.
- `common` — buttons (create/edit/delete/save/cancel), generic labels, status pills.
- `errors` — global error boundaries, generic failure copy.

Add a new namespace when a feature area accumulates more than ~5 keys that don't fit cleanly into the existing ones. Update this doc when you do.

### 4.2 Key naming

- Stable English identifiers, `camelCase`, dot-separated.
- Describe the **role**, not the rendered text. `auth.login.submitButton`, not `auth.login.entrar`.
- Keep depth shallow: max three levels (`namespace.section.key`). Deeper trees signal a missing namespace.

### 4.3 Both languages always

A key exists in both dictionaries or it exists in neither. There is no "EN-only" or "PT-only" entry, and there are no empty-string values. A missing translation is tracked as a `TODO-translate` note in the milestone string inventory and resolved before the PR ships.

### 4.4 No dictionary entry for backend content

If a string is rendered from API data (topic title, task description, Markdown body), it is **not** a dictionary entry. The dictionary localizes chrome only.

---

## 5. Build & Deploy

### 5.1 No new Make targets

The existing `make build-web`, `make deploy-web`, and `make deploy-web-staging` recipes are **unchanged**. Language is chosen by setting the env var inline at invocation time:

```bash
make build-web                              # PT (default fallback)
NEXT_PUBLIC_LANGUAGE=en make build-web      # EN
NEXT_PUBLIC_LANGUAGE=pt make build-web      # PT (explicit)
NEXT_PUBLIC_LANGUAGE=en make deploy-web     # EN → production
```

There are no `build-web-en` / `deploy-web-pt` aliases. There is no separate Cloudflare Pages project per language. A single deploy serves a single language; changing the deployed language means re-running the existing deploy with a different env var.

### 5.2 CI

CI runs `make build-web`, `make test-web`, `make test-api`, and `make lint` once, with the default language (PT). Both dictionaries must satisfy the same `Dictionary` type, so the typecheck inside that single CI run catches shape drift across both languages. Running an EN-language CI job is a Phase-4 decision, not a milestone-10 requirement.

---

## 6. Testing & CI Gates

- **Typecheck.** Removing or renaming a key in one dictionary without mirroring it in the other fails `tsc`. This is the primary safety net.
- **Coverage scan.** A static scan over `apps/web/src/{app,components,hooks}/**` fails CI when a JSX text child, `alt`, `aria-label`, `title`, or `placeholder` contains a hardcoded user-facing string. A small allowlist is permitted; it is reviewed in the PR that adds an entry.
- **Unit tests.** `getLanguageFromEnv`, `get-dict` selection, and `DictProvider` + `useDict` are covered by Vitest specs under `apps/web/src/**/__tests__/**`.
- **Sentinel-string check.** When the dictionary plumbing changes, an operator builds locally with both `NEXT_PUBLIC_LANGUAGE=en` and `=pt`, then greps the built JS output for a unique sentinel from the opposite dictionary. Zero matches is the pass criterion. Not run in CI by default.

---

## 7. What lives outside this spec

The following are explicit non-goals for this layer and remain on the backlog (RFC 0002 §"Phase 4"):

- Per-user language preference persisted in the database.
- Runtime language switching (user-facing switcher, `navigator.language` detection, redirect logic).
- Per-language deployment topology (separate Cloudflare Pages projects, subdomain routing, CDN rules).
- Localization of backend content (topics, tasks, Markdown bodies, media metadata).
- Additional languages beyond EN and PT.
- Locale-aware `Intl.*` formatting.

Touching any of these requires a new RFC or milestone; do not graft them onto the build-time layer.

---

## 8. Relationship to the design system

`design-system-spec.md` describes the *visual* language (tokens, motion, components). This document describes the *textual* language (which copy gets shown, where it lives, how it's selected). The two are orthogonal: a localized string must respect the design tokens just like a hardcoded one would. The "Portuguese (pt-BR) reference locale" line in §1.9 of the design system spec is the historical default — it remains the build default per §1.7 above, but the design system makes no claim about which language any given build ships.

Within a single deploy the user sees exactly one language. There is no in-app affordance to change it. That is intentional: the design-system spec assumes one language is rendered at a time, with no "switcher" widget to design around.
